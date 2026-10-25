export class AppError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = options.expose !== false;
    this.retryAfterSeconds =
      Number.isInteger(options.retryAfterSeconds) && options.retryAfterSeconds > 0
        ? options.retryAfterSeconds
        : undefined;
  }
}

export const badRequest = (message, code = 'BAD_REQUEST') => new AppError(400, code, message);
export const forbidden = (message, code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
