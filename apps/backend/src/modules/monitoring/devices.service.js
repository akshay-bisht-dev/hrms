// @ts-check
/**
 * Desktop devices (Sprint 10, Phase 1 §5.2).
 *
 * Pairing: a signed-in employee asks the web app for a one-time code (8 characters, 10 minutes, stored hashed);
 * the agent sends it with device facts and receives a 10-minute access token (aud=desktop-agent) and a refresh
 * token (stored hashed, 30 days). Refresh tokens rotate on every use; presenting an already-rotated token is
 * treated as theft and revokes the whole token family. Revoking a device ends its tokens: the next call gets 401
 * and the agent stops and wipes its credentials. The agent never receives commands, only declarative policy.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { newId } from '@hrms/shared/ids';
import { audit } from '../../lib/audit.js';
import { currentContext, runWithContext } from '../../lib/context.js';
import { db, platformDb } from '../../lib/db.js';
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import { markAccess } from '../../lib/route-registry.js';

export const DEVICE_AUDIENCE = 'desktop-agent';
const ACCESS_TTL_SEC = 600;
const REFRESH_TTL_DAYS = 30;
const CODE_TTL_MIN = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const LIVE_TENANTS = ['TRIAL', 'ACTIVE', 'PAST_DUE'];

const ctx = () => /** @type {any} */ (currentContext());
const sha256 = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex');
const normalizeCode = (/** @type {string} */ c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** @param {any} d */
export const deviceDto = (d) => ({
  id: d.id,
  employeeId: d.employeeId,
  employee: d.employee
    ? {
        id: d.employee.id,
        code: d.employee.employeeCode,
        name: [d.employee.firstName, d.employee.lastName].filter(Boolean).join(' '),
      }
    : undefined,
  ownership: d.ownership,
  os: d.os,
  osVersion: d.osVersion,
  agentVersion: d.agentVersion,
  status: d.status,
  lastSeenAt: d.lastSeenAt,
  revokedAt: d.revokedAt,
  revokedReason: d.revokedReason,
  createdAt: d.createdAt,
});

/**
 * @param {{ jwt: { sign: Function, verify: Function }, governance: any, now?: () => Date }} deps
 */
export function createDevicesService({ jwt, governance, now = () => new Date() }) {
  /** Issues an access token and a fresh refresh token in `familyId`. @param {any} client @param {any} device @param {string} familyId */
  async function issueTokens(client, device, familyId) {
    const refreshToken = randomBytes(32).toString('base64url');
    await client.deviceSession.create({
      data: {
        id: newId(),
        tenantId: device.tenantId,
        deviceId: device.id,
        refreshHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(now().getTime() + REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    const accessToken = await jwt.sign(
      { tid: device.tenantId, eid: device.employeeId },
      { subject: device.id, audience: DEVICE_AUDIENCE, ttlSec: ACCESS_TTL_SEC },
    );
    return { accessToken, refreshToken, expiresInSec: ACCESS_TTL_SEC };
  }

  const service = {
    /** A one-time code for the signed-in employee; any earlier unused code stops working. */
    async createPairingCode() {
      const employeeId = ctx().employeeId;
      if (!employeeId)
        throw new AppError(409, 'no_employee_record', 'Your sign-in is not linked to an employee record');
      const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const t = now();
      await db().devicePairingCode.updateMany({ where: { employeeId, usedAt: null }, data: { usedAt: t } });
      await db().devicePairingCode.create({
        data: {
          id: newId(),
          employeeId,
          codeHash: sha256(raw),
          expiresAt: new Date(t.getTime() + CODE_TTL_MIN * 60_000),
        },
      });
      await audit(db(), {
        action: 'device.pairing_code_created',
        entityType: 'Employee',
        entityId: employeeId,
      });
      return {
        code: `${raw.slice(0, 4)}-${raw.slice(4)}`,
        expiresAt: new Date(t.getTime() + CODE_TTL_MIN * 60_000),
      };
    },

    /**
     * Agent registration with a pairing code (public route, IP rate-limited). Runs in the code's tenant.
     * @param {any} b RegisterDeviceBody @param {{ ip?: string | null }} meta
     */
    async register(b, { ip = null } = {}) {
      const code = await platformDb().devicePairingCode.findFirst({
        where: { codeHash: sha256(normalizeCode(b.code)) },
      });
      const t = now();
      if (!code || code.usedAt || code.expiresAt < t)
        throw new AppError(
          400,
          'invalid_code',
          'This code is not valid or has expired. Create a new one in the web app.',
        );
      const tenant = await platformDb().tenant.findUnique({
        where: { id: code.tenantId },
        select: { status: true },
      });
      if (!tenant || !LIVE_TENANTS.includes(tenant.status))
        throw new AppError(400, 'invalid_code', 'This code is not valid');
      return runWithContext(
        { requestId: ctx()?.requestId ?? 'device-register', tenantId: code.tenantId },
        async () => {
          const emp = await db().employee.findUnique({
            where: { id: code.employeeId },
            select: { id: true, status: true },
          });
          if (!emp || emp.status === 'EXITED')
            throw new AppError(400, 'invalid_code', 'This code is not valid');
          const used = await db().devicePairingCode.updateMany({
            where: { id: code.id, usedAt: null },
            data: { usedAt: t },
          });
          if (!used.count) throw new AppError(400, 'invalid_code', 'This code was already used');
          const activation = await db().monitoringActivation.findFirst({ where: { status: 'ACTIVE' } });
          const needsApproval =
            Boolean(/** @type {any} */ (activation?.scope)?.requireDeviceApproval ?? true) &&
            Boolean(activation);
          const status = needsApproval ? 'PENDING' : 'ACTIVE';
          const facts = {
            os: b.os,
            osVersion: b.osVersion,
            agentVersion: b.agentVersion,
            hostnameHash: b.hostnameHash ?? null,
            ownership: b.ownership,
            lastSeenAt: t,
            lastIp: ip ? ip.slice(0, 45) : null,
          };
          const existing = await db().monitoredDevice.findUnique({
            where: {
              tenantId_fingerprintHash: { tenantId: code.tenantId, fingerprintHash: b.fingerprintHash },
            },
          });
          if (existing && existing.employeeId !== emp.id)
            throw new ConflictError(
              'device_in_use',
              'This computer is connected to another person. Ask an administrator to remove it first.',
            );
          const out = await db().$transaction(async (/** @type {any} */ tx) => {
            let device;
            if (existing) {
              // Re-pairing the same computer: old tokens stop working; a revoked device needs approval again.
              await tx.deviceSession.updateMany({
                where: { deviceId: existing.id, revokedAt: null },
                data: { revokedAt: t },
              });
              device = await tx.monitoredDevice.update({
                where: { id: existing.id },
                data: {
                  ...facts,
                  status: existing.status === 'REVOKED' ? status : existing.status,
                  revokedAt: null,
                  revokedReason: null,
                },
              });
            } else {
              device = await tx.monitoredDevice.create({
                data: {
                  id: newId(),
                  employeeId: emp.id,
                  fingerprintHash: b.fingerprintHash,
                  status,
                  ...facts,
                },
              });
            }
            const tokens = await issueTokens(tx, device, newId());
            await audit(tx, {
              actorType: 'DEVICE',
              action: existing ? 'device.repaired' : 'device.registered',
              entityType: 'MonitoredDevice',
              entityId: device.id,
              changes: { os: b.os, ownership: b.ownership, status: device.status },
              ip: ip ?? undefined,
            });
            return { device, tokens };
          });
          return { deviceId: out.device.id, status: out.device.status, ...out.tokens };
        },
      );
    },

    /** Rotates a refresh token; reuse of a rotated token revokes the family (Phase 1 §5.2 step 4). @param {string} refreshToken */
    async refresh(refreshToken) {
      const row = await platformDb().deviceSession.findUnique({
        where: { refreshHash: sha256(refreshToken) },
        include: { device: true },
      });
      const t = now();
      if (!row) throw new UnauthorizedError('invalid_token', 'Sign in to the desktop app again');
      if (row.revokedAt || row.device.status === 'REVOKED')
        throw new UnauthorizedError(
          'device_revoked',
          'This computer was disconnected. Pair it again from the web app.',
        );
      if (row.rotatedAt) {
        await platformDb().deviceSession.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: t },
        });
        await audit(platformDb(), {
          tenantId: row.tenantId,
          actorType: 'SYSTEM',
          action: 'device.token_reuse_detected',
          entityType: 'MonitoredDevice',
          entityId: row.deviceId,
        });
        throw new UnauthorizedError(
          'token_reused',
          'This sign-in was used twice, so it was ended for safety. Pair the computer again.',
        );
      }
      if (row.expiresAt < t) throw new UnauthorizedError('invalid_token', 'Sign in to the desktop app again');
      const n = await platformDb().deviceSession.updateMany({
        where: { id: row.id, rotatedAt: null },
        data: { rotatedAt: t },
      });
      if (!n.count)
        throw new UnauthorizedError('token_reused', 'This sign-in was used twice. Pair the computer again.');
      return { status: row.device.status, ...(await issueTokens(platformDb(), row.device, row.familyId)) };
    },

    /** Devices of the signed-in employee. */
    async mine() {
      const id = ctx().employeeId;
      if (!id) return [];
      const rows = await db().monitoredDevice.findMany({
        where: { employeeId: id },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(deviceDto);
    },

    /** All devices (manage_monitoring_policy). */
    async list() {
      const rows = await db().monitoredDevice.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
        take: 1000,
      });
      return rows.map(deviceDto);
    },

    /** @param {string} id */
    async approve(id) {
      const n = await db().monitoredDevice.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'ACTIVE', approvedBy: ctx().userId },
      });
      if (!n.count) {
        if (!(await db().monitoredDevice.findUnique({ where: { id } }))) throw new NotFoundError();
        throw new ConflictError('not_pending', 'Only a device waiting for approval can be approved');
      }
      await audit(db(), { action: 'device.approved', entityType: 'MonitoredDevice', entityId: id });
      return deviceDto(await db().monitoredDevice.findUnique({ where: { id } }));
    },

    /**
     * Revokes a device: by an administrator, or by its owner (people may always disconnect their own computer).
     * @param {string} id @param {string} reason @param {{ asAdmin: boolean }} o
     */
    async revoke(id, reason, { asAdmin }) {
      const d = await db().monitoredDevice.findUnique({ where: { id } });
      if (!d || (!asAdmin && d.employeeId !== ctx().employeeId)) throw new NotFoundError();
      if (d.status === 'REVOKED')
        throw new ConflictError('already_revoked', 'This device is already disconnected');
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.monitoredDevice.update({
          where: { id },
          data: { status: 'REVOKED', revokedAt: t, revokedReason: reason },
        });
        await tx.deviceSession.updateMany({
          where: { deviceId: id, revokedAt: null },
          data: { revokedAt: t },
        });
        await audit(tx, {
          action: 'device.revoked',
          entityType: 'MonitoredDevice',
          entityId: id,
          changes: { reason, byOwner: !asAdmin },
        });
      });
      return deviceDto(await db().monitoredDevice.findUnique({ where: { id } }));
    },
  };
  void governance;
  return service;
}

