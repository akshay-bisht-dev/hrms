// @ts-check
import { AppError, NotFoundError } from '../lib/errors.js';

/** @type {import('express').RequestHandler} */
export function notFound(_req, _res, next) {
  next(new NotFoundError());
}

/**
 * Maps a thrown value to an AppError. Database details never reach the client.
 * @param {any} err
 * @returns {AppError}
 */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  const message = String(err?.message ?? '');
  if (message.includes('IMMUTABLE:')) {
    return new AppError(409, 'immutable_record', 'This record is locked and cannot be changed');
  }
  if (err?.code === 'P2002')
    return new AppError(409, 'duplicate', 'A record with these values already exists');
  if (err?.code === 'P2025') return new AppError(404, 'not_found', 'Not found');
  if (err?.code === 'P2003')
    return new AppError(422, 'invalid_reference', 'A referenced record does not exist');
  if (err?.type === 'entity.parse.failed')
    return new AppError(400, 'invalid_json', 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large')
    return new AppError(413, 'payload_too_large', 'Request body is too large');
  return new AppError(500, 'internal_error', 'Something went wrong');
}

/**
 * Final error handler: application/problem+json with the request ID (Phase 3, APP-07).
 * @param {import('pino').Logger} logger
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler(logger) {
  return (err, req, res, _next) => {
    const appErr = toAppError(err);
    // @ts-ignore
    const requestId = req.id;
    if (appErr.status >= 500) logger.error({ err, requestId }, 'Unhandled error');
    else logger.debug({ code: appErr.code, requestId }, 'Request failed');
    res
      .status(appErr.status)
      .type('application/problem+json')
      .json({
        type: `https://docs.hrms.example/errors/${appErr.code}`,
        title: appErr.title,
        status: appErr.status,
        code: appErr.code,
        requestId,
        ...appErr.extra,
      });
  };
}
