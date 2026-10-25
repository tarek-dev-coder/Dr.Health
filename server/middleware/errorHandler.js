import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger, serializeError } from '../lib/logger.js';

function multerStatus(code) {
  if (code === 'LIMIT_FILE_SIZE') {
    return { status: 413, code: 'FILE_TOO_LARGE', message: 'The attached file is too large.' };
  }
  if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') {
    return { status: 400, code: 'UNEXPECTED_FILE', message: 'Only one file may be attached.' };
  }
  if (code === 'LIMIT_FIELD_VALUE' || code === 'LIMIT_FIELD_COUNT' || code === 'LIMIT_PART_COUNT') {
    return { status: 400, code: 'INVALID_UPLOAD', message: 'The submitted form is too large or invalid.' };
  }
  return { status: 400, code: 'INVALID_UPLOAD', message: 'The file could not be processed.' };
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred. Please try again.';
  let debug;

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error?.name === 'MulterError') {
    ({ status, code, message } = multerStatus(error.code));
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body must be valid JSON.';
  } else if (error?.type === 'entity.too.large' || error?.status === 413) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (error?.status === 400) {
    status = 400;
    code = 'INVALID_REQUEST';
    message = 'The request could not be processed.';
  }

  if (status >= 500) {
    logger.error('request_failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status,
      error: serializeError(error),
    });
  }

  if (!config.isProduction && !(error instanceof AppError) && status >= 500) {
    debug = {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    };
  }

  const retryAfterSeconds =
    error instanceof AppError ? error.retryAfterSeconds : undefined;

  res.set('Cache-Control', 'no-store');
  if (retryAfterSeconds) {
    res.set('Retry-After', String(retryAfterSeconds));
  }
  return res.status(status).json({
    error: {
      code,
      message,
      requestId: req.id,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      ...(debug ? { debug } : {}),
    },
  });
}
