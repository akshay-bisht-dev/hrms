// @ts-check
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** Single registry that every module adds its routes and schemas to. */
export const registry = new OpenAPIRegistry();

export const ProblemSchema = registry.register(
  'Problem',
  z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    requestId: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
);

/** @returns {object} OpenAPI 3.1 document */
export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Workforce HRMS API',
      version: '1.0.0',
      description: 'Multi-tenant HRMS and remote workforce management API. All times are UTC (ISO-8601).',
    },
    servers: [{ url: '/' }],
  });
}

export { z };