/**
 * Route access for the desktop agent: a valid device access token for a device that is not revoked, in a live
 * company, for a person who has not left. Sets the request context to that tenant, employee and device.
 * @param {{ jwt: { verify: Function }, now?: () => Date }} deps
 */
export function deviceAccess({ jwt, now = () => new Date() }) {
  return () =>
    markAccess(
      /** @type {import('express').RequestHandler} */ (
        async (req, _res, next) => {
          try {
            const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.get('authorization') ?? '');
            if (!m) throw new UnauthorizedError();
            let claims;
            try {
              claims = await jwt.verify(m[1], DEVICE_AUDIENCE);
            } catch {
              throw new UnauthorizedError('invalid_token', 'Device sign-in expired');
            }
            const { sub, tid } = /** @type {any} */ (claims);
            const [device, tenant] = await Promise.all([
              platformDb().monitoredDevice.findFirst({
                where: { id: sub, tenantId: tid },
                include: { employee: { select: { status: true } } },
              }),
              platformDb().tenant.findUnique({ where: { id: tid }, select: { status: true } }),
            ]);
            if (!device || device.status === 'REVOKED')
              throw new UnauthorizedError(
                'device_revoked',
                'This computer was disconnected. Pair it again from the web app.',
              );
            if (!tenant || !LIVE_TENANTS.includes(tenant.status) || device.employee.status === 'EXITED')
              throw new UnauthorizedError('device_revoked', 'This computer can no longer be used here');
            Object.assign(ctx(), {
              tenantId: tid,
              employeeId: device.employeeId,
              deviceId: device.id,
              device,
              permissions: new Map(),
              mfa: false,
            });
            const t = now();
            if (!device.lastSeenAt || t.getTime() - device.lastSeenAt.getTime() > 60_000)
              await platformDb().monitoredDevice.update({
                where: { id: device.id },
                data: { lastSeenAt: t, lastIp: (req.ip ?? '').slice(0, 45) || null },
              });
            next();
          } catch (e) {
            next(e);
          }
        }
      ),
      'device',
    );
}
