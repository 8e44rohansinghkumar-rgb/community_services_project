/**
 * Application error taxonomy.
 *
 * Every error thrown intentionally by the application carries a stable machine
 * code, an HTTP status, and a message that is safe to show a client. The central
 * error handler serialises exactly these; anything else becomes a generic 500 so
 * stack traces, SQL text and file paths never reach the wire.
 */

export type ErrorDetail = { field?: string; message: string };

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetail[];
  /** True when the message is intentionally client-safe. */
  public readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid', details?: ErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    super(401, code, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super(404, code, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state', code = 'CONFLICT') {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'The request payload is too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please slow down and try again shortly.') {
    super(429, 'RATE_LIMITED', message);
  }
}

/** Invalid issue lifecycle transition — distinct code so the UI can explain it. */
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, 'INVALID_TRANSITION', `An issue cannot move from ${from} to ${to}`);
  }
}
