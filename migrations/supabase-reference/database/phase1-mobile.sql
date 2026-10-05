-- Apply after schema.sql and transport-schema.sql.
-- Adds the direct vehicle-booking workflow while preserving existing records.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS driver_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS driver_mobile text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'AVAILABLE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_phase1_availability_status_check'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_phase1_availability_status_check
      CHECK (availability_status IN ('AVAILABLE', 'RESERVED', 'ON_JOURNEY', 'COMPLETED'));
  END IF;
END;
$$;

ALTER TABLE public.bookings
  ALTER COLUMN journey_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pickup_location text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS booking_date date,
  ADD COLUMN IF NOT EXISTS booking_time time,
  ADD COLUMN IF NOT EXISTS additional_note text;

CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'ON_JOURNEY', 'COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_phase1_search
  ON public.vehicles(availability_status, is_active, vehicle_type, capacity);
CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_status
  ON public.bookings(vehicle_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_owner_created
  ON public.trips(owner_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.phase1_owns_vehicle(target_vehicle uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles
    WHERE id = target_vehicle AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.phase1_can_read_farmer(target_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.vehicles v ON v.id = b.vehicle_id
    WHERE b.farmer_id = target_profile AND v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.journeys j ON j.id = b.journey_id
    WHERE b.farmer_id = target_profile AND j.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.farmer_has_vehicle_booking(target_vehicle uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE vehicle_id = target_vehicle AND farmer_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.journeys j
    JOIN public.bookings b ON b.journey_id = j.id
    WHERE j.vehicle_id = target_vehicle AND b.farmer_id = auth.uid()
  );
$$;

CREATE SCHEMA IF NOT EXISTS agri_private;
REVOKE ALL ON SCHEMA agri_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA agri_private TO authenticated;

CREATE OR REPLACE FUNCTION agri_private.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION agri_private.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(agri_private.current_app_role() = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION agri_private.phase1_owns_vehicle(target_vehicle uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles v WHERE v.id = target_vehicle AND v.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.phase1_can_read_farmer(target_profile uuid)
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
    WHERE b.farmer_id = target_profile AND v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.journeys j ON j.id = b.journey_id
    WHERE b.farmer_id = target_profile AND j.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.farmer_has_vehicle_booking(target_vehicle uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.vehicle_id = target_vehicle AND b.farmer_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.journeys j
    JOIN public.bookings b ON b.journey_id = j.id
    WHERE j.vehicle_id = target_vehicle AND b.farmer_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.owns_journey(target_journey uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journeys j WHERE j.id = target_journey AND j.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.has_journey_booking(target_journey uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.journey_id = target_journey AND b.farmer_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION agri_private.journey_is_available(target_journey uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journeys j
    JOIN public.vehicles v ON v.id = j.vehicle_id
    WHERE j.id = target_journey AND j.status = 'AVAILABLE'
      AND j.departure_date >= CURRENT_DATE AND v.is_active
  );
$$;

REVOKE ALL ON FUNCTION agri_private.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.is_app_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase1_owns_vehicle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.phase1_can_read_farmer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.farmer_has_vehicle_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.owns_journey(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.has_journey_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION agri_private.journey_is_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agri_private.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase1_owns_vehicle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.phase1_can_read_farmer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.farmer_has_vehicle_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.owns_journey(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.has_journey_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION agri_private.journey_is_available(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_vehicle_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.vehicle_number IS DISTINCT FROM OLD.vehicle_number
     OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
     OR NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.driver_mobile IS DISTINCT FROM OLD.driver_mobile THEN
    IF btrim(NEW.vehicle_number) = '' OR btrim(NEW.vehicle_type) = ''
       OR btrim(NEW.driver_name) = ''
       OR length(regexp_replace(NEW.driver_mobile, '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 15 THEN
      RAISE EXCEPTION 'Vehicle number, type, driver name, and a valid mobile number are required';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.capacity < (
      SELECT COALESCE(sum(quantity), 0)
      FROM public.bookings
      WHERE vehicle_id = OLD.id
        AND (
          status = 'PENDING'
          OR (
            status = 'ACCEPTED'
            AND NOT EXISTS (
              SELECT 1 FROM public.trips
              WHERE trips.booking_id = bookings.id AND trips.status = 'COMPLETED'
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Vehicle capacity cannot be less than active booking weight';
    END IF;

    IF NEW.availability_status IS DISTINCT FROM OLD.availability_status
       AND NOT (
         (OLD.availability_status = 'COMPLETED' AND NEW.availability_status = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1 FROM public.trips
            WHERE vehicle_id = OLD.id AND status IN ('RESERVED', 'ON_JOURNEY')
          ))
         OR
         (NEW.availability_status = 'RESERVED'
          AND EXISTS (SELECT 1 FROM public.trips WHERE vehicle_id = OLD.id AND status = 'RESERVED')
          AND NOT EXISTS (SELECT 1 FROM public.trips WHERE vehicle_id = OLD.id AND status = 'ON_JOURNEY'))
         OR
         (NEW.availability_status = 'ON_JOURNEY'
          AND EXISTS (SELECT 1 FROM public.trips WHERE vehicle_id = OLD.id AND status = 'ON_JOURNEY'))
         OR
         (NEW.availability_status = 'COMPLETED'
          AND EXISTS (SELECT 1 FROM public.trips WHERE vehicle_id = OLD.id AND status = 'COMPLETED')
          AND NOT EXISTS (
            SELECT 1 FROM public.trips
            WHERE vehicle_id = OLD.id AND status IN ('RESERVED', 'ON_JOURNEY')
          ))
       ) THEN
      RAISE EXCEPTION 'Vehicle availability status must follow an accepted booking or trip';
    END IF;

    IF NOT NEW.is_active AND NEW.availability_status IN ('RESERVED', 'ON_JOURNEY') THEN
      RAISE EXCEPTION 'A reserved or active-journey vehicle cannot be made unavailable';
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_validate_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_vehicle public.vehicles%ROWTYPE;
  requested_capacity numeric;
BEGIN
  IF NEW.vehicle_id IS NULL
     OR NEW.pickup_location IS NULL OR btrim(NEW.pickup_location) = ''
     OR NEW.destination IS NULL OR btrim(NEW.destination) = ''
     OR NEW.booking_date IS NULL OR NEW.booking_time IS NULL
     OR NEW.cargo_description IS NULL OR btrim(NEW.cargo_description) = ''
     OR NEW.quantity <= 0 OR NEW.booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Complete all required booking details with a positive weight and a current or future date';
  END IF;

  IF auth.uid() IS NULL OR NEW.farmer_id <> auth.uid()
     OR agri_private.current_app_role() <> 'farmer' THEN
    RAISE EXCEPTION 'Only a farmer can create a booking for their own account';
  END IF;

  SELECT * INTO target_vehicle
  FROM public.vehicles
  WHERE id = NEW.vehicle_id
  FOR UPDATE;

  IF target_vehicle.id IS NULL OR NOT target_vehicle.is_active
     OR target_vehicle.availability_status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'This vehicle is no longer available';
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO requested_capacity
  FROM public.bookings
  WHERE vehicle_id = NEW.vehicle_id
    AND (
      status = 'PENDING'
      OR (
        status = 'ACCEPTED'
        AND NOT EXISTS (
          SELECT 1 FROM public.trips
          WHERE trips.booking_id = bookings.id AND trips.status = 'COMPLETED'
        )
      )
    );

  IF requested_capacity + NEW.quantity > target_vehicle.capacity THEN
    RAISE EXCEPTION 'The requested weight exceeds this vehicle capacity';
  END IF;
  IF lower(btrim(NEW.pickup_location)) = lower(btrim(NEW.destination)) THEN
    RAISE EXCEPTION 'Pickup and destination must be different';
  END IF;

  NEW.status := 'PENDING';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_guard_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_vehicle uuid := COALESCE(OLD.vehicle_id, (
    SELECT vehicle_id FROM public.journeys WHERE id = OLD.journey_id
  ));
  actor_role text := agri_private.current_app_role();
BEGIN
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.journey_id IS DISTINCT FROM OLD.journey_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id
     OR NEW.cargo_description IS DISTINCT FROM OLD.cargo_description
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.pickup_location IS DISTINCT FROM OLD.pickup_location
     OR NEW.destination IS DISTINCT FROM OLD.destination
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
     OR NEW.additional_note IS DISTINCT FROM OLD.additional_note THEN
    RAISE EXCEPTION 'Booking details cannot be changed after submission';
  END IF;

  IF actor_role = 'admin' AND agri_private.is_app_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF actor_role <> 'vehicle_owner' OR NOT agri_private.phase1_owns_vehicle(target_vehicle)
     OR OLD.status <> 'PENDING' OR NEW.status NOT IN ('ACCEPTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Only the vehicle owner can accept or reject a pending booking';
  END IF;

  IF NEW.status = 'ACCEPTED' THEN
    PERFORM 1 FROM public.vehicles
    WHERE id = target_vehicle AND is_active AND availability_status = 'AVAILABLE'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This vehicle has already been reserved or is unavailable';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_notify_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_vehicle uuid := COALESCE(NEW.vehicle_id, (
    SELECT vehicle_id FROM public.journeys WHERE id = NEW.journey_id
  ));
  target_owner uuid;
BEGIN
  SELECT owner_id INTO target_owner FROM public.vehicles WHERE id = target_vehicle;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, title, message, booking_id)
    VALUES (target_owner, 'नवीन आरक्षण विनंती', 'तुमच्या वाहनासाठी नवीन आरक्षण विनंती आली आहे.', NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, title, message, booking_id)
    VALUES (
      NEW.farmer_id,
      CASE NEW.status WHEN 'ACCEPTED' THEN 'आरक्षण स्वीकारले' ELSE 'आरक्षण नाकारले' END,
      CASE NEW.status WHEN 'ACCEPTED' THEN 'वाहनमालकाने तुमची आरक्षण विनंती स्वीकारली.' ELSE 'वाहनमालकाने तुमची आरक्षण विनंती नाकारली.' END,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_validate_trip_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Trip details cannot be changed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'RESERVED' AND NEW.status = 'ON_JOURNEY' THEN
      RETURN NEW;
    ELSIF OLD.status = 'ON_JOURNEY' AND NEW.status = 'COMPLETED' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invalid trip status transition';
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
    SELECT farmer_id, 'प्रवासाची स्थिती बदलली', 'तुमच्या प्रवासाची स्थिती: ' ||
      CASE NEW.status WHEN 'ON_JOURNEY' THEN 'प्रवासात' ELSE 'प्रवास पूर्ण' END || '.',
      NEW.booking_id
    FROM public.bookings WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase1_create_trip_for_accepted_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vehicle_owner uuid;
BEGIN
  IF OLD.status = 'PENDING' AND NEW.status = 'ACCEPTED' AND NEW.vehicle_id IS NOT NULL THEN
    SELECT owner_id INTO vehicle_owner FROM public.vehicles WHERE id = NEW.vehicle_id;
    INSERT INTO public.trips (booking_id, vehicle_id, owner_id, status)
    VALUES (NEW.id, NEW.vehicle_id, vehicle_owner, 'RESERVED');
    UPDATE public.bookings
    SET status = 'REJECTED'
    WHERE vehicle_id = NEW.vehicle_id
      AND id <> NEW.id
      AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_phase1_write_guard ON public.vehicles;
CREATE TRIGGER vehicles_phase1_write_guard
  BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.phase1_vehicle_write_guard();

DROP TRIGGER IF EXISTS bookings_validate_insert ON public.bookings;
CREATE TRIGGER bookings_validate_insert
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase1_validate_booking_insert();
DROP TRIGGER IF EXISTS bookings_guard_update ON public.bookings;
CREATE TRIGGER bookings_guard_update
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_booking_update();
DROP TRIGGER IF EXISTS bookings_notify_insert ON public.bookings;
CREATE TRIGGER bookings_notify_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase1_notify_booking();
DROP TRIGGER IF EXISTS bookings_notify_update ON public.bookings;
CREATE TRIGGER bookings_notify_update
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.phase1_notify_booking();
DROP TRIGGER IF EXISTS bookings_phase1_create_trip ON public.bookings;
CREATE TRIGGER bookings_phase1_create_trip
  AFTER UPDATE ON public.bookings
  FOR EACH ROW WHEN (OLD.status = 'PENDING' AND NEW.status = 'ACCEPTED')
  EXECUTE FUNCTION public.phase1_create_trip_for_accepted_booking();

DROP TRIGGER IF EXISTS trips_updated_at ON public.trips;
CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trips_validate_update ON public.trips;
CREATE TRIGGER trips_validate_update
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.phase1_validate_trip_update();
DROP TRIGGER IF EXISTS trips_sync_vehicle ON public.trips;
CREATE TRIGGER trips_sync_vehicle
  AFTER INSERT OR UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.phase1_sync_trip_vehicle();

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR agri_private.is_app_admin() OR agri_private.phase1_can_read_farmer(id));
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR agri_private.is_app_admin())
  WITH CHECK (id = auth.uid() OR agri_private.is_app_admin());

DROP POLICY IF EXISTS vehicles_read_available_or_owned ON public.vehicles;
CREATE POLICY vehicles_read_available_or_owned ON public.vehicles FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid() OR agri_private.is_app_admin()
    OR (is_active AND availability_status = 'AVAILABLE' AND agri_private.current_app_role() = 'farmer')
    OR agri_private.farmer_has_vehicle_booking(id)
  );
DROP POLICY IF EXISTS vehicles_owner_insert ON public.vehicles;
CREATE POLICY vehicles_owner_insert ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND agri_private.current_app_role() = 'vehicle_owner');
DROP POLICY IF EXISTS vehicles_owner_update ON public.vehicles;
CREATE POLICY vehicles_owner_update ON public.vehicles FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR agri_private.is_app_admin())
  WITH CHECK (owner_id = auth.uid() OR agri_private.is_app_admin());
DROP POLICY IF EXISTS vehicles_owner_delete ON public.vehicles;
CREATE POLICY vehicles_owner_delete ON public.vehicles FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR agri_private.is_app_admin());

DROP POLICY IF EXISTS journeys_read_available_or_related ON public.journeys;
CREATE POLICY journeys_read_available_or_related ON public.journeys FOR SELECT TO authenticated
  USING (
    agri_private.journey_is_available(id) OR owner_id = auth.uid() OR agri_private.is_app_admin()
    OR agri_private.has_journey_booking(id)
  );
DROP POLICY IF EXISTS journeys_owner_insert ON public.journeys;
CREATE POLICY journeys_owner_insert ON public.journeys FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND agri_private.current_app_role() = 'vehicle_owner');
DROP POLICY IF EXISTS journeys_owner_update ON public.journeys;
CREATE POLICY journeys_owner_update ON public.journeys FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR agri_private.is_app_admin())
  WITH CHECK (owner_id = auth.uid() OR agri_private.is_app_admin());
DROP POLICY IF EXISTS journeys_owner_delete ON public.journeys;
CREATE POLICY journeys_owner_delete ON public.journeys FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR agri_private.is_app_admin());

DROP POLICY IF EXISTS bookings_read_participants ON public.bookings;
CREATE POLICY bookings_read_participants ON public.bookings FOR SELECT TO authenticated
  USING (
    farmer_id = auth.uid() OR agri_private.is_app_admin()
    OR agri_private.phase1_owns_vehicle(vehicle_id) OR agri_private.owns_journey(journey_id)
  );
DROP POLICY IF EXISTS bookings_farmer_insert ON public.bookings;
CREATE POLICY bookings_farmer_insert ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (
    farmer_id = auth.uid() AND agri_private.current_app_role() = 'farmer'
    AND vehicle_id IS NOT NULL
  );
DROP POLICY IF EXISTS bookings_participant_update ON public.bookings;
CREATE POLICY bookings_participant_update ON public.bookings FOR UPDATE TO authenticated
  USING (
    agri_private.is_app_admin() OR agri_private.phase1_owns_vehicle(vehicle_id)
    OR agri_private.owns_journey(journey_id)
  )
  WITH CHECK (
    agri_private.is_app_admin() OR agri_private.phase1_owns_vehicle(vehicle_id)
    OR agri_private.owns_journey(journey_id)
  );

DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR agri_private.is_app_admin());
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR agri_private.is_app_admin())
  WITH CHECK (user_id = auth.uid() OR agri_private.is_app_admin());

DROP POLICY IF EXISTS trips_read_participants ON public.trips;
CREATE POLICY trips_read_participants ON public.trips FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid() OR agri_private.is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public.bookings
      WHERE bookings.id = trips.booking_id AND bookings.farmer_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS trips_owner_update ON public.trips;
CREATE POLICY trips_owner_update ON public.trips FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR agri_private.is_app_admin())
  WITH CHECK (owner_id = auth.uid() OR agri_private.is_app_admin());
DROP POLICY IF EXISTS trips_owner_insert ON public.trips;
CREATE POLICY trips_owner_insert ON public.trips FOR INSERT TO authenticated
  WITH CHECK (agri_private.is_app_admin());

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['farmers','traders','products','unit_conversions','stock_in','stock_out','daily_balance','ledger_entries']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_admin_only', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (agri_private.is_app_admin()) WITH CHECK (agri_private.is_app_admin())',
      tbl || '_admin_only',
      tbl
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.trips TO authenticated;
REVOKE ALL ON FUNCTION public.phase1_owns_vehicle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.phase1_owns_vehicle(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.phase1_can_read_farmer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.phase1_can_read_farmer(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.farmer_has_vehicle_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.farmer_has_vehicle_booking(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.owns_journey(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_journey_booking(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vehicle_has_available_journey(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.journey_is_available(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.journey_can_accept_booking(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon, authenticated;
