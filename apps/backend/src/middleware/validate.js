// @ts-check
import { ValidationError } from '../lib/errors.js';

/**
 * Validates and replaces req.body / req.query / req.params with parsed Zod output.
 * Unknown keys are rejected when the schema is `.strict()` (Phase 3, APP-05).
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    /** @type {Array<{ path: string, message: string }>} */
    const errors = [];
    for (const part of /** @type {const} */ (['params', 'query', 'body'])) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        // Express 5 makes req.query a getter; define the parsed value explicitly.
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
      } else {
        for (const issue of result.error.issues) {
          errors.push({ path: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }
    if (errors.length) return next(new ValidationError(errors));
    next();
  };
}
