import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError, badRequest, payloadTooLarge, unsupportedMedia } from '../lib/errors.js';
import { validateUploadedImage, ALLOWED_IMAGE_TYPES } from '../lib/image.js';
import { decryptSecret } from '../lib/keyVault.js';
import { sanitizeText } from '../lib/text.js';
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

const historyTurnSchema = z
  .object({
    role: z.enum(['user', 'model']),
    text: z.string().min(1).max(config.maxMessageChars),
  })
  .strict();

const historySchema = z.array(historyTurnSchema).max(config.maxHistoryTurns);

function parseHistory(rawHistory) {
  if (rawHistory === undefined || rawHistory === null || rawHistory === '') return [];

  let value = rawHistory;
  if (typeof rawHistory === 'string') {
    if (rawHistory.length > 250000) {
      throw badRequest('Conversation history is too large. Start a new chat.', 'HISTORY_TOO_LARGE');
    }
    try {
      value = JSON.parse(rawHistory);
    } catch {
      throw badRequest('Conversation history must be valid JSON.', 'INVALID_HISTORY');
    }
  } else if (typeof rawHistory !== 'object') {
    throw badRequest('Conversation history is invalid.', 'INVALID_HISTORY');
  }

  const parsed = historySchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('Conversation history is invalid.', 'INVALID_HISTORY');
  }

  const turns = parsed.data
    .map((turn) => ({ role: turn.role, text: sanitizeText(turn.text) }))
    .filter((turn) => turn.text.length > 0);

  const totalChars = turns.reduce((total, turn) => total + turn.text.length, 0);
  if (totalChars > config.maxHistoryChars) {
    throw badRequest('Conversation history is too large. Start a new chat.', 'HISTORY_TOO_LARGE');
  }

  return turns;
}

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

      let message = '';
      if (rawMessage !== undefined) {
        if (typeof rawMessage !== 'string') {
          throw badRequest('The message must be text.', 'INVALID_MESSAGE');
        }
        message = sanitizeText(rawMessage);
        if (message.length > config.maxMessageChars) {
          throw badRequest(
            `The message must be ${config.maxMessageChars} characters or fewer.`,
            'MESSAGE_TOO_LONG',
          );
        }
      }

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
