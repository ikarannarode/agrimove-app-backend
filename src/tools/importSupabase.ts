import 'dotenv/config';
import mongoose from 'mongoose';
import { Booking, Journey, Notification, Trip, User, Vehicle } from '../models';

type LegacyRow = Record<string, unknown> & { id: string };

const supabaseUrl = process.env.SUPABASE_MIGRATION_URL?.trim().replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_MIGRATION_SERVICE_ROLE_KEY?.trim();
const mongoUrl = process.env.MONGODB_URI?.trim();
const apply = process.argv.includes('--apply');

if (!supabaseUrl || !serviceRoleKey || !mongoUrl) {
  throw new Error('Set SUPABASE_MIGRATION_URL, SUPABASE_MIGRATION_SERVICE_ROLE_KEY, and MONGODB_URI.');
}

const createdAt = (value: unknown) => value ? new Date(String(value)) : new Date();
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown) => value === null || value === undefined ? null : Number(value);
const nullableDate = (value: unknown) => value ? new Date(String(value)) : null;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase migration read failed (${response.status}): ${body.slice(0, 500)}`);
  return JSON.parse(body) as T;
}

async function getTable(table: string, optional = false): Promise<LegacyRow[]> {
  const rows: LegacyRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ select: '*', limit: '1000', offset: String(offset) });
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: serviceRoleKey!,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const body = await response.text();
    if (optional && (response.status === 404 || body.includes('PGRST205') || body.includes('42P01'))) return [];
    if (!response.ok) throw new Error(`Unable to export ${table} (${response.status}): ${body.slice(0, 500)}`);
    const page = JSON.parse(body) as LegacyRow[];
    if (!Array.isArray(page)) throw new Error(`Unexpected response while exporting ${table}.`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function getAuthUsers() {
  const users: Array<Record<string, unknown>> = [];
  for (let page = 1; ; page += 1) {
    const result = await getJson<{ users: Array<Record<string, unknown>> }>(
      `/auth/v1/admin/users?page=${page}&per_page=1000`,
    );
    users.push(...result.users);
    if (result.users.length < 1000) return users;
  }
}

function requiredId(value: unknown, relation: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${relation} in legacy row.`);
  return value;
}

