import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config';
import { HttpError } from '../errors';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type MediaKind = 'owner-payment-qr' | 'payment-screenshots';

export async function uploadPrivateImage(
  file: Express.Multer.File,
  kind: MediaKind,
  ownerId: string,
  bookingId?: string,
) {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new HttpError(503, 'File uploads are not configured.');
  }
  const folder = kind === 'owner-payment-qr'
    ? `agrimove/qr/${ownerId}`
    : `agrimove/payments/${ownerId}/${bookingId}`;
  return new Promise<{ publicId: string; format: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder,
      resource_type: 'image',
      type: 'authenticated',
      overwrite: false,
      unique_filename: true,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
    }, (error, result) => {
      if (error) {
        reject(new HttpError(502, `Secure image upload failed: ${error.message}`));
      } else if (!result?.public_id || !result.format) {
        reject(new HttpError(502, 'Image service did not return a stored image.'));
      } else {
        resolve({ publicId: result.public_id, format: result.format });
      }
    });
    stream.end(file.buffer);
  });
}

export function privateImageUrl(publicId: string, format: string) {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new HttpError(503, 'File delivery is not configured.');
  }
  return cloudinary.utils.private_download_url(publicId, format, {
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    attachment: false,
  });
}

export async function deletePrivateImage(publicId: string) {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new HttpError(503, 'File deletion is not configured.');
  }
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    type: 'authenticated',
    invalidate: true,
  });
  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new Error(`Cloudinary image deletion returned ${result.result}.`);
  }
}
