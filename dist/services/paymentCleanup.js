"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPaymentCleanup = startPaymentCleanup;
exports.stopPaymentCleanup = stopPaymentCleanup;
exports.deleteExpiredPaymentScreenshots = deleteExpiredPaymentScreenshots;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("../config");
const models_1 = require("../models");
const cloudinary_1 = require("./cloudinary");
const realtime_1 = require("../realtime");
let scheduled = null;
function startPaymentCleanup() {
    if (scheduled)
        return;
    scheduled = node_cron_1.default.schedule('*/15 * * * *', () => {
        void deleteExpiredPaymentScreenshots().catch((error) => {
            console.error('Payment screenshot cleanup failed:', error);
        });
    });
}
function stopPaymentCleanup() {
    scheduled?.stop();
    scheduled = null;
}
async function deleteExpiredPaymentScreenshots(now = new Date()) {
    const expired = await models_1.Booking.find({
        paymentStatus: 'COMPLETED',
        paymentDeleteAt: { $lte: now },
        paymentScreenshotPublicId: { $ne: null },
    }).limit(100);
    let deleted = 0;
    for (const booking of expired) {
        const publicId = booking.paymentScreenshotPublicId;
        if (!publicId)
            continue;
        await (0, cloudinary_1.deletePrivateImage)(publicId);
        booking.paymentScreenshotPublicId = null;
        booking.paymentScreenshotFormat = null;
        booking.paymentDeleteAt = null;
        booking.paymentDeletedAt = new Date();
        await booking.save();
        (0, realtime_1.publishDataChange)([String(booking.ownerId), String(booking.farmerId)], 'payments', 'screenshot_deleted', String(booking._id));
        deleted += 1;
    }
    return { deleted, batchSize: expired.length, retentionHours: config_1.env.PAYMENT_SCREENSHOT_RETENTION_HOURS };
}