async function upsertLegacy(model: mongoose.Model<any>, legacyId: string, values: Record<string, unknown>) {
  const existing = await model.findOne({ legacySupabaseId: legacyId }).select('_id');
  if (model === User && !existing) {
    const duplicate = await User.exists({ email: values.email });
    if (duplicate) {
      throw new Error(`Email ${String(values.email)} already exists in MongoDB; resolve the account conflict before importing.`);
    }
  }
  await model.findOneAndUpdate(
    { legacySupabaseId: legacyId },
    { $setOnInsert: { ...values, legacySupabaseId: legacyId } },
    { upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
}

async function main() {
  await mongoose.connect(mongoUrl!);
  const [authUsers, profiles, vehicles, journeys, bookings, trips, notifications, paymentSettings] = await Promise.all([
    getAuthUsers(),
    getTable('profiles'),
    getTable('vehicles'),
    getTable('journeys', true),
    getTable('bookings'),
    getTable('trips', true),
    getTable('notifications'),
    getTable('owner_payment_settings', true),
  ]);

  const authById = new Map(authUsers.map((row) => [String(row.id), row]));
  const legacyVehiclesById = new Map(vehicles.map((row) => [row.id, row]));
  const legacyJourneysById = new Map(journeys.map((row) => [row.id, row]));
  const ids = new Map<string, mongoose.Types.ObjectId>();
  const activeCapacityByJourney = new Map<string, number>();
  for (const booking of bookings) {
    const journeyId = text(booking.journey_id);
    if (journeyId && ['PENDING', 'ACCEPTED'].includes(String(booking.status))) {
      activeCapacityByJourney.set(
        journeyId,
        (activeCapacityByJourney.get(journeyId) ?? 0) + Number(booking.quantity),
      );
    }
  }
  const mode = apply ? 'APPLY' : 'DRY RUN';
  console.log(`${mode}: ${authUsers.length} accounts, ${vehicles.length} vehicles, ${journeys.length} journeys, ${bookings.length} bookings, ${trips.length} trips, ${notifications.length} notifications.`);
  if (!apply) console.log('No data was written. Add --apply after reviewing this migration plan.');

  for (const profile of profiles) {
    const auth = authById.get(profile.id);
    if (!auth) throw new Error(`Profile ${profile.id} has no matching Supabase Auth account.`);
    const role = text(profile.role);
    if (!['farmer', 'vehicle_owner', 'admin'].includes(role ?? '')) throw new Error(`Unsupported account role for ${profile.id}.`);
    const email = text(auth.email);
    if (!email) throw new Error(`Supabase Auth account ${profile.id} has no email.`);
    const values = {
      fullName: text(profile.full_name) ?? text((auth.user_metadata as Record<string, unknown> | undefined)?.full_name) ?? email,
      email: email.toLowerCase(),
      phone: text(profile.phone) ?? text(auth.phone),
      role,
      passwordHash: null,
      passwordResetRequired: true,
      emailVerifiedAt: nullableDate(auth.email_confirmed_at),
      upiId: null,
      qrPublicId: null,
      qrFormat: null,
      isActive: true,
      createdAt: createdAt(profile.created_at ?? auth.created_at),
      updatedAt: createdAt(profile.updated_at ?? auth.updated_at ?? auth.created_at),
    };
    const existing = await User.findOne({ legacySupabaseId: profile.id }).select('_id');
    if (existing) ids.set(profile.id, existing._id);
    else if (apply) {
      await upsertLegacy(User, profile.id, values);
      const imported = await User.findOne({ legacySupabaseId: profile.id }).select('_id');
      if (!imported) throw new Error(`Imported account ${profile.id} could not be found.`);
      ids.set(profile.id, imported._id);
    }
  }

  if (apply) {
    for (const setting of paymentSettings) {
      const ownerId = text(setting.owner_id);
      const upiId = text(setting.upi_id);
      if (!ownerId || !upiId) continue;
      await User.updateOne(
        { legacySupabaseId: ownerId, $or: [{ upiId: null }, { upiId: { $exists: false } }] },
        { $set: { upiId } },
      );
    }
    for (const vehicle of vehicles) {
      const ownerId = requiredId(vehicle.owner_id, 'vehicle owner');
      const owner = ids.get(ownerId) ?? (await User.findOne({ legacySupabaseId: ownerId }).select('_id'))?._id;
      if (!owner) throw new Error(`Vehicle ${vehicle.id} has no imported owner ${ownerId}.`);
      const legacyVehicleId = vehicle.id;
      await upsertLegacy(Vehicle, legacyVehicleId, {
        ownerId: owner,
        vehicleNumber: vehicle.vehicle_number,
        vehicleType: vehicle.vehicle_type,
        capacity: Number(vehicle.capacity),
        capacityUnit: text(vehicle.capacity_unit) ?? 'kg',
        driverName: vehicle.driver_name,
        driverMobile: vehicle.driver_mobile,
        availabilityStatus: vehicle.availability_status,
        isActive: vehicle.is_active !== false,
        createdAt: createdAt(vehicle.created_at),
        updatedAt: createdAt(vehicle.updated_at ?? vehicle.created_at),
      });
    }

    const vehicleIds = new Map((await Vehicle.find().select('_id legacySupabaseId')).map((row) => [row.legacySupabaseId!, row._id]));
    const journeyIds = new Map<string, mongoose.Types.ObjectId>();
    for (const journey of journeys) {
      const ownerId = requiredId(journey.owner_id, 'journey owner');
      const vehicleId = requiredId(journey.vehicle_id, 'journey vehicle');
      const owner = ids.get(ownerId) ?? (await User.findOne({ legacySupabaseId: ownerId }).select('_id'))?._id;
      const vehicle = vehicleIds.get(vehicleId);
      const legacyVehicle = legacyVehiclesById.get(vehicleId);
      if (!owner || !vehicle) throw new Error(`Journey ${journey.id} has a missing owner or vehicle.`);
      await upsertLegacy(Journey, journey.id, {
        ownerId: owner,
        vehicleId: vehicle,
        pickupLocation: journey.pickup_location ?? journey.source,
        destination: journey.destination,
        pickupLatitude: number(journey.pickup_latitude),
        pickupLongitude: number(journey.pickup_longitude),
        destinationLatitude: number(journey.destination_latitude),
        destinationLongitude: number(journey.destination_longitude),
        scheduledDate: journey.scheduled_date ?? journey.departure_date ?? journey.booking_date,
        scheduledTime: journey.scheduled_time ?? journey.booking_time ?? '00:00',
        capacity: Number(journey.capacity ?? journey.available_capacity),
        reservedCapacity: Number(journey.reserved_capacity ?? activeCapacityByJourney.get(journey.id) ?? 0),
        capacityUnit: text(journey.capacity_unit) ?? text(legacyVehicle?.capacity_unit) ?? 'kg',
        status: journey.status,
        notes: text(journey.notes),
        createdAt: createdAt(journey.created_at),
        updatedAt: createdAt(journey.updated_at ?? journey.created_at),
      });
      const imported = await Journey.findOne({ legacySupabaseId: journey.id }).select('_id');
      if (!imported) throw new Error(`Imported journey ${journey.id} could not be found.`);
      journeyIds.set(journey.id, imported._id);
    }
    for (const booking of bookings) {
      const farmerId = requiredId(booking.farmer_id, 'booking farmer');
      const legacyJourney = typeof booking.journey_id === 'string'
        ? legacyJourneysById.get(booking.journey_id)
        : undefined;
      const vehicleId = requiredId(
        text(booking.vehicle_id) ?? text(legacyJourney?.vehicle_id),
        'booking vehicle',
      );
      const legacyVehicle = legacyVehiclesById.get(vehicleId);
      const ownerId = requiredId(text(booking.owner_id) ?? text(legacyVehicle?.owner_id) ?? text(legacyJourney?.owner_id), 'booking owner');
      const farmer = ids.get(farmerId) ?? (await User.findOne({ legacySupabaseId: farmerId }).select('_id'))?._id;
      const owner = ids.get(ownerId) ?? (await User.findOne({ legacySupabaseId: ownerId }).select('_id'))?._id;
      const vehicle = vehicleIds.get(vehicleId);
      if (!farmer || !owner || !vehicle) throw new Error(`Booking ${booking.id} has a missing user or vehicle.`);
      const journeyId = typeof booking.journey_id === 'string' ? journeyIds.get(booking.journey_id) : undefined;
      const pickupLocation = text(booking.pickup_location) ?? text(legacyJourney?.source);
      const destination = text(booking.destination) ?? text(legacyJourney?.destination);
      if (!pickupLocation || !destination) throw new Error(`Booking ${booking.id} has no pickup/destination information.`);
      await upsertLegacy(Booking, booking.id, {
        farmerId: farmer,
        ownerId: owner,
        vehicleId: vehicle,
        journeyId: journeyId ?? null,
        cargoDescription: text(booking.cargo_description) ?? 'Legacy booking',
        quantity: Number(booking.quantity),
        pickupLocation,
        destination,
        pickupLatitude: number(booking.pickup_latitude),
        pickupLongitude: number(booking.pickup_longitude),
        destinationLatitude: number(booking.destination_latitude),
        destinationLongitude: number(booking.destination_longitude),
        bookingDate: text(booking.booking_date) ?? text(legacyJourney?.departure_date),
        bookingTime: text(booking.booking_time) ?? text(legacyJourney?.departure_time) ?? '00:00',
        additionalNote: text(booking.additional_note),
        paymentMode: booking.payment_mode ?? 'CASH',
        paymentStatus: booking.payment_status ?? 'PENDING',
        paymentAmount: number(booking.payment_amount),
        paymentTransactionId: text(booking.payment_transaction_id),
        paymentSubmittedAt: nullableDate(booking.payment_submitted_at),
        paymentApprovedAt: nullableDate(booking.payment_approved_at),
        paymentDeleteAt: nullableDate(booking.payment_delete_at),
        paymentDeletedAt: nullableDate(booking.payment_deleted_at),
        status: booking.status,
        createdAt: createdAt(booking.created_at),
        updatedAt: createdAt(booking.updated_at ?? booking.created_at),
      });
    }
    for (const trip of trips) {
      const bookingId = requiredId(trip.booking_id, 'trip booking');
      const legacyBooking = bookings.find((row) => row.id === bookingId);
      const legacyJourney = typeof legacyBooking?.journey_id === 'string'
        ? legacyJourneysById.get(legacyBooking.journey_id)
        : undefined;
      const vehicleId = requiredId(
        text(trip.vehicle_id) ?? text(legacyBooking?.vehicle_id) ?? text(legacyJourney?.vehicle_id),
        'trip vehicle',
      );
      const ownerId = requiredId(
        text(trip.owner_id) ?? text(legacyBooking?.owner_id) ?? text(legacyVehiclesById.get(vehicleId)?.owner_id),
        'trip owner',
      );
      const booking = await Booking.findOne({ legacySupabaseId: bookingId }).select('_id');
      const vehicle = vehicleIds.get(vehicleId);
      const owner = ids.get(ownerId) ?? (await User.findOne({ legacySupabaseId: ownerId }).select('_id'))?._id;
      if (!booking || !vehicle || !owner) throw new Error(`Trip ${trip.id} has a missing booking, vehicle, or owner.`);
      const journeyId = typeof trip.journey_id === 'string' ? journeyIds.get(trip.journey_id) : undefined;
      await upsertLegacy(Trip, trip.id, {
        bookingId: booking._id,
        journeyId: journeyId ?? null,
        vehicleId: vehicle,
        ownerId: owner,
        status: trip.status,
        createdAt: createdAt(trip.created_at),
        updatedAt: createdAt(trip.updated_at ?? trip.created_at),
      });
    }
    for (const notification of notifications) {
      const userId = requiredId(notification.user_id, 'notification user');
      const user = ids.get(userId) ?? (await User.findOne({ legacySupabaseId: userId }).select('_id'))?._id;
      if (!user) throw new Error(`Notification ${notification.id} has no imported user.`);
      const bookingId = typeof notification.booking_id === 'string'
        ? (await Booking.findOne({ legacySupabaseId: notification.booking_id }).select('_id'))?._id
        : undefined;
      const journeyId = typeof notification.journey_id === 'string'
        ? journeyIds.get(notification.journey_id)
        : undefined;
      await upsertLegacy(Notification, notification.id, {
        userId,
        title: notification.title,
        message: notification.message,
        bookingId: bookingId ?? null,
        journeyId: journeyId ?? null,
        isRead: notification.is_read === true,
        createdAt: createdAt(notification.created_at),
        updatedAt: createdAt(notification.updated_at ?? notification.created_at),
      });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error('Supabase data import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
