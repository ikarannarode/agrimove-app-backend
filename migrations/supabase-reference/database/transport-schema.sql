-- Apply after schema.sql. Adds the transport marketplace without removing legacy data.
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_role text;
BEGIN
  SELECT p.role INTO app_role FROM public.profiles p WHERE p.id = auth.uid();
  RETURN app_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(public.current_app_role() = 'admin', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.owns_journey(target_journey uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.journeys
    WHERE id = target_journey AND owner_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_journey_booking(target_journey uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = target_journey AND farmer_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_has_available_journey(target_vehicle uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.journeys
    WHERE vehicle_id = target_vehicle AND status = 'AVAILABLE'
      AND departure_date >= CURRENT_DATE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_has_vehicle_booking(target_vehicle uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.journeys j
    JOIN public.bookings b ON b.journey_id = j.id
    WHERE j.vehicle_id = target_vehicle AND b.farmer_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.journey_is_available(target_journey uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.journeys j
    JOIN public.vehicles v ON v.id = j.vehicle_id
    WHERE j.id = target_journey
      AND j.status = 'AVAILABLE'
      AND j.departure_date >= CURRENT_DATE
      AND v.is_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.journey_can_accept_booking(target_journey uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.journeys j
    JOIN public.vehicles v ON v.id = j.vehicle_id
    WHERE j.id = target_journey
      AND j.status IN ('AVAILABLE', 'BOOKED')
      AND j.departure_date >= CURRENT_DATE
      AND v.is_active
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'farmer'
    CHECK (role IN ('farmer', 'vehicle_owner', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_number text NOT NULL,
  vehicle_type text NOT NULL,
  capacity numeric(12, 2) NOT NULL CHECK (capacity > 0),
  capacity_unit text NOT NULL DEFAULT 'kg',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_number)
);

CREATE TABLE IF NOT EXISTS public.journeys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  source text NOT NULL,
  destination text NOT NULL,
  departure_date date NOT NULL,
  available_capacity numeric(12, 2) NOT NULL CHECK (available_capacity > 0),
  status text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'BOOKED', 'ON_JOURNEY', 'COMPLETED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lower(source) <> lower(destination))
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE RESTRICT,
  farmer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cargo_description text NOT NULL,
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  journey_id uuid REFERENCES public.journeys(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.search_available_journeys(
  p_source text DEFAULT NULL,
  p_destination text DEFAULT NULL,
  p_departure_date date DEFAULT NULL,
  p_vehicle_type text DEFAULT NULL,
  p_min_capacity numeric DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  vehicle_id uuid,
  source text,
  destination text,
  departure_date date,
  available_capacity numeric,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  remaining_capacity numeric,
  vehicle_number text,
  vehicle_type text,
  capacity_unit text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() <> 'farmer' THEN
    RAISE EXCEPTION 'Only farmer accounts can search available journeys';
  END IF;
  IF p_min_capacity IS NOT NULL AND p_min_capacity <= 0 THEN
    RAISE EXCEPTION 'Minimum capacity must be positive';
  END IF;

  RETURN QUERY
  SELECT
    j.id, j.vehicle_id, j.source, j.destination, j.departure_date,
    j.available_capacity, j.status, j.notes, j.created_at, j.updated_at,
    j.available_capacity - COALESCE((
      SELECT sum(b.quantity)
      FROM public.bookings b
      WHERE b.journey_id = j.id AND b.status IN ('PENDING', 'ACCEPTED')
    ), 0) AS remaining_capacity,
    v.vehicle_number, v.vehicle_type, v.capacity_unit
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id AND v.is_active
  WHERE j.status = 'AVAILABLE'
    AND j.departure_date >= CURRENT_DATE
    AND (p_source IS NULL OR j.source ILIKE '%' || p_source || '%')
    AND (p_destination IS NULL OR j.destination ILIKE '%' || p_destination || '%')
    AND (p_departure_date IS NULL OR j.departure_date = p_departure_date)
    AND (p_vehicle_type IS NULL OR v.vehicle_type ILIKE '%' || p_vehicle_type || '%')
    AND j.available_capacity - COALESCE((
      SELECT sum(b.quantity)
      FROM public.bookings b
      WHERE b.journey_id = j.id AND b.status IN ('PENDING', 'ACCEPTED')
    ), 0) > 0
    AND (p_min_capacity IS NULL OR j.available_capacity - COALESCE((
      SELECT sum(b.quantity)
      FROM public.bookings b
      WHERE b.journey_id = j.id AND b.status IN ('PENDING', 'ACCEPTED')
    ), 0) >= p_min_capacity);
END;
$$;

CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON public.vehicles(owner_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_type_capacity ON public.vehicles(vehicle_type, capacity);
CREATE INDEX IF NOT EXISTS idx_journeys_search ON public.journeys(status, departure_date, source, destination);
CREATE INDEX IF NOT EXISTS idx_journeys_owner ON public.journeys(owner_id, departure_date DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_farmer ON public.bookings(farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_journey_status ON public.bookings(journey_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text := NEW.raw_user_meta_data ->> 'role';
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
    CASE WHEN requested_role = 'vehicle_owner' THEN 'vehicle_owner' ELSE 'farmer' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_auth_user();

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change account roles';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_journey_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vehicle_owner uuid;
  vehicle_capacity numeric;
  active_vehicle boolean;
BEGIN
  SELECT owner_id, capacity, is_active
  INTO vehicle_owner, vehicle_capacity, active_vehicle
  FROM public.vehicles
  WHERE id = NEW.vehicle_id
  FOR KEY SHARE;

  IF vehicle_owner IS NULL
     OR (NEW.owner_id <> vehicle_owner AND NOT public.is_app_admin())
     OR NEW.available_capacity > vehicle_capacity
     OR (NEW.status = 'AVAILABLE' AND NOT active_vehicle) THEN
    RAISE EXCEPTION 'Journey must use an owned vehicle and fit its capacity';
  END IF;

  IF TG_OP = 'INSERT' AND NOT active_vehicle THEN
    RAISE EXCEPTION 'An unavailable vehicle cannot be assigned to a journey';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.destination IS DISTINCT FROM OLD.destination
       OR NEW.departure_date IS DISTINCT FROM OLD.departure_date
       OR NEW.available_capacity IS DISTINCT FROM OLD.available_capacity)
     AND EXISTS (
       SELECT 1 FROM public.bookings
       WHERE journey_id = OLD.id AND status IN ('PENDING', 'ACCEPTED')
     ) THEN
    RAISE EXCEPTION 'Journey details cannot change while bookings are active';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_app_admin() THEN
    IF NEW.status = 'BOOKED' THEN
      IF OLD.status <> 'AVAILABLE' OR NOT EXISTS (
        SELECT 1 FROM public.bookings
        WHERE journey_id = OLD.id AND status = 'ACCEPTED'
      ) THEN
        RAISE EXCEPTION 'A journey is booked only after a request is accepted';
      END IF;
    ELSIF NEW.status = 'ON_JOURNEY' THEN
      IF OLD.status <> 'BOOKED' THEN
        RAISE EXCEPTION 'Only a booked journey can start';
      END IF;
    ELSIF NEW.status = 'COMPLETED' THEN
      IF OLD.status NOT IN ('ON_JOURNEY', 'AVAILABLE') THEN
        RAISE EXCEPTION 'This journey cannot be completed from its current status';
      END IF;
    ELSIF NEW.status = 'AVAILABLE' THEN
      IF OLD.status <> 'BOOKED' OR EXISTS (
        SELECT 1 FROM public.bookings
        WHERE journey_id = OLD.id AND status IN ('PENDING', 'ACCEPTED')
      ) THEN
        RAISE EXCEPTION 'A journey with active bookings cannot be reopened';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_vehicle_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.journeys j
    WHERE j.vehicle_id = OLD.id
      AND (j.available_capacity > NEW.capacity
        OR NEW.capacity_unit IS DISTINCT FROM OLD.capacity_unit
        OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)
  ) THEN
    RAISE EXCEPTION 'Vehicle capacity, unit, and owner cannot invalidate existing journeys';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_booking_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_journey public.journeys%ROWTYPE;
  booked_capacity numeric;
BEGIN
  SELECT j.* INTO target_journey
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id AND v.is_active
  WHERE j.id = NEW.journey_id
  FOR UPDATE OF j;

  IF target_journey.id IS NULL OR target_journey.status <> 'AVAILABLE'
     OR target_journey.departure_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This journey is no longer available';
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO booked_capacity
  FROM public.bookings
  WHERE journey_id = NEW.journey_id
    AND status IN ('PENDING', 'ACCEPTED');

  IF NEW.quantity + booked_capacity > target_journey.available_capacity THEN
    RAISE EXCEPTION 'The requested quantity exceeds available capacity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journey_owner uuid;
  journey_status text;
  actor_role text := public.current_app_role();
BEGIN
  IF NEW.journey_id IS DISTINCT FROM OLD.journey_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.cargo_description IS DISTINCT FROM OLD.cargo_description THEN
    RAISE EXCEPTION 'Booking details cannot be changed after submission';
  END IF;

  SELECT owner_id, status INTO journey_owner, journey_status
  FROM public.journeys WHERE id = OLD.journey_id;

  IF actor_role = 'farmer' THEN
    IF OLD.status NOT IN ('PENDING', 'ACCEPTED') OR NEW.status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'Farmers can only cancel pending or accepted bookings';
    END IF;
    IF OLD.status = 'ACCEPTED' AND journey_status = 'ON_JOURNEY' THEN
      RAISE EXCEPTION 'An accepted booking cannot be cancelled after the journey starts';
    END IF;
  ELSIF actor_role = 'vehicle_owner' THEN
    IF journey_owner <> auth.uid()
       OR NOT (
         (OLD.status = 'PENDING' AND NEW.status IN ('ACCEPTED', 'REJECTED'))
         OR (OLD.status = 'ACCEPTED' AND NEW.status = 'COMPLETED')
       ) THEN
      RAISE EXCEPTION 'Booking status change is not permitted';
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status = 'ACCEPTED'
       AND NOT public.journey_can_accept_booking(OLD.journey_id) THEN
      RAISE EXCEPTION 'This journey is no longer accepting bookings';
    END IF;
  ELSIF actor_role <> 'admin' THEN
    RAISE EXCEPTION 'Booking status change is not permitted';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_booking_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journey_owner uuid;
BEGIN
  SELECT owner_id INTO journey_owner FROM public.journeys WHERE id = NEW.journey_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, title, message, booking_id, journey_id)
    VALUES (journey_owner, 'New booking request', 'A farmer requested space on your journey.', NEW.id, NEW.journey_id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, title, message, booking_id, journey_id)
    VALUES (
      NEW.farmer_id,
      'Booking ' || lower(NEW.status),
      'Your booking status changed to ' || NEW.status || '.',
      NEW.id,
      NEW.journey_id
    );

    IF NEW.status = 'ACCEPTED' THEN
      UPDATE public.journeys SET status = 'BOOKED' WHERE id = NEW.journey_id AND status = 'AVAILABLE';
    ELSIF NEW.status = 'COMPLETED' AND NOT EXISTS (
      SELECT 1 FROM public.bookings
      WHERE journey_id = NEW.journey_id AND status IN ('PENDING', 'ACCEPTED')
    ) THEN
      UPDATE public.journeys SET status = 'COMPLETED' WHERE id = NEW.journey_id;
    ELSIF NEW.status IN ('REJECTED', 'CANCELLED') AND NOT EXISTS (
      SELECT 1 FROM public.bookings
      WHERE journey_id = NEW.journey_id AND status IN ('PENDING', 'ACCEPTED')
    ) THEN
      UPDATE public.journeys SET status = 'AVAILABLE'
      WHERE id = NEW.journey_id AND status = 'BOOKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_journey_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, title, message, journey_id)
    SELECT farmer_id, 'Journey status updated', 'Journey status changed to ' || NEW.status || '.',
           NEW.id
    FROM public.bookings
    WHERE journey_id = NEW.id AND status IN ('ACCEPTED', 'COMPLETED');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
CREATE TRIGGER profiles_role_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();
DROP TRIGGER IF EXISTS vehicles_updated_at ON public.vehicles;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS vehicles_validate_write ON public.vehicles;
CREATE TRIGGER vehicles_validate_write BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.validate_vehicle_write();
DROP TRIGGER IF EXISTS journeys_updated_at ON public.journeys;
CREATE TRIGGER journeys_updated_at BEFORE UPDATE ON public.journeys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS journeys_validate_write ON public.journeys;
CREATE TRIGGER journeys_validate_write BEFORE INSERT OR UPDATE ON public.journeys FOR EACH ROW EXECUTE FUNCTION public.validate_journey_write();
DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS bookings_validate_insert ON public.bookings;
CREATE TRIGGER bookings_validate_insert BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.validate_booking_request();
DROP TRIGGER IF EXISTS bookings_guard_update ON public.bookings;
CREATE TRIGGER bookings_guard_update BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_update();
DROP TRIGGER IF EXISTS bookings_notify_insert ON public.bookings;
CREATE TRIGGER bookings_notify_insert AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.notify_booking_changes();
DROP TRIGGER IF EXISTS bookings_notify_update ON public.bookings;
CREATE TRIGGER bookings_notify_update AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.notify_booking_changes();
DROP TRIGGER IF EXISTS journeys_notify_status ON public.journeys;
CREATE TRIGGER journeys_notify_status AFTER UPDATE ON public.journeys FOR EACH ROW EXECUTE FUNCTION public.notify_journey_status();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_app_admin());
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_app_admin())
  WITH CHECK (id = auth.uid() OR public.is_app_admin());
DROP POLICY IF EXISTS vehicles_read_available_or_owned ON public.vehicles;
CREATE POLICY vehicles_read_available_or_owned ON public.vehicles FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid() OR public.is_app_admin()
    OR (is_active AND public.vehicle_has_available_journey(id))
    OR public.farmer_has_vehicle_booking(id)
  );
DROP POLICY IF EXISTS vehicles_owner_insert ON public.vehicles;
CREATE POLICY vehicles_owner_insert ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.current_app_role() = 'vehicle_owner');
DROP POLICY IF EXISTS vehicles_owner_update ON public.vehicles;
CREATE POLICY vehicles_owner_update ON public.vehicles FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_app_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_app_admin());
DROP POLICY IF EXISTS vehicles_owner_delete ON public.vehicles;
CREATE POLICY vehicles_owner_delete ON public.vehicles FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS journeys_read_available_or_related ON public.journeys;
CREATE POLICY journeys_read_available_or_related ON public.journeys FOR SELECT TO authenticated
  USING (
    public.journey_is_available(id) OR owner_id = auth.uid() OR public.is_app_admin()
    OR public.has_journey_booking(id)
  );
DROP POLICY IF EXISTS journeys_owner_insert ON public.journeys;
CREATE POLICY journeys_owner_insert ON public.journeys FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.current_app_role() = 'vehicle_owner');
DROP POLICY IF EXISTS journeys_owner_update ON public.journeys;
CREATE POLICY journeys_owner_update ON public.journeys FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_app_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_app_admin());
DROP POLICY IF EXISTS journeys_owner_delete ON public.journeys;
CREATE POLICY journeys_owner_delete ON public.journeys FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS bookings_read_participants ON public.bookings;
CREATE POLICY bookings_read_participants ON public.bookings FOR SELECT TO authenticated
  USING (
    farmer_id = auth.uid() OR public.is_app_admin()
    OR public.owns_journey(journey_id)
  );
DROP POLICY IF EXISTS bookings_farmer_insert ON public.bookings;
CREATE POLICY bookings_farmer_insert ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (
    farmer_id = auth.uid() AND public.current_app_role() = 'farmer'
    AND public.journey_is_available(journey_id)
  );
DROP POLICY IF EXISTS bookings_participant_update ON public.bookings;
CREATE POLICY bookings_participant_update ON public.bookings FOR UPDATE TO authenticated
  USING (
    farmer_id = auth.uid() OR public.is_app_admin()
    OR public.owns_journey(journey_id)
  )
  WITH CHECK (
    farmer_id = auth.uid() OR public.is_app_admin()
    OR public.owns_journey(journey_id)
  );

DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_app_admin());
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_app_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_app_admin());

-- Replace the legacy schema's permissive policies; legacy commission data is admin-only.
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['farmers','traders','products','unit_conversions','stock_in','stock_out','daily_balance','ledger_entries']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin())',
      tbl || '_admin_only',
      tbl
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.vehicles, public.journeys,
  public.bookings, public.notifications TO authenticated;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_journey(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_journey_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vehicle_has_available_journey(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.farmer_has_vehicle_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.journey_is_available(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.journey_can_accept_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_available_journeys(text, text, date, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_journey(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_journey_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_has_available_journey(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farmer_has_vehicle_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journey_is_available(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journey_can_accept_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_available_journeys(text, text, date, text, numeric) TO authenticated;
