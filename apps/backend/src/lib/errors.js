// @ts-check
/** Base class for errors that are safe to show to API clients (RFC 9457 problem details). */
export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code stable machine-readable code
   * @param {string} title human-readable summary
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, code, title, extra = {}) {
    super(title);
    this.status = status;
    this.code = code;
    this.title = title;
    this.extra = extra;
  }
}

export class ValidationError extends AppError {
  /** @param {Array<{ path: string, message: string }>} errors */
  constructor(errors) {
    super(422, 'validation_failed', 'Some fields are invalid', { errors });
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super(404, 'not_found', 'Not found');
  }
}

export class ForbiddenError extends AppError {
  /** @param {string} [code] @param {string} [title] */
  constructor(code = 'forbidden', title = 'You do not have access to this action') {
    super(403, code, title);
  }
}

export class UnauthorizedError extends AppError {
  /** @param {string} [code] @param {string} [title] */
  constructor(code = 'unauthenticated', title = 'Sign in to continue') {
    super(401, code, title);
  }
}

export class TooManyRequestsError extends AppError {
  /** @param {number} retryAfterSec */
  constructor(retryAfterSec) {
    super(429, 'too_many_requests', 'Too many attempts. Try again later.', { retryAfterSec });
  }
}

export class ConflictError extends AppError {
  /** @param {string} code @param {string} title */
  constructor(code, title) {
    super(409, code, title);
  }
}
