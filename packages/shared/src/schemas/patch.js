// @ts-check
import { z } from 'zod';

/** Removes `.default()` (and `.prefault()`) wrappers so a missing field stays missing. @param {any} s @returns {any} */
const withoutDefault = (s) =>
  s instanceof z.ZodDefault || (z.ZodPrefault && s instanceof z.ZodPrefault) ? withoutDefault(s.unwrap()) : s;

/**
 * Like `.partial().strict()`, but a field left out of a PATCH body is left out of the result. Zod's own
 * `.partial()` keeps defaults, which would silently reset fields the caller never sent.
 * @template {z.ZodRawShape} T
 * @param {z.ZodObject<T>} schema
 */
export function patchOf(schema) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [k, withoutDefault(v).optional()]),
  );
  return z.object(shape).strict();
}
