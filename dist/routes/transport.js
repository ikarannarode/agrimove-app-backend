"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongoose_1 = require("mongoose");
const zod_1 = require("zod");
const middleware_1 = require("../middleware");
const models_1 = require("../models");
const errors_1 = require("../errors");
const realtime_1 = require("../realtime");
const router = (0, express_1.Router)();
router.use(middleware_1.authenticate);
const idSchema = zod_1.z.string().refine(mongoose_1.isValidObjectId, 'Invalid resource id.');
const location = zod_1.z.string().trim().min(1).max(240);
const dateSchema = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
function id(value) {
    if (typeof value !== 'string')
        throw new errors_1.HttpError(400, 'Invalid resource id.');
    return new mongoose_1.Types.ObjectId(idSchema.parse(value));
}
async function notify(userId, title, message, bookingId, journeyId, session) {
    await new models_1.Notification({ userId, title, message, bookingId, journeyId }).save({ session });
    if (!session)
        (0, realtime_1.publishDataChange)([String(userId)], 'notifications', 'created', bookingId ? String(bookingId) : undefined);
}
function asBooking(row) {
    const source = row;
    return {
        ...source,
        id: String(source._id),
        farmer_id: String(source.farmerId),
        owner_id: String(source.ownerId),
        vehicle_id: String(source.vehicleId),
        journey_id: source.journeyId ? String(source.journeyId) : null,
        cargo_description: source.cargoDescription,
        pickup_location: source.pickupLocation,
        destination: source.destination,
        pickup_latitude: source.pickupLatitude,
        pickup_longitude: source.pickupLongitude,
        destination_latitude: source.destinationLatitude,
        destination_longitude: source.destinationLongitude,
        booking_date: source.bookingDate,
        booking_time: source.bookingTime,
        additional_note: source.additionalNote,
        payment_mode: source.paymentMode,
        payment_status: source.paymentStatus,
        payment_amount: source.paymentAmount,
        payment_transaction_id: source.paymentTransactionId,
        payment_screenshot_path: source.paymentScreenshotPublicId,
        payment_submitted_at: source.paymentSubmittedAt,
        payment_approved_at: source.paymentApprovedAt,
        payment_delete_at: source.paymentDeleteAt,
        payment_deleted_at: source.paymentDeletedAt,
        created_at: source.createdAt,
        updated_at: source.updatedAt,
    };
}
async function presentBooking(booking) {
    const [farmer, owner, vehicle, journey, trip] = await Promise.all([
        models_1.User.findById(booking.farmerId).select('fullName phone email'),
        models_1.User.findById(booking.ownerId).select('fullName phone email upiId qrPublicId'),
        models_1.Vehicle.findById(booking.vehicleId),
        booking.journeyId ? models_1.Journey.findById(booking.journeyId) : null,
        models_1.Trip.findOne({ bookingId: booking._id }),
    ]);
    const safeUser = (user) => user ? {
        id: String(user._id),
        full_name: user.fullName,
        phone: user.phone,
        email: user.email,
    } : null;
    const paymentOwner = owner ? {
        id: String(owner._id),
        full_name: owner.fullName,
        phone: owner.phone,
        email: owner.email,
        upi_id: owner.upiId,
        has_qr: Boolean(owner.qrPublicId),
    } : null;
    return {
        ...asBooking(booking.toObject()),
        farmer: safeUser(farmer),
        owner: paymentOwner,
        vehicle: vehicle ? {
            id: String(vehicle._id),
            owner_id: String(vehicle.ownerId),
            vehicle_number: vehicle.vehicleNumber,
            vehicle_type: vehicle.vehicleType,
            capacity: vehicle.capacity,
            capacity_unit: vehicle.capacityUnit,
            driver_name: vehicle.driverName,
            driver_mobile: vehicle.driverMobile,
            availability_status: vehicle.availabilityStatus,
            is_active: vehicle.isActive,
            owner: paymentOwner,
        } : null,
        journey: journey ? presentJourney(journey, vehicle) : null,
        trip: trip ? {
            id: String(trip._id),
            booking_id: String(trip.bookingId),
            vehicle_id: String(trip.vehicleId),
            owner_id: String(trip.ownerId),
            journey_id: trip.journeyId ? String(trip.journeyId) : null,
            status: trip.status,
            created_at: trip.createdAt,
            updated_at: trip.updatedAt,
        } : null,
    };
}
function presentJourney(journey, vehicle, remaining = journey.capacity - journey.reservedCapacity) {
    return {
        id: String(journey._id),
        owner_id: String(journey.ownerId),
        vehicle_id: String(journey.vehicleId),
        pickup_location: journey.pickupLocation,
        destination: journey.destination,
        pickup_latitude: journey.pickupLatitude,
        pickup_longitude: journey.pickupLongitude,
        destination_latitude: journey.destinationLatitude,
        destination_longitude: journey.destinationLongitude,
        booking_date: journey.scheduledDate,
        booking_time: journey.scheduledTime,
        capacity: journey.capacity,
        reserved_capacity: journey.reservedCapacity,
        available_capacity: Math.max(0, remaining),
        capacity_unit: journey.capacityUnit,
        status: journey.status,
        notes: journey.notes,
        vehicle: vehicle ? {
            id: String(vehicle._id),
            owner_id: String(vehicle.ownerId),
            vehicle_number: vehicle.vehicleNumber,
            vehicle_type: vehicle.vehicleType,
            capacity: vehicle.capacity,
            capacity_unit: vehicle.capacityUnit,
            driver_name: vehicle.driverName,
            driver_mobile: vehicle.driverMobile,
            availability_status: vehicle.availabilityStatus,
            is_active: vehicle.isActive,
        } : null,
        created_at: journey.createdAt,
        updated_at: journey.updatedAt,
    };
}
router.get('/vehicles', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const query = zod_1.z.object({
        mine: zod_1.z.coerce.boolean().optional(),
        type: zod_1.z.string().trim().max(60).optional(),
        minCapacity: zod_1.z.coerce.number().positive().optional(),
    }).parse(req.query);
    const filter = query.mine && actor.role === 'vehicle_owner'
        ? { ownerId: id(actor.id) }
        : { isActive: true, ...(actor.role === 'vehicle_owner' ? { ownerId: id(actor.id) } : {}) };
    if (query.type)
        filter.vehicleType = { $regex: query.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (query.minCapacity)
        filter.capacity = { $gte: query.minCapacity };
    const rows = await models_1.Vehicle.find(filter).sort({ createdAt: -1 }).lean();
    res.json(rows.map((vehicle) => ({
        id: String(vehicle._id),
        owner_id: String(vehicle.ownerId),
        vehicle_number: vehicle.vehicleNumber,
        vehicle_type: vehicle.vehicleType,
        capacity: vehicle.capacity,
        capacity_unit: vehicle.capacityUnit,
        driver_name: vehicle.driverName,
        driver_mobile: vehicle.driverMobile,
        availability_status: vehicle.availabilityStatus,
        is_active: vehicle.isActive,
        created_at: vehicle.createdAt,
    })));
});
router.post('/vehicles', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        vehicle_number: zod_1.z.string().trim().min(2).max(24),
        vehicle_type: zod_1.z.string().trim().min(2).max(60),
        capacity: zod_1.z.number().positive(),
        capacity_unit: zod_1.z.string().trim().min(1).max(16).default('kg'),
        driver_name: zod_1.z.string().trim().min(2).max(120),
        driver_mobile: zod_1.z.string().trim().min(10).max(24),
    }).strict().parse(req.body);
    const existing = await models_1.Vehicle.exists({ ownerId: id(actor.id), vehicleNumber: body.vehicle_number.toUpperCase() });
    if (existing)
        throw new errors_1.HttpError(409, 'This vehicle number is already registered to your account.');
    const vehicle = await models_1.Vehicle.create({
        ownerId: id(actor.id),
        vehicleNumber: body.vehicle_number,
        vehicleType: body.vehicle_type,
        capacity: body.capacity,
        capacityUnit: body.capacity_unit,
        driverName: body.driver_name,
        driverMobile: body.driver_mobile,
    });
    (0, realtime_1.publishDataChange)([actor.id], 'vehicles', 'created', String(vehicle._id));
    (0, realtime_1.publishRoleChange)(['farmer'], 'vehicles', 'created', String(vehicle._id));
    res.status(201).json({ ...vehicle.toObject(), id: String(vehicle._id) });
});
router.patch('/vehicles/:id', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        vehicle_number: zod_1.z.string().trim().min(2).max(24).optional(),
        vehicle_type: zod_1.z.string().trim().min(2).max(60).optional(),
        capacity: zod_1.z.number().positive().optional(),
        capacity_unit: zod_1.z.string().trim().min(1).max(16).optional(),
        driver_name: zod_1.z.string().trim().min(2).max(120).optional(),
        driver_mobile: zod_1.z.string().trim().min(10).max(24).optional(),
        is_active: zod_1.z.boolean().optional(),
        availability_status: zod_1.z.enum(['AVAILABLE']).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const vehicle = await models_1.Vehicle.findOne({ _id: id(req.params.id), ownerId: id(actor.id) });
    if (!vehicle)
        throw new errors_1.HttpError(404, 'Vehicle was not found.');
    const activeJourney = await models_1.Journey.exists({ vehicleId: vehicle._id, status: { $in: ['AVAILABLE', 'BOOKED', 'ON_JOURNEY'] } });
    if (activeJourney && (body.capacity !== undefined || body.vehicle_number !== undefined || body.vehicle_type !== undefined)) {
        throw new errors_1.HttpError(409, 'Vehicle details cannot be changed while it has an active published trip.');
    }
    if (body.vehicle_number !== undefined)
        vehicle.vehicleNumber = body.vehicle_number.toUpperCase();
    if (body.vehicle_type !== undefined)
        vehicle.vehicleType = body.vehicle_type;
    if (body.capacity !== undefined)
        vehicle.capacity = body.capacity;
    if (body.capacity_unit !== undefined)
        vehicle.capacityUnit = body.capacity_unit;
    if (body.driver_name !== undefined)
        vehicle.driverName = body.driver_name;
    if (body.driver_mobile !== undefined)
        vehicle.driverMobile = body.driver_mobile;
    if (body.is_active !== undefined)
        vehicle.isActive = body.is_active;
    if (body.availability_status === 'AVAILABLE') {
        if (vehicle.availabilityStatus !== 'COMPLETED') {
            throw new errors_1.HttpError(409, 'A vehicle can be marked available after its trip is completed.');
        }
        vehicle.availabilityStatus = 'AVAILABLE';
    }
    await vehicle.save();
    (0, realtime_1.publishDataChange)([actor.id], 'vehicles', 'updated', String(vehicle._id));
    (0, realtime_1.publishRoleChange)(['farmer'], 'vehicles', 'updated', String(vehicle._id));
    res.json({ ...vehicle.toObject(), id: String(vehicle._id) });
});
router.get('/journeys', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const query = zod_1.z.object({
        mine: zod_1.z.coerce.boolean().optional(),
        pickup: zod_1.z.string().trim().max(120).optional(),
        destination: zod_1.z.string().trim().max(120).optional(),
        date: dateSchema.optional(),
        vehicleType: zod_1.z.string().trim().max(60).optional(),
        minCapacity: zod_1.z.coerce.number().positive().optional(),
    }).parse(req.query);
    const filter = query.mine && actor.role === 'vehicle_owner'
        ? { ownerId: id(actor.id) }
        : {
            status: { $in: ['AVAILABLE', 'BOOKED'] },
            scheduledDate: { $gte: new Date().toISOString().slice(0, 10) },
            ...(query.date ? { scheduledDate: query.date } : {}),
        };
    const rows = await models_1.Journey.find(filter).sort({ scheduledDate: 1, scheduledTime: 1 }).limit(250).lean();
    const vehicleIds = [...new Set(rows.map((journey) => String(journey.vehicleId)))].map((vehicleId) => id(vehicleId));
    const vehicleRows = vehicleIds.length ? await models_1.Vehicle.find({ _id: { $in: vehicleIds }, isActive: true }).lean() : [];
    const vehicleById = new Map(vehicleRows.map((vehicle) => [String(vehicle._id), vehicle]));
    const results = rows.map((journey) => {
        const vehicle = vehicleById.get(String(journey.vehicleId));
        const available = journey.capacity - journey.reservedCapacity;
        return { journey, vehicle, available };
    }).filter(({ journey, vehicle, available }) => {
        if (!vehicle)
            return false;
        if (query.mine && actor.role === 'vehicle_owner')
            return true;
        if (journey.status === 'COMPLETED' || journey.status === 'CANCELLED' || available <= 0)
            return false;
        if (query.minCapacity && available < query.minCapacity)
            return false;
        if (query.vehicleType && !vehicle.vehicleType.toLocaleLowerCase().includes(query.vehicleType.toLocaleLowerCase()))
            return false;
        if (query.pickup && !journey.pickupLocation.toLocaleLowerCase().includes(query.pickup.toLocaleLowerCase()))
            return false;
        if (query.destination && !journey.destination.toLocaleLowerCase().includes(query.destination.toLocaleLowerCase()))
            return false;
        return true;
    });
    res.json(results.map(({ journey, vehicle, available }) => presentJourney(journey, vehicle, available)));
});
router.post('/journeys', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        vehicle_id: zod_1.z.string().refine(mongoose_1.isValidObjectId),
        pickup_location: location,
        destination: location,
        pickup_latitude: zod_1.z.number().min(-90).max(90),
        pickup_longitude: zod_1.z.number().min(-180).max(180),
        destination_latitude: zod_1.z.number().min(-90).max(90),
        destination_longitude: zod_1.z.number().min(-180).max(180),
        booking_date: dateSchema,
        booking_time: timeSchema,
        capacity: zod_1.z.number().positive(),
        notes: zod_1.z.string().trim().max(1000).optional(),
    }).strict().parse(req.body);
    if (body.pickup_location.toLocaleLowerCase() === body.destination.toLocaleLowerCase()) {
        throw new errors_1.HttpError(400, 'Pickup and destination must be different.');
    }
    if (body.booking_date < new Date().toISOString().slice(0, 10))
        throw new errors_1.HttpError(400, 'Trip date must be today or later.');
    const vehicle = await models_1.Vehicle.findOne({ _id: id(body.vehicle_id), ownerId: id(actor.id), isActive: true });
    if (!vehicle)
        throw new errors_1.HttpError(404, 'Active vehicle was not found.');
    if (body.capacity > vehicle.capacity)
        throw new errors_1.HttpError(400, 'Published trip capacity cannot exceed the vehicle capacity.');
    const overlapping = await models_1.Journey.exists({
        vehicleId: vehicle._id,
        scheduledDate: body.booking_date,
        scheduledTime: body.booking_time,
        status: { $in: ['AVAILABLE', 'BOOKED', 'ON_JOURNEY'] },
    });
    if (overlapping)
        throw new errors_1.HttpError(409, 'This vehicle already has an active trip at that date and time.');
    const journey = await models_1.Journey.create({
        ownerId: id(actor.id),
        vehicleId: vehicle._id,
        pickupLocation: body.pickup_location,
        destination: body.destination,
        pickupLatitude: body.pickup_latitude,
        pickupLongitude: body.pickup_longitude,
        destinationLatitude: body.destination_latitude,
        destinationLongitude: body.destination_longitude,
        scheduledDate: body.booking_date,
        scheduledTime: body.booking_time,
        capacity: body.capacity,
        capacityUnit: vehicle.capacityUnit,
        notes: body.notes || null,
    });
    (0, realtime_1.publishDataChange)([actor.id], 'journeys', 'created', String(journey._id));
    (0, realtime_1.publishRoleChange)(['farmer'], 'journeys', 'created', String(journey._id));
    res.status(201).json(presentJourney(journey, vehicle));
});
router.patch('/journeys/:id', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({ status: zod_1.z.enum(['CANCELLED']) }).strict().parse(req.body);
    const journey = await models_1.Journey.findOne({ _id: id(req.params.id), ownerId: id(actor.id), status: { $in: ['AVAILABLE', 'BOOKED'] } });
    if (!journey)
        throw new errors_1.HttpError(404, 'An active trip was not found.');
    if (journey.reservedCapacity > 0)
        throw new errors_1.HttpError(409, 'A trip with pending or accepted bookings cannot be cancelled.');
    journey.status = body.status;
    await journey.save();
    (0, realtime_1.publishDataChange)([actor.id], 'journeys', 'cancelled', String(journey._id));
    (0, realtime_1.publishRoleChange)(['farmer'], 'journeys', 'cancelled', String(journey._id));
    res.json(presentJourney(journey, await models_1.Vehicle.findById(journey.vehicleId)));
});
router.get('/bookings', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const filter = actor.role === 'farmer' ? { farmerId: id(actor.id) }
        : actor.role === 'vehicle_owner' ? { ownerId: id(actor.id) } : {};
    const rows = await models_1.Booking.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json(await Promise.all(rows.map(presentBooking)));
});
router.post('/bookings', (0, middleware_1.requireRole)('farmer'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        journey_id: zod_1.z.string().refine(mongoose_1.isValidObjectId),
        cargo_description: zod_1.z.string().trim().min(1).max(160),
        quantity: zod_1.z.number().positive(),
        pickup_location: location,
        destination: location,
        pickup_latitude: zod_1.z.number().min(-90).max(90),
        pickup_longitude: zod_1.z.number().min(-180).max(180),
        destination_latitude: zod_1.z.number().min(-90).max(90),
        destination_longitude: zod_1.z.number().min(-180).max(180),
        booking_date: dateSchema,
        booking_time: timeSchema,
        additional_note: zod_1.z.string().trim().max(1000).optional(),
        payment_mode: zod_1.z.enum(['CASH', 'ONLINE']),
    }).strict().parse(req.body);
    if (body.pickup_location.toLocaleLowerCase() === body.destination.toLocaleLowerCase()) {
        throw new errors_1.HttpError(400, 'Pickup and destination must be different.');
    }
    const journeyId = id(body.journey_id);
    const journey = await models_1.Journey.findOne({ _id: journeyId, status: { $in: ['AVAILABLE', 'BOOKED'] }, scheduledDate: body.booking_date });
    if (!journey || journey.scheduledTime !== body.booking_time)
        throw new errors_1.HttpError(404, 'This trip is no longer available.');
    if (journey.ownerId.toString() === actor.id)
        throw new errors_1.HttpError(400, 'You cannot book your own vehicle.');
    const vehicle = await models_1.Vehicle.findOne({ _id: journey.vehicleId, isActive: true });
    if (!vehicle)
        throw new errors_1.HttpError(409, 'This vehicle is unavailable.');
    if (body.quantity > journey.capacity - journey.reservedCapacity)
        throw new errors_1.HttpError(409, 'Requested weight exceeds the remaining vehicle capacity.');
    const owner = await models_1.User.findById(journey.ownerId).select('qrPublicId');
    if (body.payment_mode === 'ONLINE' && !owner?.qrPublicId) {
        throw new errors_1.HttpError(409, 'या वाहन मालकाने ऑनलाइन पेमेंटसाठी QR कोड जोडलेला नाही. रोख रक्कम निवडा.');
    }
    const reserved = await models_1.Journey.updateOne({
        _id: journeyId,
        status: { $in: ['AVAILABLE', 'BOOKED'] },
        $expr: { $lte: [{ $add: ['$reservedCapacity', body.quantity] }, '$capacity'] },
    }, { $inc: { reservedCapacity: body.quantity } });
    if (!reserved.modifiedCount)
        throw new errors_1.HttpError(409, 'This trip no longer has enough free vehicle capacity.');
    let createdBooking;
    try {
        const booking = await models_1.Booking.create({
            farmerId: id(actor.id),
            ownerId: journey.ownerId,
            vehicleId: vehicle._id,
            journeyId,
            cargoDescription: body.cargo_description,
            quantity: body.quantity,
            pickupLocation: body.pickup_location,
            destination: body.destination,
            pickupLatitude: body.pickup_latitude,
            pickupLongitude: body.pickup_longitude,
            destinationLatitude: body.destination_latitude,
            destinationLongitude: body.destination_longitude,
            bookingDate: body.booking_date,
            bookingTime: body.booking_time,
            additionalNote: body.additional_note || null,
            paymentMode: body.payment_mode,
        });
        createdBooking = booking;
        const remaining = journey.capacity - journey.reservedCapacity - body.quantity;
        if (remaining <= 0)
            await models_1.Journey.updateOne({ _id: journeyId }, { $set: { status: 'BOOKED' } });
        await notify(journey.ownerId, 'नवीन आरक्षण विनंती', `${actor.fullName} यांनी ${body.quantity} ${vehicle.capacityUnit} क्षमतेसाठी विनंती पाठवली.`, booking._id, journey._id);
        (0, realtime_1.publishDataChange)([actor.id], 'bookings', 'created', String(booking._id));
        (0, realtime_1.publishDataChange)([String(journey.ownerId)], 'journeys', 'capacity_reserved', String(journey._id));
        res.status(201).json(await presentBooking(booking));
    }
    catch (error) {
        if (createdBooking)
            await models_1.Booking.deleteOne({ _id: createdBooking._id });
        await models_1.Journey.updateOne({ _id: journeyId }, { $inc: { reservedCapacity: -body.quantity } });
        throw error;
    }
});
router.patch('/bookings/:id/status', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({ status: zod_1.z.enum(['ACCEPTED', 'REJECTED']) }).strict().parse(req.body);
    const bookingId = id(req.params.id);
    const session = await (0, mongoose_1.startSession)();
    let bookingIdForResponse = null;
    try {
        await session.withTransaction(async () => {
            const booking = await models_1.Booking.findOneAndUpdate({ _id: bookingId, ownerId: id(actor.id), status: 'PENDING' }, { $set: { status: body.status } }, { new: true, session });
            if (!booking)
                throw new errors_1.HttpError(404, 'A pending booking request was not found.');
            bookingIdForResponse = booking._id;
            if (body.status === 'REJECTED' && booking.journeyId) {
                await models_1.Journey.updateOne({ _id: booking.journeyId }, { $inc: { reservedCapacity: -booking.quantity } }, { session });
                const journey = await models_1.Journey.findById(booking.journeyId).session(session);
                if (journey && journey.status !== 'CANCELLED' && journey.capacity > journey.reservedCapacity) {
                    journey.status = 'AVAILABLE';
                    await journey.save({ session });
                }
            }
            if (body.status === 'ACCEPTED') {
                await models_1.Trip.create([{
                        bookingId: booking._id,
                        journeyId: booking.journeyId,
                        vehicleId: booking.vehicleId,
                        ownerId: booking.ownerId,
                    }], { session });
                await models_1.Vehicle.updateOne({ _id: booking.vehicleId }, { $set: { availabilityStatus: 'RESERVED' } }, { session });
                if (booking.journeyId) {
                    const journey = await models_1.Journey.findById(booking.journeyId).session(session);
                    if (journey && journey.capacity <= journey.reservedCapacity) {
                        journey.status = 'BOOKED';
                        await journey.save({ session });
                    }
                }
            }
            else {
                const active = await models_1.Booking.exists({
                    vehicleId: booking.vehicleId,
                    status: { $in: ['PENDING', 'ACCEPTED'] },
                    _id: { $ne: booking._id },
                }).session(session);
                if (!active) {
                    await models_1.Vehicle.updateOne({ _id: booking.vehicleId }, { $set: { availabilityStatus: 'AVAILABLE' } }, { session });
                }
            }
            await notify(booking.farmerId, body.status === 'ACCEPTED' ? 'आरक्षण स्वीकारले' : 'आरक्षण नाकारले', body.status === 'ACCEPTED' ? 'वाहनमालकाने तुमची आरक्षण विनंती स्वीकारली.' : 'वाहनमालकाने तुमची आरक्षण विनंती नाकारली.', booking._id, booking.journeyId ?? undefined, session);
            if (body.status === 'ACCEPTED' && booking.paymentMode === 'ONLINE') {
                const owner = await models_1.User.findById(booking.ownerId).select('qrPublicId').session(session);
                if (owner?.qrPublicId) {
                    await notify(booking.farmerId, 'पेमेंट QR उपलब्ध', 'वाहनमालकाने ऑनलाइन पेमेंटसाठी QR कोड जोडला आहे.', booking._id, booking.journeyId ?? undefined, session);
                }
            }
        });
    }
    finally {
        await session.endSession();
    }
    if (!bookingIdForResponse)
        throw new errors_1.HttpError(500, 'Booking update did not complete.');
    const booking = await models_1.Booking.findById(bookingIdForResponse);
    if (!booking)
        throw new errors_1.HttpError(404, 'Updated booking could not be found.');
    (0, realtime_1.publishDataChange)([String(booking.farmerId), actor.id], 'bookings', body.status.toLowerCase(), String(booking._id));
    (0, realtime_1.publishDataChange)([String(booking.ownerId)], 'vehicles', body.status === 'ACCEPTED' ? 'reserved' : 'available', String(booking.vehicleId));
    if (booking.journeyId)
        (0, realtime_1.publishRoleChange)(['farmer'], 'journeys', 'capacity_updated', String(booking.journeyId));
    res.json(await presentBooking(booking));
});
router.patch('/trips/:id/status', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({ status: zod_1.z.enum(['ON_JOURNEY', 'COMPLETED']) }).strict().parse(req.body);
    const session = await (0, mongoose_1.startSession)();
    let tripIdForResponse = null;
    try {
        await session.withTransaction(async () => {
            const trip = await models_1.Trip.findOne({ _id: id(req.params.id), ownerId: id(actor.id) }).session(session);
            if (!trip)
                throw new errors_1.HttpError(404, 'Trip was not found.');
            const allowed = (trip.status === 'RESERVED' && body.status === 'ON_JOURNEY')
                || (trip.status === 'ON_JOURNEY' && body.status === 'COMPLETED');
            if (!allowed)
                throw new errors_1.HttpError(409, 'Trip status transition is not allowed.');
            trip.status = body.status;
            await trip.save({ session });
            tripIdForResponse = trip._id;
            const booking = await models_1.Booking.findById(trip.bookingId).session(session);
            if (!booking)
                throw new errors_1.HttpError(404, 'Trip booking was not found.');
            if (body.status === 'COMPLETED') {
                booking.status = 'COMPLETED';
                await booking.save({ session });
            }
            const journeyId = trip.journeyId;
            if (journeyId) {
                const liveTrips = await models_1.Trip.exists({ journeyId, status: { $in: ['RESERVED', 'ON_JOURNEY'] } }).session(session);
                const journey = await models_1.Journey.findById(journeyId).session(session);
                if (journey) {
                    if (body.status === 'ON_JOURNEY')
                        journey.status = 'ON_JOURNEY';
                    else if (!liveTrips)
                        journey.status = 'COMPLETED';
                    await journey.save({ session });
                }
            }
            const liveTripsForVehicle = await models_1.Trip.exists({
                vehicleId: trip.vehicleId,
                status: { $in: ['RESERVED', 'ON_JOURNEY'] },
            }).session(session);
            const inProgressTrips = await models_1.Trip.exists({ vehicleId: trip.vehicleId, status: 'ON_JOURNEY' }).session(session);
            await models_1.Vehicle.updateOne({ _id: trip.vehicleId }, {
                $set: {
                    availabilityStatus: liveTripsForVehicle
                        ? (inProgressTrips ? 'ON_JOURNEY' : 'RESERVED')
                        : 'COMPLETED',
                },
            }, { session });
            await notify(booking.farmerId, body.status === 'ON_JOURNEY' ? 'प्रवास सुरू झाला' : 'प्रवास पूर्ण झाला', body.status === 'ON_JOURNEY' ? 'वाहनमालकाने तुमचा प्रवास सुरू केला.' : 'तुमचा प्रवास पूर्ण झाला.', booking._id, journeyId ?? undefined, session);
        });
    }
    finally {
        await session.endSession();
    }
    if (!tripIdForResponse)
        throw new errors_1.HttpError(500, 'Trip update did not complete.');
    const trip = await models_1.Trip.findById(tripIdForResponse);
    if (!trip)
        throw new errors_1.HttpError(404, 'Updated trip could not be found.');
    const booking = await models_1.Booking.findById(trip.bookingId).select('farmerId');
    (0, realtime_1.publishDataChange)([String(trip.ownerId), booking ? String(booking.farmerId) : undefined], 'trips', body.status.toLowerCase(), String(trip._id));
    (0, realtime_1.publishDataChange)([String(trip.ownerId)], 'vehicles', body.status === 'COMPLETED' ? 'completed' : 'in_trip', String(trip.vehicleId));
    res.json({
        id: String(trip._id),
        booking_id: String(trip.bookingId),
        vehicle_id: String(trip.vehicleId),
        owner_id: String(trip.ownerId),
        journey_id: trip.journeyId ? String(trip.journeyId) : null,
        status: trip.status,
        created_at: trip.createdAt,
        updated_at: trip.updatedAt,
    });
});
router.get('/trips', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const filter = actor.role === 'vehicle_owner' ? { ownerId: id(actor.id) } : {};
    const rows = await models_1.Trip.find(filter).sort({ createdAt: -1 }).limit(300);
    const visible = actor.role === 'farmer'
        ? await Promise.all(rows.map(async (trip) => (await models_1.Booking.exists({ _id: trip.bookingId, farmerId: id(actor.id) })) ? trip : null))
        : rows;
    res.json(visible.filter(Boolean).map((trip) => ({
        id: String(trip._id),
        booking_id: String(trip.bookingId),
        vehicle_id: String(trip.vehicleId),
        owner_id: String(trip.ownerId),
        journey_id: trip.journeyId ? String(trip.journeyId) : null,
        status: trip.status,
        created_at: trip.createdAt,
        updated_at: trip.updatedAt,
    })));
});
router.get('/notifications', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const rows = await models_1.Notification.find({ userId: id(actor.id) }).sort({ createdAt: -1 }).limit(300).lean();
    res.json(rows.map((row) => ({
        id: String(row._id),
        user_id: String(row.userId),
        title: row.title,
        message: row.message,
        booking_id: row.bookingId ? String(row.bookingId) : null,
        journey_id: row.journeyId ? String(row.journeyId) : null,
        is_read: row.isRead,
        created_at: row.createdAt,
    })));
});
router.patch('/notifications/:id/read', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const row = await models_1.Notification.findOneAndUpdate({ _id: id(req.params.id), userId: id(actor.id) }, { $set: { isRead: true } }, { new: true });
    if (!row)
        throw new errors_1.HttpError(404, 'Notification was not found.');
    (0, realtime_1.publishDataChange)([actor.id], 'notifications', 'read', String(row._id));
    res.json({ id: String(row._id), is_read: row.isRead });
});
exports.default = router;
