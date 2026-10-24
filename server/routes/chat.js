import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { AppError, badRequest, payloadTooLarge, unsupportedMedia } from '../lib/errors.js';
import { parseHistory, parseMessage } from '../lib/chatInput.js';
import { validateUploadedImage, ALLOWED_IMAGE_TYPES } from '../lib/image.js';
import { decryptSecret } from '../lib/keyVault.js';
import { metrics } from '../lib/metrics.js';
import { logger } from '../lib/logger.js';
import { generateReply, DEFAULT_IMAGE_PROMPT } from '../services/openrouter.js';
import { chatLimiter } from '../middleware/rateLimits.js';
import { requireUser } from '../middleware/userAuth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 4,
    // Large enough for a valid history payload; the route enforces the real
    // character limit after parsing.
    fieldSize: 128 * 1024,
    parts: 8,
    headerPairs: 100,
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return callback(
        unsupportedMedia('Only JPEG, PNG, and WebP images are supported.', 'UNSUPPORTED_IMAGE'),
      );
    }
    return callback(null, true);
  },
});

function limitContentLength(req, res, next) {
  const declaredLength = Number(req.get('content-length'));
  const maxBytes = config.maxUploadBytes + 64 * 1024;
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return next(payloadTooLarge('The uploaded request is too large.', 'REQUEST_TOO_LARGE'));
  }
  return next();
}

export const chatRouter = Router();

chatRouter.post(
  '/',
  requireUser,
  chatLimiter,
  limitContentLength,
  upload.single('image'),
  async (req, res, next) => {
    metrics.chatRequests += 1;

    try {
      const rawMessage = req.body?.message;
      const rawHistory = req.body?.history;
      const message = parseMessage(rawMessage, config.maxMessageChars);

      if (!message && !req.file) {
        throw badRequest('Provide a message or an image.', 'MESSAGE_REQUIRED');
      }

      const history = parseHistory(rawHistory);
      const image = req.file ? validateUploadedImage(req.file, config.maxUploadBytes) : null;

      const contents = history.map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.text }],
      }));

      const parts = [];
      if (message) {
        parts.push({ text: message });
      } else {
        parts.push({ text: DEFAULT_IMAGE_PROMPT });
      }
      if (image) {
        parts.push({ inlineData: image });
      }
      contents.push({ role: 'user', parts });

      let apiKey;
      try {
        apiKey = decryptSecret({
          ciphertext: req.user.keyCiphertext,
          iv: req.user.keyIv,
          tag: req.user.keyTag,
        });
      } catch {
        logger.warn('key_decrypt_failed', {
          requestId: req.id,
          userId: req.user.id,
        });
        throw new AppError(
          401,
          'AI_KEY_INVALID',
          'Your AI connection has expired. Please sign in again.',
        );
      }

      const reply = await generateReply({ contents, apiKey, requestId: req.id });

      res.set('Cache-Control', 'no-store');
      res.json({ reply });
    } catch (error) {
      metrics.chatFailures += 1;
      next(error);
    }
  },
);
