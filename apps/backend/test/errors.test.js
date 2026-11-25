import { toAppError } from '../src/middleware/error-handler.js';
import { AppError, ValidationError } from '../src/lib/errors.js';

describe('toAppError', () => {
  test('keeps application errors', () => {
    const e = new ValidationError([{ path: 'body.name', message: 'Required' }]);
    expect(toAppError(e)).toBe(e);
  });
  test('maps database immutability trigger to 409', () => {
    expect(toAppError(new Error('... IMMUTABLE: payroll run is finalized'))).toMatchObject({
      status: 409,
      code: 'immutable_record',
    });
  });
  test('maps Prisma unique violation to 409 and not-found to 404', () => {
    expect(toAppError({ code: 'P2002', message: 'x' }).status).toBe(409);
    expect(toAppError({ code: 'P2025', message: 'x' }).status).toBe(404);
  });
  test('hides unknown errors behind a generic 500', () => {
    const e = toAppError(new Error('connect ECONNREFUSED db-internal:3306'));
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(500);
    expect(e.title).not.toMatch(/ECONNREFUSED/);
  });
});
