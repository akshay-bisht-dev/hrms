// @ts-check
import { Router } from 'express';
import { registry, z } from '../../openapi/registry.js';

const Country = registry.register(
  'Country',
  z.object({
    code: z.string().length(2),
    name: z.string(),
    currency: z.string().length(3),
    payrollCoverage: z.enum(['NATIVE', 'CONFIGURABLE', 'EXPORT']),
  }),
);
registry.registerPath({
  method: 'get',
  path: '/api/v1/reference/countries',
  tags: ['Reference'],
  summary: 'Countries a company can register in',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: z.object({ data: z.array(Country) }) } },
    },
  },
});

/**
 * Public reference data (no tenant data). Cached by browsers and CDNs for an hour.
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>, platformDb: () => any }} deps
 */
export function referenceRouter({ access, platformDb }) {
  const r = Router();
  r.get('/countries', access.public(), async (_req, res) => {
    const rows = await platformDb().countryProfile.findMany({ orderBy: { name: 'asc' } });
    res.set('Cache-Control', 'public, max-age=3600').json({
      data: rows.map((c) => ({
        code: c.code,
        name: c.name,
        currency: c.defaultCurrency,
        payrollCoverage: c.payrollCoverage,
      })),
    });
  });
  return r;
}
