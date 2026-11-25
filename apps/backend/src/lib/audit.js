// @ts-check
import { newId } from '@hrms/shared/ids';
import { currentContext } from './context.js';

/**
 * Appends an audit event (Phase 3, LOG-02/LOG-04). The table is append-only (DB trigger).
 * Sensitive values are never written; pass identifiers and field names only.
 * @param {{ auditLog: { create: Function } }} client Prisma client or transaction
 * @param {{ tenantId?: string | null, actorType?: 'USER'|'DEVICE'|'SYSTEM'|'PLATFORM_ADMIN', actorUserId?: string | null,
 *           action: string, entityType: string, entityId?: string | null, changes?: object, ip?: string, userAgent?: string }} e
 */
export function audit(client, e) {
  const ctx = currentContext();
  return client.auditLog.create({
    data: {
      id: newId(),
      tenantId: e.tenantId ?? ctx?.tenantId ?? null,
      actorType: e.actorType ?? (e.actorUserId || ctx?.userId ? 'USER' : 'SYSTEM'),
      actorUserId: e.actorUserId ?? ctx?.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      changes: e.changes ?? undefined,
      ipAddress: e.ip?.slice(0, 45) ?? null,
      userAgent: e.userAgent?.slice(0, 255) ?? null,
      requestId: ctx?.requestId?.slice(0, 64) ?? null,
    },
  });
}
