"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongoose_1 = require("mongoose");
const zod_1 = require("zod");
const errors_1 = require("../errors");
const middleware_1 = require("../middleware");
const models_1 = require("../models");
const router = (0, express_1.Router)();
router.use(middleware_1.authenticate, (0, middleware_1.requireRole)('admin'));
const resources = ['farmers', 'owners', 'vehicles', 'bookings', 'payments', 'trips', 'notifications'];
function boundedRegex(value) {
    const safe = value.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(safe, 'i');
}
async function adminBooking(booking) {
    const [farmer, owner, vehicle, journey, trip] = await Promise.all([
        models_1.User.findById(booking.farmerId).select('fullName phone email'),
        models_1.User.findById(booking.ownerId).select('fullName phone email'),
        models_1.Vehicle.findById(booking.vehicleId),
        booking.journeyId ? models_1.Journey.findById(booking.journeyId) : null,
        models_1.Trip.findOne({ bookingId: booking._id }),
    ]);
    const person = (row) => row ? {
        id: String(row._id),
        full_name: row.fullName,
        phone: row.phone,
        email: row.email,
    } : null;
    return {
        id: String(booking._id),
        farmer_id: String(booking.farmerId),
        owner_id: String(booking.ownerId),
        vehicle_id: String(booking.vehicleId),
        journey_id: booking.journeyId ? String(booking.journeyId) : null,
        cargo_description: booking.cargoDescription,
        quantity: booking.quantity,
        pickup_location: booking.pickupLocation,
        destination: booking.destination,
        pickup_latitude: booking.pickupLatitude,
        pickup_longitude: booking.pickupLongitude,
        destination_latitude: booking.destinationLatitude,
        destination_longitude: booking.destinationLongitude,
        booking_date: booking.bookingDate,
        booking_time: booking.bookingTime,
        status: booking.status,
        payment_mode: booking.paymentMode,
        payment_status: booking.paymentStatus,
        payment_amount: booking.paymentAmount,
        payment_transaction_id: booking.paymentTransactionId,
        has_payment_screenshot: Boolean(booking.paymentScreenshotPublicId),
        payment_submitted_at: booking.paymentSubmittedAt,
        payment_approved_at: booking.paymentApprovedAt,
        payment_delete_at: booking.paymentDeleteAt,
        payment_deleted_at: booking.paymentDeletedAt,
        created_at: booking.createdAt,
        farmer: person(farmer),
        vehicle: vehicle ? {
            id: String(vehicle._id),
            vehicle_number: vehicle.vehicleNumber,
            vehicle_type: vehicle.vehicleType,
            driver_name: vehicle.driverName,
            owner: person(owner),
        } : null,
        journey: journey ? {
            id: String(journey._id),
            pickup_location: journey.pickupLocation,
            destination: journey.destination,
            booking_date: journey.scheduledDate,
            booking_time: journey.scheduledTime,
            capacity: journey.capacity,
            available_capacity: Math.max(0, journey.capacity - journey.reservedCapacity),
            status: journey.status,
        } : null,
        trip: trip ? {
            id: String(trip._id),
            status: trip.status,
            created_at: trip.createdAt,
        } : null,
    };
}
router.get('/stats', async (_req, res) => {
    const [farmers, owners, vehicles, available, reserved, inTrip, bookings, pendingBookings, completedTrips, pendingPayments, journeys, freeCapacity,] = await Promise.all([
        models_1.User.countDocuments({ role: 'farmer' }),
        models_1.User.countDocuments({ role: 'vehicle_owner' }),
        models_1.Vehicle.countDocuments(),
        models_1.Vehicle.countDocuments({ availabilityStatus: 'AVAILABLE' }),
        models_1.Vehicle.countDocuments({ availabilityStatus: 'RESERVED' }),
        models_1.Vehicle.countDocuments({ availabilityStatus: 'ON_JOURNEY' }),
        models_1.Booking.countDocuments(),
        models_1.Booking.countDocuments({ status: 'PENDING' }),
        models_1.Trip.countDocuments({ status: 'COMPLETED' }),
        models_1.Booking.countDocuments({ paymentStatus: { $in: ['PENDING', 'VERIFICATION_PENDING'] } }),
        models_1.Journey.countDocuments({ status: { $in: ['AVAILABLE', 'BOOKED'] } }),
        models_1.Journey.aggregate([
            { $match: { status: { $in: ['AVAILABLE', 'BOOKED'] } } },
            { $group: { _id: null, total: { $sum: { $max: [0, { $subtract: ['$capacity', '$reservedCapacity'] }] } } } },
        ]),
    ]);
    res.json({
        farmers,
        owners,
        vehicles,
        available,
        reserved,
        inTrip,
        bookings,
        pendingBookings,
        completedTrips,
        pendingPayments,
        journeys,
        freeCapacity: freeCapacity[0]?.total ?? 0,
    });
});
router.get('/resources/:resource', async (req, res) => {
    const resource = zod_1.z.enum(resources).parse(req.params.resource);
    const query = zod_1.z.object({
        page: zod_1.z.coerce.number().int().min(1).default(1),
        pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(25),
        q: zod_1.z.string().trim().max(100).optional(),
        status: zod_1.z.string().max(40).optional(),
        role: zod_1.z.string().max(40).optional(),
    }).parse(req.query);
    const skip = (query.page - 1) * query.pageSize;
    const search = query.q ? boundedRegex(query.q) : null;
    let filter = {};
    if (query.status) {
        const statusField = resource === 'vehicles' ? 'availabilityStatus'
            : resource === 'payments' ? 'paymentStatus'
                : resource === 'trips' ? 'status'
                    : resource === 'bookings' ? 'status' : null;
        if (statusField)
            filter[statusField] = query.status;
    }
    let rows;
    let count;
    if (resource === 'farmers' || resource === 'owners') {
        filter = {
            role: resource === 'farmers' ? 'farmer' : 'vehicle_owner',
            ...(search ? { $or: [{ fullName: search }, { email: search }, { phone: search }] } : {}),
        };
        [rows, count] = await Promise.all([
            models_1.User.find(filter).select('fullName email phone role emailVerifiedAt isActive createdAt').sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean(),
            models_1.User.countDocuments(filter),
        ]);
        rows = rows.map((row) => ({
            id: String(row._id),
            full_name: row.fullName,
            email: row.email,
            phone: row.phone,
            role: row.role,
            email_verified: Boolean(row.emailVerifiedAt),
            is_active: row.isActive,
            created_at: row.createdAt,
        }));
    }
    else if (resource === 'vehicles') {
        const [vehicleRows, total] = await Promise.all([
            models_1.Vehicle.find({
                ...filter,
                ...(search ? { $or: [{ vehicleNumber: search }, { vehicleType: search }, { driverName: search }] } : {}),
            }).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean(),
            models_1.Vehicle.countDocuments({
                ...filter,
                ...(search ? { $or: [{ vehicleNumber: search }, { vehicleType: search }, { driverName: search }] } : {}),
            }),
        ]);
        const owners = await models_1.User.find({ _id: { $in: vehicleRows.map((row) => row.ownerId) } }).select('fullName phone email').lean();
        const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));
        rows = vehicleRows.map((row) => {
            const owner = ownerById.get(String(row.ownerId));
            return {
                id: String(row._id),
                owner_id: String(row.ownerId),
                vehicle_number: row.vehicleNumber,
                vehicle_type: row.vehicleType,
                capacity: row.capacity,
                capacity_unit: row.capacityUnit,
                driver_name: row.driverName,
                driver_mobile: row.driverMobile,
                availability_status: row.availabilityStatus,
                is_active: row.isActive,
                created_at: row.createdAt,
                owner: owner ? { id: String(owner._id), full_name: owner.fullName, phone: owner.phone, email: owner.email } : null,
            };
        });
        count = total;
    }
    else if (resource === 'bookings' || resource === 'payments') {
        const bookingFilter = {
            ...filter,
            ...(resource === 'payments' ? { paymentMode: 'ONLINE' } : {}),
            ...(search ? {
                $or: [
                    { cargoDescription: search },
                    { pickupLocation: search },
                    { destination: search },
                    { paymentTransactionId: search },
                ],
            } : {}),
        };
        const [bookingRows, total] = await Promise.all([
            models_1.Booking.find(bookingFilter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize),
            models_1.Booking.countDocuments(bookingFilter),
        ]);
        rows = await Promise.all(bookingRows.map(adminBooking));
        count = total;
    }
    else if (resource === 'trips') {
        [rows, count] = await Promise.all([
            models_1.Trip.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean(),
            models_1.Trip.countDocuments(filter),
        ]);
        rows = rows.map((trip) => ({
            id: String(trip._id),
            booking_id: String(trip.bookingId),
            vehicle_id: String(trip.vehicleId),
            owner_id: String(trip.ownerId),
            journey_id: trip.journeyId ? String(trip.journeyId) : null,
            status: trip.status,
            created_at: trip.createdAt,
        }));
    }
    else {
        filter = search
            ? { $or: [{ title: search }, { message: search }] }
            : {};
        const [notificationRows, total] = await Promise.all([
            models_1.Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean(),
            models_1.Notification.countDocuments(filter),
        ]);
        const users = await models_1.User.find({ _id: { $in: notificationRows.map((row) => row.userId) } }).select('fullName phone email').lean();
        const userById = new Map(users.map((user) => [String(user._id), user]));
        rows = notificationRows.map((row) => {
            const user = userById.get(String(row.userId));
            return {
                id: String(row._id),
                user_id: String(row.userId),
                title: row.title,
                message: row.message,
                booking_id: row.bookingId ? String(row.bookingId) : null,
                journey_id: row.journeyId ? String(row.journeyId) : null,
                is_read: row.isRead,
                created_at: row.createdAt,
                user: user ? { id: String(user._id), full_name: user.fullName, phone: user.phone, email: user.email } : null,
            };
        });
        count = total;
    }
    res.json({ rows, count, page: query.page, pageSize: query.pageSize });
});
router.get('/bookings/:id', async (req, res) => {
    if (!(0, mongoose_1.isValidObjectId)(req.params.id))
        throw new errors_1.HttpError(400, 'Invalid booking id.');
    const booking = await models_1.Booking.findById(new mongoose_1.Types.ObjectId(req.params.id));
    if (!booking)
        throw new errors_1.HttpError(404, 'Booking was not found.');
    res.json(await adminBooking(booking));
});
exports.default = router;
