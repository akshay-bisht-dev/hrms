// @ts-check
import { z } from 'zod';
import { newId } from '@hrms/shared/ids';
import { audit } from './audit.js';
import { db } from './db.js';
import { AppError, NotFoundError } from './errors.js';
import { validate } from '../middleware/validate.js';
import { registry } from '../openapi/registry.js';

export const ListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export const IdParams = z.object({ id: z.uuid() }).strict();

/** Strips tenantId from API responses (the client never needs or sends it). @param {any} row */
export const withoutTenant = (row) => {
  if (!row) return row;
  const { tenantId: _t, ...rest } = row;
  return rest;
};

/**
 * Registers list/get/create/update/delete routes for a tenant-owned model.
 * Tenant scoping comes from the Prisma extension; cross-tenant references fail on composite foreign keys.
 * Deletes are hard deletes guarded by RESTRICT foreign keys: a row still in use returns 409 "in_use".
 *
 * @param {import('express').Router} router
 * @param {object} cfg
 * @param {string} cfg.path e.g. '/branches'
 * @param {string} cfg.model Prisma model delegate name, e.g. 'branch'
 * @param {string} cfg.entityType audit entity type, e.g. 'Branch'
 * @param {string} cfg.tag OpenAPI tag
 * @param {string} cfg.basePath OpenAPI path prefix, e.g. '/api/v1/companies'
 * @param {import('zod').ZodType} cfg.createSchema
 * @param {import('zod').ZodType} cfg.updateSchema
 * @param {Function} cfg.readAccess access middleware for GET
 * @param {Function} cfg.writeAccess access middleware for POST/PATCH/DELETE
 * @param {string[]} [cfg.searchFields] fields matched by ?q=
 * @param {object} [cfg.orderBy] defaults to { id: 'asc' } (UUIDv7 ≈ creation order)
 * @param {(data: any, ctx: { id?: string }) => any | Promise<any>} [cfg.mapInput] converts validated input to Prisma data
 * @param {(data: any, ctx: { id: string }) => Promise<void>} [cfg.beforeUpdate] extra checks (e.g. cycles)
 */
export function crudRoutes(router, cfg) {
  const delegate = () => /** @type {any} */ (db())[cfg.model];
  const map = cfg.mapInput ?? ((d) => d);
  const orderBy = cfg.orderBy ?? { id: 'asc' };
  const doc = (method, path, summary, extra = {}) =>
    registry.registerPath({
      method,
      path: `${cfg.basePath}${path}`,
      tags: [cfg.tag],
      summary,
      responses: { 200: { description: 'OK' } },
      ...extra,
    });
  doc('get', cfg.path, `List ${cfg.entityType} records`, { request: { query: ListQuery } });
  doc('get', `${cfg.path}/{id}`, `Get one ${cfg.entityType}`, { request: { params: IdParams } });
  doc('post', cfg.path, `Create a ${cfg.entityType}`, {
    request: { body: { content: { 'application/json': { schema: cfg.createSchema } } } },
  });
  doc('patch', `${cfg.path}/{id}`, `Update a ${cfg.entityType}`, {
    request: { params: IdParams, body: { content: { 'application/json': { schema: cfg.updateSchema } } } },
  });
  doc('delete', `${cfg.path}/{id}`, `Delete a ${cfg.entityType} (409 if it is still in use)`, {
    request: { params: IdParams },
  });

  router.get(cfg.path, cfg.readAccess, validate({ query: ListQuery }), async (req, res) => {
    const { limit, cursor, q } = /** @type {any} */ (req.query);
    const where =
      q && cfg.searchFields?.length ? { OR: cfg.searchFields.map((f) => ({ [f]: { contains: q } })) } : {};
    const rows = await delegate().findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    res.json({
      data: page.map(withoutTenant),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  });

  router.get(`${cfg.path}/:id`, cfg.readAccess, validate({ params: IdParams }), async (req, res) => {
    const row = await delegate().findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError();
    res.json(withoutTenant(row));
  });

  router.post(cfg.path, cfg.writeAccess, validate({ body: cfg.createSchema }), async (req, res) => {
    const id = newId();
    const row = await delegate().create({ data: { id, ...(await map(req.body, {})) } });
    await audit(db(), {
      action: `${cfg.model}.created`,
      entityType: cfg.entityType,
      entityId: id,
      changes: req.body,
    });
    res.status(201).json(withoutTenant(row));
  });

  router.patch(
    `${cfg.path}/:id`,
    cfg.writeAccess,
    validate({ params: IdParams, body: cfg.updateSchema }),
    async (req, res) => {
      const { id } = req.params;
      if (cfg.beforeUpdate) await cfg.beforeUpdate(req.body, { id });
      const row = await delegate().update({ where: { id }, data: await map(req.body, { id }) });
      await audit(db(), {
        action: `${cfg.model}.updated`,
        entityType: cfg.entityType,
        entityId: id,
        changes: req.body,
      });
      res.json(withoutTenant(row));
    },
  );

  router.delete(`${cfg.path}/:id`, cfg.writeAccess, validate({ params: IdParams }), async (req, res) => {
    const { id } = req.params;
    try {
      await delegate().delete({ where: { id } });
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'P2003') {
        throw new AppError(409, 'in_use', 'This record is still in use. Remove what refers to it first.');
      }
      throw err;
    }
    await audit(db(), { action: `${cfg.model}.deleted`, entityType: cfg.entityType, entityId: id });
    res.status(204).end();
  });
}
