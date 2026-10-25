import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { AppError, badRequest, unsupportedMedia } from '../lib/errors.js';
import { parseHistory, parseMessage } from '../lib/chatInput.js';
import { parseTextFile } from '../lib/files.js';
import { generateChatReply } from '../services/chat.js';
import { chatLimiter } from '../middleware/rateLimits.js';
import { requireSameOrigin } from '../middleware/sameOrigin.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.chatMaxFileBytes,
    files: 1,
    fields: 3,
    fieldSize: 256 * 1024,
    parts: 6,
    headerPairs: 100,
  },
});

function limitContentLength(req, res, next) {
  const declaredLength = Number(req.get('content-length'));
  const maxBytes = config.chatMaxFileBytes + 288 * 1024;
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return next(new AppError(413, 'REQUEST_TOO_LARGE', 'The request is too large.'));
  }
  return next();
}

export const chatRouter = Router();

chatRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

chatRouter.post(
  '/',
  requireSameOrigin,
  chatLimiter,
  limitContentLength,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (
        req.body?.image !== undefined ||
        req.body?.images !== undefined ||
        req.body?.imageData !== undefined
      ) {
        throw unsupportedMedia(
          'Images are not supported. Attach a text or code file instead.',
          'UNSUPPORTED_MEDIA_TYPE',
        );
      }

      const message = parseMessage(req.body?.message, config.chatMaxMessageChars);
      const file = req.file
        ? parseTextFile(req.file, {
            maxBytes: config.chatMaxFileBytes,
            maxChars: config.chatMaxFileChars,
          })
        : null;

      if (!message && !file) {
        throw badRequest('Provide a message or a text/code file.', 'MESSAGE_REQUIRED');
      }

      const history = parseHistory(req.body?.history, {
        maxTurns: config.chatMaxHistoryTurns,
        maxChars: config.chatMaxHistoryChars,
        maxTurnChars: config.chatMaxFileChars + config.chatMaxMessageChars + 1024,
      });

      const reply = await generateChatReply({
        history,
        message,
        file,
        requestId: req.id,
      });

      return res.json({ reply });
    } catch (error) {
      return next(error);
    }
  },
);
