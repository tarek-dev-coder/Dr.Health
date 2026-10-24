import { unsupportedMedia } from './errors.js';

const ALLOWED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  if (buffer.length < 8) return false;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => buffer[index] === byte);
}

function isWebp(buffer) {
  if (buffer.length < 12) return false;
  return (
    buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

/**
 * Detect an image type from its magic bytes. Never trust the client MIME type.
 */
export function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isPng(buffer)) return 'image/png';
  if (isWebp(buffer)) return 'image/webp';
  return null;
}

/**
 * Validate an uploaded image and return a safe Gemini inline data payload.
 * Files stay in memory and are never written to disk.
 */
export function validateUploadedImage(file, maxBytes) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw unsupportedMedia('The uploaded file could not be read.', 'INVALID_UPLOAD');
  }
  if (file.size === 0 || file.buffer.length === 0) {
    throw unsupportedMedia('The uploaded image is empty.', 'EMPTY_UPLOAD');
  }
  if (file.size > maxBytes || file.buffer.length > maxBytes) {
    throw unsupportedMedia('The uploaded image is too large.', 'IMAGE_TOO_LARGE');
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw unsupportedMedia('Only JPEG, PNG, and WebP images are supported.', 'UNSUPPORTED_IMAGE');
  }

  const detected = detectImageMime(file.buffer);
  if (!detected) {
    throw unsupportedMedia('The uploaded file is not a valid image.', 'INVALID_IMAGE');
  }
  if (detected !== file.mimetype) {
    throw unsupportedMedia('The image content does not match its declared type.', 'IMAGE_TYPE_MISMATCH');
  }

  return {
    mimeType: detected,
    // Gemini accepts inline base64 payloads.
    data: file.buffer.toString('base64'),
  };
}

export { ALLOWED_IMAGE_TYPES };
