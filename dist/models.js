"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notification = exports.Trip = exports.Booking = exports.Journey = exports.Vehicle = exports.AuthToken = exports.User = void 0;
const mongoose_1 = require("mongoose");
const userSchema = new mongoose_1.Schema({
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: null, trim: true, maxlength: 24 },
    role: { type: String, enum: ['farmer', 'vehicle_owner', 'admin'], required: true, immutable: true },
    passwordHash: { type: String, default: null, select: false },
    emailVerifiedAt: { type: Date, default: null },
    passwordResetRequired: { type: Boolean, default: false },
    upiId: { type: String, default: null, trim: true },
    qrPublicId: { type: String, default: null },
    qrFormat: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
const tokenSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['verify_email', 'reset_password', 'refresh'], required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
const vehicleSchema = new mongoose_1.Schema({
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
    vehicleType: { type: String, required: true, trim: true, maxlength: 60 },
    capacity: { type: Number, required: true, min: 0.01 },
    capacityUnit: { type: String, default: 'kg', trim: true, maxlength: 16 },
    driverName: { type: String, required: true, trim: true, maxlength: 120 },
    driverMobile: { type: String, required: true, trim: true, maxlength: 24 },
    availabilityStatus: { type: String, enum: ['AVAILABLE', 'RESERVED', 'ON_JOURNEY', 'COMPLETED'], default: 'AVAILABLE' },
    isActive: { type: Boolean, default: true },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
vehicleSchema.index({ isActive: 1, availabilityStatus: 1, vehicleType: 1, capacity: 1 });
const journeySchema = new mongoose_1.Schema({
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    pickupLocation: { type: String, required: true, trim: true, maxlength: 240 },
    destination: { type: String, required: true, trim: true, maxlength: 240 },
    pickupLatitude: { type: Number, min: -90, max: 90, default: null },
    pickupLongitude: { type: Number, min: -180, max: 180, default: null },
    destinationLatitude: { type: Number, min: -90, max: 90, default: null },
    destinationLongitude: { type: Number, min: -180, max: 180, default: null },
    scheduledDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    scheduledTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    capacity: { type: Number, required: true, min: 0.01 },
    reservedCapacity: { type: Number, default: 0, min: 0 },
    capacityUnit: { type: String, required: true, trim: true, maxlength: 16 },
    status: { type: String, enum: ['AVAILABLE', 'BOOKED', 'ON_JOURNEY', 'COMPLETED', 'CANCELLED'], default: 'AVAILABLE' },
    notes: { type: String, default: null, maxlength: 1000 },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
journeySchema.index({ status: 1, scheduledDate: 1, pickupLocation: 1, destination: 1 });
const bookingSchema = new mongoose_1.Schema({
    farmerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    journeyId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Journey', default: null, index: true },
    cargoDescription: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0.01 },
    pickupLocation: { type: String, required: true, trim: true, maxlength: 240 },
    destination: { type: String, required: true, trim: true, maxlength: 240 },
    pickupLatitude: { type: Number, min: -90, max: 90, default: null },
    pickupLongitude: { type: Number, min: -180, max: 180, default: null },
    destinationLatitude: { type: Number, min: -90, max: 90, default: null },
    destinationLongitude: { type: Number, min: -180, max: 180, default: null },
    bookingDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    bookingTime: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    additionalNote: { type: String, default: null, maxlength: 1000 },
    paymentMode: { type: String, enum: ['CASH', 'ONLINE'], default: 'CASH' },
    paymentStatus: { type: String, enum: ['PENDING', 'VERIFICATION_PENDING', 'COMPLETED', 'REJECTED'], default: 'PENDING' },
    paymentAmount: { type: Number, default: null, min: 0 },
    paymentTransactionId: { type: String, default: null, maxlength: 160 },
    paymentScreenshotPublicId: { type: String, default: null },
    paymentScreenshotFormat: { type: String, default: null },
    paymentSubmittedAt: { type: Date, default: null },
    paymentApprovedAt: { type: Date, default: null },
    paymentDeleteAt: { type: Date, default: null },
    paymentDeletedAt: { type: Date, default: null },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'], default: 'PENDING', index: true },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
bookingSchema.index({ farmerId: 1, createdAt: -1 });
bookingSchema.index({ ownerId: 1, createdAt: -1 });
bookingSchema.index({ paymentStatus: 1, paymentDeleteAt: 1 });
const tripSchema = new mongoose_1.Schema({
    bookingId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true },
    journeyId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Journey', default: null, index: true },
    vehicleId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['RESERVED', 'ON_JOURNEY', 'COMPLETED'], default: 'RESERVED' },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
const notificationSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 1000 },
    bookingId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Booking', default: null },
    journeyId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Journey', default: null },
    isRead: { type: Boolean, default: false, index: true },
    legacySupabaseId: { type: String, default: null, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });
notificationSchema.index({ userId: 1, createdAt: -1 });
exports.User = (0, mongoose_1.model)('User', userSchema);
exports.AuthToken = (0, mongoose_1.model)('AuthToken', tokenSchema);
exports.Vehicle = (0, mongoose_1.model)('Vehicle', vehicleSchema);
exports.Journey = (0, mongoose_1.model)('Journey', journeySchema);
exports.Booking = (0, mongoose_1.model)('Booking', bookingSchema);
exports.Trip = (0, mongoose_1.model)('Trip', tripSchema);
exports.Notification = (0, mongoose_1.model)('Notification', notificationSchema);
