"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadPrivateImage = uploadPrivateImage;
exports.privateImageUrl = privateImageUrl;
exports.deletePrivateImage = deletePrivateImage;
const cloudinary_1 = require("cloudinary");
const config_1 = require("../config");
const errors_1 = require("../errors");
cloudinary_1.v2.config({
    cloud_name: config_1.env.CLOUDINARY_CLOUD_NAME,
    api_key: config_1.env.CLOUDINARY_API_KEY,
    api_secret: config_1.env.CLOUDINARY_API_SECRET,
    secure: true,
});
async function uploadPrivateImage(file, kind, ownerId, bookingId) {
    if (!config_1.env.CLOUDINARY_CLOUD_NAME || !config_1.env.CLOUDINARY_API_KEY || !config_1.env.CLOUDINARY_API_SECRET) {
        throw new errors_1.HttpError(503, 'File uploads are not configured.');
    }
    const folder = kind === 'owner-payment-qr'
        ? `agrimove/qr/${ownerId}`
        : `agrimove/payments/${ownerId}/${bookingId}`;
    return new Promise((resolve, reject) => {
        const stream = cloudinary_1.v2.uploader.upload_stream({
            folder,
            resource_type: 'image',
            type: 'authenticated',
            overwrite: false,
            unique_filename: true,
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
        }, (error, result) => {
            if (error) {
                reject(new errors_1.HttpError(502, `Secure image upload failed: ${error.message}`));
            }
            else if (!result?.public_id || !result.format) {
                reject(new errors_1.HttpError(502, 'Image service did not return a stored image.'));
            }
            else {
                resolve({ publicId: result.public_id, format: result.format });
            }
        });
        stream.end(file.buffer);
    });
}
function privateImageUrl(publicId, format) {
    if (!config_1.env.CLOUDINARY_CLOUD_NAME || !config_1.env.CLOUDINARY_API_KEY || !config_1.env.CLOUDINARY_API_SECRET) {
        throw new errors_1.HttpError(503, 'File delivery is not configured.');
    }
    return cloudinary_1.v2.utils.private_download_url(publicId, format, {
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
        attachment: false,
    });
}
async function deletePrivateImage(publicId) {
    if (!config_1.env.CLOUDINARY_CLOUD_NAME || !config_1.env.CLOUDINARY_API_KEY || !config_1.env.CLOUDINARY_API_SECRET) {
        throw new errors_1.HttpError(503, 'File deletion is not configured.');
    }
    const result = await cloudinary_1.v2.uploader.destroy(publicId, {
        resource_type: 'image',
        type: 'authenticated',
        invalidate: true,
    });
    if (result.result !== 'ok' && result.result !== 'not found') {
        throw new Error(`Cloudinary image deletion returned ${result.result}.`);
    }
}
