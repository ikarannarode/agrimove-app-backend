-- Apply after schema.sql, transport-schema.sql, and phase1-mobile.sql.
-- Adds selected map coordinates and manual payment verification to the existing flow.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pickup_latitude double precision,
  ADD COLUMN IF NOT EXISTS pickup_longitude double precision,
  ADD COLUMN IF NOT EXISTS destination_latitude double precision,
  ADD COLUMN IF NOT EXISTS destination_longitude double precision,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'CASH',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS payment_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_transaction_id text,
  ADD COLUMN IF NOT EXISTS payment_screenshot_path text,
  ADD COLUMN IF NOT EXISTS payment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_delete_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_phase2_payment_mode_check'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_phase2_payment_mode_check
      CHECK (payment_mode IN ('CASH', 'ONLINE'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_phase2_payment_amount_check'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_phase2_payment_amount_check
      CHECK (payment_amount IS NULL OR payment_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_phase2_payment_status_check'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_phase2_payment_status_check
      CHECK (payment_status IN ('PENDING', 'VERIFICATION_PENDING', 'COMPLETED', 'REJECTED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_phase2_coordinates_check'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_phase2_coordinates_check CHECK (
      num_nonnulls(pickup_latitude, pickup_longitude, destination_latitude, destination_longitude) IN (0, 4)
      AND (
        (pickup_latitude IS NULL AND pickup_longitude IS NULL
          AND destination_latitude IS NULL AND destination_longitude IS NULL)
        OR (
        pickup_latitude BETWEEN -90 AND 90 AND pickup_longitude BETWEEN -180 AND 180
        AND destination_latitude BETWEEN -90 AND 90 AND destination_longitude BETWEEN -180 AND 180
        )
      )
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.owner_payment_settings (
  owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  upi_id text,
  qr_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_payment_settings_upi_format CHECK (
    upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$'
  ),
  CONSTRAINT owner_payment_settings_qr_owner_path CHECK (
    qr_storage_path IS NULL OR qr_storage_path LIKE owner_id::text || '/%'
  )
);

CREATE TABLE IF NOT EXISTS public.payment_screenshot_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  retention_hours integer NOT NULL DEFAULT 24 CHECK (retention_hours BETWEEN 1 AND 720),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.payment_screenshot_policy (singleton, retention_hours)
VALUES (true, 24)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.payment_screenshot_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_screenshot_policy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_screenshot_policy TO service_role;
GRANT SELECT, UPDATE ON public.bookings TO service_role;

CREATE INDEX IF NOT EXISTS idx_bookings_payment_review
  ON public.bookings(payment_status, created_at DESC)
  WHERE payment_mode = 'ONLINE';
CREATE INDEX IF NOT EXISTS idx_bookings_payment_screenshot_expiry
  ON public.bookings(payment_delete_at)
  WHERE payment_screenshot_path IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('owner-payment-qr', 'owner-payment-qr', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('payment-screenshots', 'payment-screenshots', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION agri_private.phase2_owner_can_read_qr(target_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.vehicles v ON v.id = b.vehicle_id
    WHERE v.owner_id = target_owner AND b.farmer_id = auth.uid()
      AND b.status = 'ACCEPTED' AND b.payment_mode = 'ONLINE'
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_can_read_owner(target_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.vehicles v ON v.id = b.vehicle_id
    WHERE b.farmer_id = auth.uid() AND v.owner_id = target_profile
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_can_access_payment_screenshot(target_booking uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.vehicles v ON v.id = b.vehicle_id
    WHERE b.id = target_booking AND b.payment_mode = 'ONLINE'
      AND (b.farmer_id = auth.uid() OR v.owner_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_owner_has_qr(target_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT agri_private.current_app_role() = 'farmer'
    AND EXISTS (
      SELECT 1 FROM public.vehicles v
      JOIN public.owner_payment_settings s ON s.owner_id = v.owner_id
      WHERE v.owner_id = target_owner AND v.is_active
        AND v.availability_status = 'AVAILABLE' AND s.qr_storage_path IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_screenshot_path_access(target_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN split_part(target_path, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.vehicles v ON v.id = b.vehicle_id
      WHERE b.id = split_part(target_path, '/', 2)::uuid
        AND b.payment_mode = 'ONLINE'
        AND split_part(target_path, '/', 1) = b.farmer_id::text
        AND (b.farmer_id = auth.uid() OR v.owner_id = auth.uid())
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_screenshot_upload_allowed(target_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT agri_private.current_app_role() = 'farmer' AND CASE
    WHEN split_part(target_path, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = split_part(target_path, '/', 2)::uuid
        AND b.farmer_id = auth.uid()
        AND split_part(target_path, '/', 1) = auth.uid()::text
        AND b.payment_mode = 'ONLINE' AND b.status = 'ACCEPTED'
        AND b.payment_status IN ('PENDING', 'REJECTED')
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION agri_private.phase2_screenshot_replace_allowed(target_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT agri_private.current_app_role() = 'farmer' AND CASE
    WHEN split_part(target_path, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = split_part(target_path, '/', 2)::uuid
        AND b.farmer_id = auth.uid()
        AND split_part(target_path, '/', 1) = auth.uid()::text
        AND b.payment_mode = 'ONLINE' AND b.status = 'ACCEPTED'
        AND b.payment_status = 'REJECTED'
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.phase2_has_owner_qr(target_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT agri_private.phase2_owner_has_qr(target_owner);
$$;
REVOKE ALL ON FUNCTION public.phase2_has_owner_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phase2_has_owner_qr(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_owner_can_read_qr(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_can_read_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_can_access_payment_screenshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_owner_has_qr(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_screenshot_path_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_screenshot_upload_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase2_screenshot_replace_allowed(text) TO authenticated;
REVOKE ALL ON FUNCTION agri_private.phase2_owner_can_read_qr(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_can_read_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_can_access_payment_screenshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_owner_has_qr(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_screenshot_path_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_screenshot_upload_allowed(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase2_screenshot_replace_allowed(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.phase2_guard_payment_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment settings can only be changed by their owner';
  END IF;
  IF agri_private.current_app_role() <> 'vehicle_owner' THEN
    RAISE EXCEPTION 'Only vehicle owners can configure payment settings';
  END IF;
  IF NEW.qr_storage_path IS NOT NULL AND
     (NEW.qr_storage_path NOT LIKE NEW.owner_id::text || '/%' OR position('..' in NEW.qr_storage_path) > 0) THEN
    RAISE EXCEPTION 'Invalid QR storage path';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.qr_storage_path IS NOT NULL
     AND NEW.qr_storage_path IS NULL
     AND EXISTS (
       SELECT 1 FROM public.bookings b
       JOIN public.vehicles v ON v.id = b.vehicle_id
       WHERE v.owner_id = OLD.owner_id AND b.payment_mode = 'ONLINE'
         AND b.payment_status IN ('PENDING', 'VERIFICATION_PENDING')
         AND b.status IN ('PENDING', 'ACCEPTED')
     ) THEN
    RAISE EXCEPTION 'Resolve active online payment requests before deleting the QR code';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_payment_settings_guard ON public.owner_payment_settings;
CREATE TRIGGER owner_payment_settings_guard
  BEFORE INSERT OR UPDATE ON public.owner_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.phase2_guard_payment_settings();

CREATE OR REPLACE FUNCTION public.phase2_guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.role IS DISTINCT FROM OLD.role AND NOT agri_private.is_app_admin()) THEN
    RAISE EXCEPTION 'Profile identity and role cannot be changed by this account';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_phase2_guard_update ON public.profiles;
CREATE TRIGGER profiles_phase2_guard_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.phase2_guard_profile_update();

DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR agri_private.is_app_admin()
    OR agri_private.phase1_can_read_farmer(id)
    OR agri_private.phase2_can_read_owner(id)
  );

ALTER TABLE public.owner_payment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_payment_settings_read_participant ON public.owner_payment_settings;
CREATE POLICY owner_payment_settings_read_participant ON public.owner_payment_settings
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid() OR agri_private.phase2_owner_can_read_qr(owner_id)
  );
DROP POLICY IF EXISTS owner_payment_settings_insert_owner ON public.owner_payment_settings;
CREATE POLICY owner_payment_settings_insert_owner ON public.owner_payment_settings
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = auth.uid() AND agri_private.current_app_role() = 'vehicle_owner'
  );
DROP POLICY IF EXISTS owner_payment_settings_update_owner ON public.owner_payment_settings;
CREATE POLICY owner_payment_settings_update_owner ON public.owner_payment_settings
  FOR UPDATE TO authenticated USING (
    owner_id = auth.uid() AND agri_private.current_app_role() = 'vehicle_owner'
  ) WITH CHECK (
    owner_id = auth.uid() AND agri_private.current_app_role() = 'vehicle_owner'
  );
GRANT SELECT, INSERT, UPDATE ON public.owner_payment_settings TO authenticated;

DROP POLICY IF EXISTS owner_qr_read_private ON storage.objects;
CREATE POLICY owner_qr_read_private ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'owner-payment-qr'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR CASE
        WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN agri_private.phase2_owner_can_read_qr(split_part(name, '/', 1)::uuid)
        ELSE false
      END
    )
  );
DROP POLICY IF EXISTS owner_qr_insert_own ON storage.objects;
CREATE POLICY owner_qr_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'owner-payment-qr'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND agri_private.current_app_role() = 'vehicle_owner'
  );
DROP POLICY IF EXISTS owner_qr_update_own ON storage.objects;
CREATE POLICY owner_qr_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'owner-payment-qr' AND split_part(name, '/', 1) = auth.uid()::text
    AND agri_private.current_app_role() = 'vehicle_owner'
  )
  WITH CHECK (
    bucket_id = 'owner-payment-qr' AND split_part(name, '/', 1) = auth.uid()::text
    AND agri_private.current_app_role() = 'vehicle_owner'
  );
DROP POLICY IF EXISTS owner_qr_delete_own ON storage.objects;
CREATE POLICY owner_qr_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'owner-payment-qr' AND split_part(name, '/', 1) = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.owner_payment_settings s
      JOIN public.bookings b ON b.payment_mode = 'ONLINE'
      JOIN public.vehicles v ON v.id = b.vehicle_id AND v.owner_id = s.owner_id
      WHERE s.owner_id = auth.uid() AND s.qr_storage_path = name
        AND b.status IN ('PENDING', 'ACCEPTED') AND b.payment_status IN ('PENDING', 'VERIFICATION_PENDING')
    )
  );

DROP POLICY IF EXISTS payment_screenshot_read_participant ON storage.objects;
CREATE POLICY payment_screenshot_read_participant ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-screenshots'
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN agri_private.phase2_can_access_payment_screenshot(split_part(name, '/', 2)::uuid)
      ELSE false
    END
  );
DROP POLICY IF EXISTS payment_screenshot_insert_farmer ON storage.objects;
CREATE POLICY payment_screenshot_insert_farmer ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND agri_private.current_app_role() = 'farmer'
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid() AND b.payment_mode = 'ONLINE'
          AND b.status = 'ACCEPTED' AND b.payment_status IN ('PENDING', 'REJECTED')
      )
      ELSE false
    END
  );
DROP POLICY IF EXISTS payment_screenshot_delete_farmer ON storage.objects;
CREATE POLICY payment_screenshot_delete_farmer ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid()
          AND b.payment_screenshot_path IS DISTINCT FROM name
          AND b.payment_status IN ('PENDING', 'VERIFICATION_PENDING', 'REJECTED')
      )
      ELSE false
    END
  );
DROP POLICY IF EXISTS payment_screenshot_replace_rejected ON storage.objects;
CREATE POLICY payment_screenshot_replace_rejected ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid() AND b.status = 'ACCEPTED'
          AND b.payment_mode = 'ONLINE' AND b.payment_status = 'REJECTED'
      )
      ELSE false
    END
  )
  WITH CHECK (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid() AND b.status = 'ACCEPTED'
          AND b.payment_mode = 'ONLINE' AND b.payment_status = 'REJECTED'
      )
      ELSE false
    END
  );
DROP POLICY IF EXISTS payment_screenshot_replace_unsubmitted_orphan ON storage.objects;
CREATE POLICY payment_screenshot_replace_unsubmitted_orphan ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid() AND b.status = 'ACCEPTED'
          AND b.payment_mode = 'ONLINE' AND b.payment_status = 'PENDING'
          AND b.payment_screenshot_path IS DISTINCT FROM name
      )
      ELSE false
    END
  )
  WITH CHECK (
    bucket_id = 'payment-screenshots'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND CASE
      WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = split_part(name, '/', 2)::uuid
          AND b.farmer_id = auth.uid() AND b.status = 'ACCEPTED'
          AND b.payment_mode = 'ONLINE' AND b.payment_status = 'PENDING'
      )
      ELSE false
    END
  );

DROP POLICY IF EXISTS phase2_owner_qr_access_boundary ON storage.objects;
CREATE POLICY phase2_owner_qr_access_boundary ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'owner-payment-qr'
    OR CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN split_part(name, '/', 1) = auth.uid()::text
        OR agri_private.phase2_owner_can_read_qr(split_part(name, '/', 1)::uuid)
      ELSE false
    END
  )
  WITH CHECK (
    bucket_id <> 'owner-payment-qr'
    OR (
      agri_private.current_app_role() = 'vehicle_owner'
      AND split_part(name, '/', 1) = auth.uid()::text
      AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );

DROP POLICY IF EXISTS phase2_payment_screenshot_access_boundary ON storage.objects;
CREATE POLICY phase2_payment_screenshot_access_boundary ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'payment-screenshots'
    OR agri_private.phase2_screenshot_path_access(name)
  )
  WITH CHECK (
    bucket_id <> 'payment-screenshots'
    OR agri_private.phase2_screenshot_upload_allowed(name)
    OR agri_private.phase2_screenshot_replace_allowed(name)
  );

DROP POLICY IF EXISTS phase2_payment_storage_anon_deny ON storage.objects;
CREATE POLICY phase2_payment_storage_anon_deny ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id NOT IN ('owner-payment-qr', 'payment-screenshots'))
  WITH CHECK (bucket_id NOT IN ('owner-payment-qr', 'payment-screenshots'));

CREATE OR REPLACE FUNCTION public.phase2_guard_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_vehicle uuid := COALESCE(OLD.vehicle_id, (
    SELECT j.vehicle_id FROM public.journeys j WHERE j.id = OLD.journey_id
  ));
  actor_role text := agri_private.current_app_role();
  retention integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.journey_id IS DISTINCT FROM OLD.journey_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id
     OR NEW.cargo_description IS DISTINCT FROM OLD.cargo_description
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.pickup_location IS DISTINCT FROM OLD.pickup_location
     OR NEW.destination IS DISTINCT FROM OLD.destination
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
     OR NEW.additional_note IS DISTINCT FROM OLD.additional_note
     OR NEW.pickup_latitude IS DISTINCT FROM OLD.pickup_latitude
     OR NEW.pickup_longitude IS DISTINCT FROM OLD.pickup_longitude
     OR NEW.destination_latitude IS DISTINCT FROM OLD.destination_latitude
     OR NEW.destination_longitude IS DISTINCT FROM OLD.destination_longitude
     OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
     OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount THEN
    RAISE EXCEPTION 'Booking details cannot be changed after submission';
  END IF;

  IF actor_role = 'admin' AND agri_private.is_app_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF actor_role = 'vehicle_owner' AND agri_private.phase1_owns_vehicle(target_vehicle) THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('ACCEPTED', 'REJECTED')
         OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
         OR NEW.payment_screenshot_path IS DISTINCT FROM OLD.payment_screenshot_path
         OR NEW.payment_transaction_id IS DISTINCT FROM OLD.payment_transaction_id
         OR NEW.payment_submitted_at IS DISTINCT FROM OLD.payment_submitted_at
         OR NEW.payment_approved_at IS DISTINCT FROM OLD.payment_approved_at
         OR NEW.payment_delete_at IS DISTINCT FROM OLD.payment_delete_at
         OR NEW.payment_deleted_at IS DISTINCT FROM OLD.payment_deleted_at THEN
        RAISE EXCEPTION 'Only pending booking requests can be accepted or rejected';
      END IF;
      IF NEW.status = 'ACCEPTED' AND NEW.payment_mode = 'ONLINE'
         AND NOT EXISTS (
           SELECT 1 FROM public.owner_payment_settings s
           WHERE s.owner_id = (SELECT v.owner_id FROM public.vehicles v WHERE v.id = target_vehicle)
             AND s.qr_storage_path IS NOT NULL
         ) THEN
        RAISE EXCEPTION 'Add a QR code before accepting an online-payment booking';
      END IF;
    ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      IF NEW.payment_status = 'COMPLETED' AND OLD.payment_mode = 'CASH'
         AND OLD.status = 'ACCEPTED'
         AND EXISTS (
           SELECT 1 FROM public.trips t
           WHERE t.booking_id = OLD.id AND t.status IN ('ON_JOURNEY', 'COMPLETED')
         ) THEN
        NEW.payment_approved_at := now();
      ELSIF OLD.payment_status = 'VERIFICATION_PENDING'
         AND NEW.payment_status IN ('COMPLETED', 'REJECTED') THEN
        SELECT retention_hours INTO retention
        FROM public.payment_screenshot_policy WHERE singleton;
        IF retention IS NULL THEN
          RAISE EXCEPTION 'Payment screenshot retention policy is not configured';
        END IF;
        IF NEW.payment_status = 'COMPLETED' THEN
          NEW.payment_approved_at := now();
          NEW.payment_delete_at := NEW.payment_approved_at + make_interval(hours => retention);
        ELSE
          NEW.payment_approved_at := NULL;
          NEW.payment_delete_at := NULL;
        END IF;
      ELSE
        RAISE EXCEPTION 'Invalid payment verification transition';
      END IF;
    ELSE
      IF NEW.payment_screenshot_path IS DISTINCT FROM OLD.payment_screenshot_path
         OR NEW.payment_transaction_id IS DISTINCT FROM OLD.payment_transaction_id
         OR NEW.payment_submitted_at IS DISTINCT FROM OLD.payment_submitted_at
         OR NEW.payment_approved_at IS DISTINCT FROM OLD.payment_approved_at
         OR NEW.payment_delete_at IS DISTINCT FROM OLD.payment_delete_at
         OR NEW.payment_deleted_at IS DISTINCT FROM OLD.payment_deleted_at THEN
        RAISE EXCEPTION 'Payment evidence can only be submitted by its farmer';
      END IF;
    END IF;
  ELSIF actor_role = 'farmer' AND OLD.farmer_id = auth.uid() THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Farmers cannot change booking status';
    END IF;
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      IF OLD.status <> 'ACCEPTED' OR OLD.payment_mode <> 'ONLINE'
         OR OLD.payment_status NOT IN ('PENDING', 'REJECTED')
         OR NEW.payment_status <> 'VERIFICATION_PENDING'
         OR NEW.payment_screenshot_path IS NULL
         OR NEW.payment_screenshot_path NOT LIKE auth.uid()::text || '/' || OLD.id::text || '/%'
         OR char_length(COALESCE(NEW.payment_transaction_id, '')) > 160
         OR NEW.payment_approved_at IS NOT NULL
         OR NEW.payment_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Submit payment evidence only for an accepted online booking';
      END IF;
      NEW.payment_submitted_at := now();
      NEW.payment_approved_at := NULL;
      NEW.payment_delete_at := NULL;
      NEW.payment_deleted_at := NULL;
    ELSE
      IF NEW.payment_screenshot_path IS DISTINCT FROM OLD.payment_screenshot_path
         OR NEW.payment_transaction_id IS DISTINCT FROM OLD.payment_transaction_id
         OR NEW.payment_submitted_at IS DISTINCT FROM OLD.payment_submitted_at
         OR NEW.payment_approved_at IS DISTINCT FROM OLD.payment_approved_at
         OR NEW.payment_delete_at IS DISTINCT FROM OLD.payment_delete_at
         OR NEW.payment_deleted_at IS DISTINCT FROM OLD.payment_deleted_at THEN
        RAISE EXCEPTION 'Payment details can only change when submitting new evidence';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'You cannot update this booking';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_guard_update ON public.bookings;
CREATE TRIGGER bookings_guard_update
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase2_guard_booking_update();

CREATE OR REPLACE FUNCTION public.phase2_validate_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.pickup_latitude IS NULL OR NEW.pickup_longitude IS NULL
     OR NEW.destination_latitude IS NULL OR NEW.destination_longitude IS NULL THEN
    RAISE EXCEPTION 'Select both pickup and destination points on the map';
  END IF;
  IF NEW.payment_mode NOT IN ('CASH', 'ONLINE') THEN
    RAISE EXCEPTION 'Select a valid payment mode';
  END IF;
  IF NEW.payment_mode = 'ONLINE'
     AND NOT EXISTS (
       SELECT 1 FROM public.vehicles v
       JOIN public.owner_payment_settings s ON s.owner_id = v.owner_id
       WHERE v.id = NEW.vehicle_id AND s.qr_storage_path IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'This vehicle owner has not configured online payment';
  END IF;
  NEW.payment_status := 'PENDING';
  NEW.payment_screenshot_path := NULL;
  NEW.payment_transaction_id := NULL;
  NEW.payment_submitted_at := NULL;
  NEW.payment_approved_at := NULL;
  NEW.payment_delete_at := NULL;
  NEW.payment_deleted_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_phase2_validate_insert ON public.bookings;
CREATE TRIGGER bookings_phase2_validate_insert
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase2_validate_booking_insert();

DROP POLICY IF EXISTS bookings_participant_update ON public.bookings;
CREATE POLICY bookings_participant_update ON public.bookings FOR UPDATE TO authenticated
  USING (
    farmer_id = auth.uid() OR agri_private.is_app_admin()
    OR agri_private.phase1_owns_vehicle(vehicle_id) OR agri_private.owns_journey(journey_id)
  )
  WITH CHECK (
    farmer_id = auth.uid() OR agri_private.is_app_admin()
    OR agri_private.phase1_owns_vehicle(vehicle_id) OR agri_private.owns_journey(journey_id)
  );

CREATE OR REPLACE FUNCTION public.phase2_notify_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_owner uuid;
BEGIN
  SELECT v.owner_id INTO target_owner
  FROM public.vehicles v WHERE v.id = NEW.vehicle_id;

  IF TG_OP = 'UPDATE' AND NEW.status = 'ACCEPTED'
     AND OLD.status = 'PENDING' AND NEW.payment_mode = 'ONLINE' THEN
    INSERT INTO public.notifications(user_id, title, message, booking_id)
    VALUES (NEW.farmer_id, 'ऑनलाइन पेमेंटसाठी QR उपलब्ध', 'मालकाचा QR कोड आरक्षण तपशीलात उपलब्ध आहे.', NEW.id);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'VERIFICATION_PENDING' THEN
      INSERT INTO public.notifications(user_id, title, message, booking_id)
      VALUES
        (target_owner, 'पेमेंट स्क्रीनशॉट मिळाला', 'शेतकऱ्याने पेमेंटचा स्क्रीनशॉट पाठवला आहे.', NEW.id),
        (target_owner, 'पेमेंट तपासणी आवश्यक', 'पेमेंट पुरावा तपासून स्वीकारा किंवा नाकारा.', NEW.id);
    ELSIF NEW.payment_status = 'COMPLETED' THEN
      INSERT INTO public.notifications(user_id, title, message, booking_id)
      VALUES
        (NEW.farmer_id, 'पेमेंट पूर्ण झाले', 'तुमचे पेमेंट पूर्ण म्हणून नोंदवले आहे.', NEW.id),
        (target_owner, 'पेमेंट पूर्ण झाले', 'आरक्षणाचे पेमेंट पूर्ण झाले आहे.', NEW.id);
    ELSIF NEW.payment_status = 'REJECTED' THEN
      INSERT INTO public.notifications(user_id, title, message, booking_id)
      VALUES (NEW.farmer_id, 'पेमेंट नाकारले', 'पेमेंटचा पुरावा तपासून नाकारला आहे. तपशील तपासा आणि पुन्हा पाठवा.', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_sync_trip_vehicle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_vehicle_status text;
BEGIN
  next_vehicle_status := CASE NEW.status
    WHEN 'RESERVED' THEN 'RESERVED'
    WHEN 'ON_JOURNEY' THEN 'ON_JOURNEY'
    ELSE 'COMPLETED'
  END;

  UPDATE public.vehicles
  SET availability_status = next_vehicle_status
  WHERE id = NEW.vehicle_id
    AND availability_status IS DISTINCT FROM next_vehicle_status;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, title, message, booking_id)
    SELECT farmer_id,
      CASE NEW.status WHEN 'ON_JOURNEY' THEN 'प्रवास सुरू झाला' ELSE 'प्रवास पूर्ण झाला' END,
      'तुमच्या प्रवासाची स्थिती: ' ||
        CASE NEW.status WHEN 'ON_JOURNEY' THEN 'प्रवासात' ELSE 'प्रवास पूर्ण' END || '.',
      NEW.booking_id
    FROM public.bookings WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_phase2_notify_payment ON public.bookings;
CREATE TRIGGER bookings_phase2_notify_payment
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase2_notify_payment();

CREATE OR REPLACE FUNCTION public.phase2_update_screenshot_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  retention integer;
BEGIN
  IF NEW.payment_status = 'COMPLETED'
     AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
     AND NEW.payment_mode = 'ONLINE'
     AND NEW.payment_screenshot_path IS NOT NULL THEN
    SELECT retention_hours INTO retention
    FROM public.payment_screenshot_policy WHERE singleton;
    IF retention IS NULL THEN
      RAISE EXCEPTION 'Payment screenshot retention policy is not configured';
    END IF;
    NEW.payment_approved_at := COALESCE(NEW.payment_approved_at, now());
    NEW.payment_delete_at := NEW.payment_approved_at + make_interval(hours => retention);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_phase2_screenshot_retention ON public.bookings;
CREATE TRIGGER bookings_phase2_screenshot_retention
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase2_update_screenshot_retention();
