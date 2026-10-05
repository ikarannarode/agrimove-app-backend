import cron from 'node-cron';
import { env } from '../config';
import { Booking } from '../models';
import { deletePrivateImage } from './cloudinary';
import { publishDataChange } from '../realtime';

let scheduled: ReturnType<typeof cron.schedule> | null = null;

export function startPaymentCleanup() {
  if (scheduled) return;
  scheduled = cron.schedule('*/15 * * * *', () => {
    void deleteExpiredPaymentScreenshots().catch((error: unknown) => {
      console.error('Payment screenshot cleanup failed:', error);
    });
  });
}

export function stopPaymentCleanup() {
  scheduled?.stop();
  scheduled = null;
}

export async function deleteExpiredPaymentScreenshots(now = new Date()) {
  const expired = await Booking.find({
    paymentStatus: 'COMPLETED',
    paymentDeleteAt: { $lte: now },
    paymentScreenshotPublicId: { $ne: null },
  }).limit(100);
  let deleted = 0;
  for (const booking of expired) {
    const publicId = booking.paymentScreenshotPublicId;
    if (!publicId) continue;
    await deletePrivateImage(publicId);
    booking.paymentScreenshotPublicId = null;
    booking.paymentScreenshotFormat = null;
    booking.paymentDeleteAt = null;
    booking.paymentDeletedAt = new Date();
    await booking.save();
    publishDataChange(
      [String(booking.ownerId), String(booking.farmerId)],
      'payments',
      'screenshot_deleted',
      String(booking._id),
    );
    deleted += 1;
  }
  return { deleted, batchSize: expired.length, retentionHours: env.PAYMENT_SCREENSHOT_RETENTION_HOURS };
}
