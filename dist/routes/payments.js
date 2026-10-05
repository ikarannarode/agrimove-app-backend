"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const mongoose_1 = require("mongoose");
const zod_1 = require("zod");
const config_1 = require("../config");
const errors_1 = require("../errors");
const middleware_1 = require("../middleware");
const models_1 = require("../models");
const cloudinary_1 = require("../services/cloudinary");
const realtime_1 = require("../realtime");
const router = (0, express_1.Router)();
router.use(middleware_1.authenticate);
const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            callback(new errors_1.HttpError(415, 'Upload a JPG, PNG, or WEBP image.'));
            return;
        }
        callback(null, true);
    },
});
const objectId = (value) => {
    if (typeof value !== 'string' || !(0, mongoose_1.isValidObjectId)(value))
        throw new errors_1.HttpError(400, 'Invalid resource id.');
    return new mongoose_1.Types.ObjectId(value);
};
function validateImageContents(file) {
    const bytes = file.buffer;
    const detected = bytes.length >= 12
        && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? 'image/jpeg'
        : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
            ? 'image/png'
            : bytes.length >= 12
                && bytes.toString('ascii', 0, 4) === 'RIFF'
                && bytes.toString('ascii', 8, 12) === 'WEBP'
                ? 'image/webp'
                : null;
    if (!detected || !allowedImageTypes.includes(detected)) {
        throw new errors_1.HttpError(415, 'The selected file is not a valid JPG, PNG, or WEBP image.');
    }
    if (file.mimetype !== detected && !(detected === 'image/jpeg' && file.mimetype === 'image/jpg')) {
        throw new errors_1.HttpError(415, 'The image content does not match its declared file type.');
    }
    return detected;
}
router.get('/settings', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const user = await models_1.User.findById(actor.id).select('upiId qrPublicId');
    if (!user)
        throw new errors_1.HttpError(404, 'Account was not found.');
    res.json({ upi_id: user.upiId, qr_public_id: user.qrPublicId, has_qr: Boolean(user.qrPublicId) });
});
router.get('/settings/availability/:ownerId', async (req, res) => {
    const owner = await models_1.User.findById(objectId(req.params.ownerId)).select('qrPublicId');
    if (!owner)
        throw new errors_1.HttpError(404, 'Vehicle owner was not found.');
    res.json({ has_qr: Boolean(owner.qrPublicId) });
});
router.put('/settings', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({
        upi_id: zod_1.z.string().trim().max(256).optional().nullable(),
        delete_qr: zod_1.z.boolean().optional(),
    }).strict().parse(req.body);
    if (body.upi_id && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(body.upi_id)) {
        throw new errors_1.HttpError(400, 'Enter a valid UPI ID or leave it blank.');
    }
    const user = await models_1.User.findById(actor.id).select('upiId qrPublicId qrFormat');
    if (!user)
        throw new errors_1.HttpError(404, 'Account was not found.');
    const previous = body.delete_qr ? user.qrPublicId : null;
    user.upiId = body.upi_id?.trim() || null;
    if (body.delete_qr) {
        user.qrPublicId = null;
        user.qrFormat = null;
    }
    await user.save();
    if (previous)
        await (0, cloudinary_1.deletePrivateImage)(previous);
    (0, realtime_1.publishDataChange)([actor.id], 'payment_settings', 'updated');
    (0, realtime_1.publishRoleChange)(['farmer'], 'payment_settings', 'updated');
    res.json({ upi_id: user.upiId, qr_public_id: user.qrPublicId, has_qr: Boolean(user.qrPublicId) });
});
router.post('/settings/qr', (0, middleware_1.requireRole)('vehicle_owner'), upload.single('image'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    if (!req.file)
        throw new errors_1.HttpError(400, 'Choose a QR image to upload.');
    if (req.file.size > 5 * 1024 * 1024)
        throw new errors_1.HttpError(413, 'QR image must not exceed 5 MB.');
    validateImageContents(req.file);
    const { upi_id: upiId } = zod_1.z.object({ upi_id: zod_1.z.string().trim().max(256).optional() }).parse(req.body);
    if (upiId && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(upiId)) {
        throw new errors_1.HttpError(400, 'Enter a valid UPI ID or leave it blank.');
    }
    const uploaded = await (0, cloudinary_1.uploadPrivateImage)(req.file, 'owner-payment-qr', actor.id);
    const user = await models_1.User.findById(actor.id).select('qrPublicId qrFormat upiId');
    if (!user) {
        await (0, cloudinary_1.deletePrivateImage)(uploaded.publicId);
        throw new errors_1.HttpError(404, 'Account was not found.');
    }
    const previous = user.qrPublicId;
    user.qrPublicId = uploaded.publicId;
    user.qrFormat = uploaded.format;
    user.upiId = upiId || null;
    await user.save();
    if (previous)
        await (0, cloudinary_1.deletePrivateImage)(previous);
    (0, realtime_1.publishDataChange)([actor.id], 'payment_settings', 'qr_updated');
    (0, realtime_1.publishRoleChange)(['farmer'], 'payment_settings', 'qr_updated');
    res.status(201).json({ upi_id: user.upiId, qr_public_id: user.qrPublicId, has_qr: true });
});
router.get('/settings/qr/:ownerId', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const ownerId = objectId(req.params.ownerId);
    const owner = await models_1.User.findById(ownerId).select('qrPublicId qrFormat');
    if (!owner?.qrPublicId || !owner.qrFormat)
        throw new errors_1.HttpError(404, 'This vehicle owner has not added a payment QR.');
    if (actor.role !== 'vehicle_owner' || actor.id !== String(ownerId)) {
        const acceptedBooking = await models_1.Booking.exists({
            ownerId,
            farmerId: objectId(actor.id),
            status: 'ACCEPTED',
            paymentMode: 'ONLINE',
        });
        if (!acceptedBooking)
            throw new errors_1.HttpError(403, 'QR is available after the owner accepts an online booking.');
    }
    res.json({ url: (0, cloudinary_1.privateImageUrl)(owner.qrPublicId, owner.qrFormat) });
});
router.post('/bookings/:bookingId/proof', upload.single('image'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const bookingId = objectId(req.params.bookingId);
    const booking = await models_1.Booking.findOne({ _id: bookingId, farmerId: objectId(actor.id) });
    if (!booking)
        throw new errors_1.HttpError(404, 'Booking was not found.');
    if (booking.status !== 'ACCEPTED' || booking.paymentMode !== 'ONLINE' || !['PENDING', 'REJECTED'].includes(booking.paymentStatus)) {
        throw new errors_1.HttpError(409, 'This booking is not ready for payment proof.');
    }
    if (!req.file)
        throw new errors_1.HttpError(400, 'Choose a payment screenshot to upload.');
    validateImageContents(req.file);
    const transactionId = zod_1.z.string().trim().max(160).optional().parse(req.body.transaction_id);
    const uploaded = await (0, cloudinary_1.uploadPrivateImage)(req.file, 'payment-screenshots', actor.id, String(booking._id));
    const session = await (0, mongoose_1.startSession)();
    try {
        await session.withTransaction(async () => {
            const updatedBooking = await models_1.Booking.findOneAndUpdate({
                _id: booking._id,
                farmerId: objectId(actor.id),
                status: 'ACCEPTED',
                paymentMode: 'ONLINE',
                paymentStatus: { $in: ['PENDING', 'REJECTED'] },
            }, {
                $set: {
                    paymentScreenshotPublicId: uploaded.publicId,
                    paymentScreenshotFormat: uploaded.format,
                    paymentTransactionId: transactionId || null,
                    paymentSubmittedAt: new Date(),
                    paymentStatus: 'VERIFICATION_PENDING',
                    paymentApprovedAt: null,
                    paymentDeleteAt: null,
                    paymentDeletedAt: null,
                },
            }, { new: true, session });
            if (!updatedBooking)
                throw new errors_1.HttpError(409, 'This booking is no longer ready for payment proof.');
            await new models_1.Notification({
                userId: booking.ownerId,
                title: 'पेमेंट पुरावा प्राप्त',
                message: 'शेतकऱ्याने पेमेंट स्क्रीनशॉट पाठवला आहे. तपासणी करा.',
                bookingId: booking._id,
                journeyId: booking.journeyId,
            }).save({ session });
            await new models_1.Notification({
                userId: booking.ownerId,
                title: 'पेमेंट पडताळणी आवश्यक',
                message: 'नवीन ऑनलाइन पेमेंट तपासून स्वीकारा किंवा नाकारा.',
                bookingId: booking._id,
                journeyId: booking.journeyId,
            }).save({ session });
            await new models_1.Notification({
                userId: booking.farmerId,
                title: 'पेमेंट पडताळणी प्रलंबित',
                message: 'तुमचा पेमेंट पुरावा वाहनमालकाच्या पडताळणीसाठी पाठवला आहे.',
                bookingId: booking._id,
                journeyId: booking.journeyId,
            }).save({ session });
        });
    }
    catch (error) {
        await (0, cloudinary_1.deletePrivateImage)(uploaded.publicId);
        throw error;
    }
    finally {
        await session.endSession();
    }
    const updatedBooking = await models_1.Booking.findById(booking._id);
    if (!updatedBooking)
        throw new errors_1.HttpError(500, 'Payment proof could not be saved.');
    if (booking.paymentScreenshotPublicId && booking.paymentScreenshotPublicId !== uploaded.publicId) {
        await (0, cloudinary_1.deletePrivateImage)(booking.paymentScreenshotPublicId);
    }
    (0, realtime_1.publishDataChange)([String(booking.ownerId), String(booking.farmerId)], 'payments', 'proof_submitted', String(booking._id));
    res.status(201).json({
        id: String(updatedBooking._id),
        payment_status: updatedBooking.paymentStatus,
        payment_transaction_id: updatedBooking.paymentTransactionId,
        payment_submitted_at: updatedBooking.paymentSubmittedAt,
    });
});
router.get('/bookings/:bookingId/proof', async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const booking = await models_1.Booking.findById(objectId(req.params.bookingId));
    if (!booking || (String(booking.farmerId) !== actor.id && String(booking.ownerId) !== actor.id)) {
        throw new errors_1.HttpError(404, 'Payment proof was not found.');
    }
    if (!booking.paymentScreenshotPublicId || !booking.paymentScreenshotFormat) {
        throw new errors_1.HttpError(404, booking.paymentDeletedAt ? 'The screenshot was deleted for privacy.' : 'No payment screenshot is available.');
    }
    res.json({ url: (0, cloudinary_1.privateImageUrl)(booking.paymentScreenshotPublicId, booking.paymentScreenshotFormat) });
});
router.patch('/bookings/:bookingId/review', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const body = zod_1.z.object({ approved: zod_1.z.boolean() }).strict().parse(req.body);
    const session = await (0, mongoose_1.startSession)();
    try {
        await session.withTransaction(async () => {
            const now = new Date();
            const booking = await models_1.Booking.findOneAndUpdate({
                _id: objectId(req.params.bookingId),
                ownerId: objectId(actor.id),
                paymentMode: 'ONLINE',
                paymentStatus: 'VERIFICATION_PENDING',
            }, {
                $set: {
                    paymentStatus: body.approved ? 'COMPLETED' : 'REJECTED',
                    paymentApprovedAt: body.approved ? now : null,
                    paymentDeleteAt: body.approved
                        ? new Date(now.getTime() + config_1.env.PAYMENT_SCREENSHOT_RETENTION_HOURS * 3_600_000)
                        : null,
                },
            }, { new: true, session });
            if (!booking)
                throw new errors_1.HttpError(404, 'A payment awaiting your verification was not found.');
            await new models_1.Notification({
                userId: booking.farmerId,
                title: body.approved ? 'पेमेंट मंजूर' : 'पेमेंट नाकारले',
                message: body.approved ? 'वाहनमालकाने तुमचे पेमेंट मंजूर केले.' : 'वाहनमालकाने तुमचे पेमेंट नाकारले. कृपया तपशील तपासा.',
                bookingId: booking._id,
                journeyId: booking.journeyId,
            }).save({ session });
        });
    }
    finally {
        await session.endSession();
    }
    const booking = await models_1.Booking.findById(objectId(req.params.bookingId));
    if (!booking)
        throw new errors_1.HttpError(500, 'Payment review did not complete.');
    (0, realtime_1.publishDataChange)([String(booking.ownerId), String(booking.farmerId)], 'payments', body.approved ? 'approved' : 'rejected', String(booking._id));
    res.json({ id: String(booking._id), payment_status: booking.paymentStatus, payment_approved_at: booking.paymentApprovedAt, payment_delete_at: booking.paymentDeleteAt });
});
router.patch('/bookings/:bookingId/cash-payment', (0, middleware_1.requireRole)('vehicle_owner'), async (req, res) => {
    const actor = (0, middleware_1.authenticated)(req);
    const session = await (0, mongoose_1.startSession)();
    try {
        await session.withTransaction(async () => {
            const booking = await models_1.Booking.findOneAndUpdate({
                _id: objectId(req.params.bookingId),
                ownerId: objectId(actor.id),
                paymentMode: 'CASH',
                paymentStatus: 'PENDING',
                status: 'COMPLETED',
            }, {
                $set: { paymentStatus: 'COMPLETED', paymentApprovedAt: new Date() },
            }, { new: true, session });
            if (!booking)
                throw new errors_1.HttpError(409, 'Cash can be marked paid after the trip is completed.');
            await new models_1.Notification({
                userId: booking.farmerId,
                title: 'रोख पेमेंट पूर्ण',
                message: 'वाहनमालकाने रोख पेमेंट प्राप्त झाल्याची नोंद केली.',
                bookingId: booking._id,
                journeyId: booking.journeyId,
            }).save({ session });
        });
    }
    finally {
        await session.endSession();
    }
    const booking = await models_1.Booking.findById(objectId(req.params.bookingId));
    if (!booking)
        throw new errors_1.HttpError(500, 'Cash payment update did not complete.');
    (0, realtime_1.publishDataChange)([String(booking.ownerId), String(booking.farmerId)], 'payments', 'cash_completed', String(booking._id));
    res.json({ id: String(booking._id), payment_status: booking.paymentStatus });
});
exports.default = router;
