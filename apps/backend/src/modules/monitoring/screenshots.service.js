// @ts-check
/**
 * Screenshots (Sprint 10, Phase 1 §4.3–4.5, §5.6).
 *
 * Capture is allowed only when the server agrees, every time: an approved device (company-managed unless the
 * checklist allows personal devices), monitoring ON for the person (monitoringFor), the agent using the current
 * policy version, a running work session that is ACTIVE (not on a break, not disconnected), and not faster than
 * the policy's interval. The image goes straight to private storage through a 60-second upload URL; the worker
 * verifies it (size, WebP signature, hash, decodable), re-encodes it without metadata, applies blur where the
 * policy asks, and makes a thumbnail. Nothing is public: viewing gives a 60-second link and is logged, downloads
 * are watermarked and logged, managers never see a disputed image, and retention deletes images (keeping a
 * metadata tombstone).
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { newId } from '@hrms/shared/ids';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { keys } from '../../lib/storage.js';
import { addDays, localYmd, zonedTime } from '../../lib/time.js';
import { employeeScope } from '../employees/scope.js';

const ctx = () => /** @type {any} */ (currentContext());
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
export const MAX_BYTES = 2_000_000;
const CONFIRM_WINDOW_MS = 5 * 60_000;
const VISIBLE = ['AVAILABLE'];

/** @param {any} r */
const dto = (r) => ({
  id: r.id,
  employeeId: r.employeeId,
  sessionId: r.sessionId,
  status: r.status,
  capturedAt: r.capturedAtServer,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  retentionUntil: r.retentionUntil,
  deletedAt: r.deletedAt,
  deleteReason: r.deleteReason,
});

/**
 * @param {{ governance: any, files: any, bucket: string, queues?: { screenshots?: { add: Function } }, mfaEnforce?: boolean, now?: () => Date }} deps
 */
export function createScreenshotsService({
  governance,
  files,
  bucket,
  queues,
  mfaEnforce = true,
  now = () => new Date(),
}) {
  const holds = (/** @type {string} */ p) =>
    Boolean(ctx().permissions?.has(p)) && (!mfaEnforce || ctx().mfa === true);

  /** Writes an access-log row for a screenshot (append-only table). @param {any} client @param {string} id @param {string} action @param {string | null} [reason] */
  const logAccess = (client, id, action, reason = null) =>
    client.screenshotAccessLog.create({
      data: {
        id: newId(),
        screenshotId: id,
        actorUserId: ctx()?.userId ?? SYSTEM_USER,
        action,
        reason,
        ipAddress: ctx()?.ip?.slice(0, 45) ?? null,
        userAgent: ctx()?.userAgent?.slice(0, 255) ?? null,
      },
    });

  /** Is the caller a permitted viewer of someone else's screenshots: permission (MFA), scope and a viewer role from the checklist? @param {string} employeeId */
  async function canViewOthers(employeeId) {
    if (!holds('view_team_screenshots')) return false;
    const scope = await employeeScope('view_team_screenshots');
    if (!(await db().employee.count({ where: { AND: [{ id: employeeId }, scope] } }))) return false;
    const activation = await db().monitoringActivation.findFirst({
      where: { status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { version: 'desc' },
    });
    const roleIds = /** @type {string[]} */ (activation?.viewerRoleIds ?? []);
    if (!roleIds.length || !ctx().membershipId) return false;
    return (
      (await db().membershipRole.count({
        where: { membershipId: ctx().membershipId, roleId: { in: roleIds } },
      })) > 0
    );
  }

  /** A screenshot the caller may see, with how: as its owner, a reviewer (monitoring policy) or a permitted viewer. @param {string} id */
  async function viewable(id) {
    const r = await db().screenshotRecord.findUnique({ where: { id } });
    if (!r || r.status === 'DELETED') throw new NotFoundError();
    if (r.employeeId === ctx().employeeId) return { r, as: 'OWNER' };
    if (holds('manage_monitoring_policy') && ['UNDER_DISPUTE', 'AVAILABLE'].includes(r.status))
      return { r, as: 'REVIEWER' };
    if (VISIBLE.includes(r.status) && (await canViewOthers(r.employeeId))) return { r, as: 'VIEWER' };
    throw new NotFoundError();
  }

  /**
   * Removes the image and thumbnail, keeping the row as a tombstone (DELETED), or as a rejected upload (INVALID).
   * @param {any} client @param {any} r @param {string} reason @param {'DELETED' | 'INVALID'} [status]
   */
  async function erase(client, r, reason, status = 'DELETED') {
    for (const k of [r.s3Key, r.thumbKey].filter(Boolean)) {
      try {
        await files.remove(bucket, k);
      } catch {
        /* already gone */
      }
    }
    await client.screenshotRecord.update({
      where: { id: r.id },
      data: {
        status,
        deletedAt: status === 'DELETED' ? now() : null,
        deleteReason: reason.slice(0, 60),
        s3Key: null,
        thumbKey: null,
      },
    });
  }

  const service = {
    // ── Agent side (device token) ──

    /** @param {any} b SlotBody */
    async slot(b) {
      const device = ctx().device;
      if (device.status !== 'ACTIVE')
        throw new ConflictError('device_pending', 'An administrator has not approved this computer yet');
      const m = await governance.monitoringFor(ctx().employeeId);
      if (!m.enabled) throw new ConflictError('monitoring_off', `Monitoring does not apply (${m.reason})`);
      if (m.scope?.companyDevicesOnly !== false && device.ownership !== 'COMPANY_MANAGED')
        throw new ConflictError('personal_device', 'Screenshots are taken only on company-managed computers');
      if (m.policy.id !== b.policyId || m.policy.version !== b.policyVersion)
        throw new ConflictError(
          'policy_outdated',
          'The monitoring policy changed. Sync it before capturing.',
        );
      const active = await db().employeeActiveSession.findUnique({
        where: { tenantId_employeeId: { tenantId: ctx().tenantId, employeeId: ctx().employeeId } },
        include: { session: { include: { policy: true } } },
      });
      const s = active?.session;
      const t = now();
      if (!s || s.id !== b.sessionId || s.status !== 'ACTIVE')
        throw new ConflictError(
          'session_not_active',
          'Screenshots are taken only while a work session is running',
        );
      if (t.getTime() - (s.lastHeartbeatAt ?? s.startedAt).getTime() > s.policy.heartbeatTimeoutSec * 1000)
        throw new ConflictError('session_not_active', 'The session is not connected');
      const minGapMs = m.policy.intervalMin * 60_000 * (1 - m.policy.jitterPct / 100) * 0.9;
      const last = await db().screenshotRecord.findFirst({
        where: { deviceId: device.id },
        orderBy: { capturedAtServer: 'desc' },
        select: { capturedAtServer: true },
      });
      if (last && t.getTime() - last.capturedAtServer.getTime() < minGapMs)
        throw new ConflictError('too_soon', 'Too soon since the last screenshot');
      const id = newId();
      const key = keys.screenshot(ctx().tenantId, ctx().employeeId, s.id, id);
      await db().screenshotRecord.create({
        data: {
          id,
          employeeId: ctx().employeeId,
          sessionId: s.id,
          deviceId: device.id,
          policyId: m.policy.id,
          policyVersion: m.policy.version,
          capturedAtServer: t,
          capturedAtClient: new Date(b.capturedAt),
          s3Key: key,
          retentionUntil: new Date(t.getTime() + m.policy.retentionDays * 86_400_000),
        },
      });
      return {
        screenshotId: id,
        upload: {
          method: 'PUT',
          url: await files.uploadUrl(bucket, key, 'image/webp'),
          headers: { 'Content-Type': 'image/webp' },
        },
        maxBytes: MAX_BYTES,
        expiresInSec: 60,
        captureMode: m.policy.captureMode,
        blurZones: m.policy.blurZones,
      };
    },

    /** @param {string} id @param {{ sha256: string, bytes: number }} b */
    async confirm(id, b) {
      const r = await db().screenshotRecord.findUnique({ where: { id } });
      if (!r || r.deviceId !== ctx().deviceId) throw new NotFoundError();
      if (r.status !== 'SLOT_ISSUED')
        throw new ConflictError('already_confirmed', 'This screenshot was already confirmed');
      if (now().getTime() - r.capturedAtServer.getTime() > CONFIRM_WINDOW_MS)
        throw new ConflictError('slot_expired', 'This upload slot expired');
      await db().screenshotRecord.update({
        where: { id },
        data: { status: 'UPLOADED', sha256: b.sha256, bytes: b.bytes },
      });
      if (queues?.screenshots)
        await queues.screenshots.add(
          'screenshot-process',
          { tenantId: ctx().tenantId, screenshotId: id },
          { jobId: `ss-${id}` },
        );
      return { id, status: 'UPLOADED' };
    },

    /** Why a scheduled capture did not happen (reason only, never an image). @param {{ sessionId: string, reason: string, occurredAt: string }} b */
    async skip(b) {
      const s = await db().workSession.findUnique({
        where: { id: b.sessionId },
        select: { employeeId: true },
      });
      if (!s || s.employeeId !== ctx().employeeId) throw new NotFoundError();
      await db().screenshotSkip.create({
        data: {
          id: newId(),
          sessionId: b.sessionId,
          deviceId: ctx().deviceId,
          reason: /** @type {any} */ (b.reason),
          occurredAt: new Date(b.occurredAt),
        },
      });
      return { ok: true };
    },

    /**
     * Worker: verifies an upload and makes it viewable, or marks it INVALID and removes the object.
     * @param {string} id
     */
    async process(id) {
      const r = await db().screenshotRecord.findUnique({ where: { id }, include: { policy: true } });
      if (!r || r.status !== 'UPLOADED' || !r.s3Key) return { id, skipped: true };
      await db().screenshotRecord.update({ where: { id }, data: { status: 'PROCESSING' } });
      const fail = async (/** @type {string} */ why) => {
        await erase(db(), r, `INVALID:${why}`, 'INVALID');
        return { id, status: 'INVALID', why };
      };
      let buf;
      try {
        buf = await files.get(bucket, r.s3Key);
      } catch {
        return fail('missing');
      }
      if (buf.length > MAX_BYTES || buf.length !== r.bytes) return fail('size');
      if (buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP')
        return fail('type');
      if (createHash('sha256').update(buf).digest('hex') !== r.sha256) return fail('hash');
      let meta;
      try {
        meta = await sharp(buf).metadata();
      } catch {
        return fail('decode');
      }
      if (meta.format !== 'webp' || !meta.width || !meta.height || meta.width > 8000 || meta.height > 8000)
        return fail('decode');
      // Re-encode without any metadata; apply the policy's blur as a backstop to the agent's own.
      let img = sharp(buf).rotate();
      if (r.policy.captureMode === 'BLURRED') img = img.blur(12);
      let clean = await img.webp({ quality: 80 }).toBuffer();
      const zones = /** @type {any[]} */ (r.policy.blurZones ?? []);
      if (zones.length && r.policy.captureMode !== 'BLURRED') {
        const overlays = [];
        for (const z of zones) {
          const left = Math.round(z.x * meta.width);
          const top = Math.round(z.y * meta.height);
          const width = Math.max(1, Math.min(meta.width - left, Math.round(z.w * meta.width)));
          const height = Math.max(1, Math.min(meta.height - top, Math.round(z.h * meta.height)));
          if (width < 2 || height < 2) continue;
          const patch = await sharp(clean).extract({ left, top, width, height }).blur(20).toBuffer();
          overlays.push({ input: patch, left, top });
        }
        if (overlays.length) clean = await sharp(clean).composite(overlays).webp({ quality: 80 }).toBuffer();
      }
      const thumb = await sharp(clean)
        .resize({ width: 320, withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      const thumbKey = keys.screenshotThumb(r.tenantId, r.employeeId, r.sessionId, r.id);
      await files.put(bucket, r.s3Key, clean, 'image/webp');
      await files.put(bucket, thumbKey, thumb, 'image/webp');
      await db().screenshotRecord.update({
        where: { id },
        data: { status: 'AVAILABLE', thumbKey, width: meta.width, height: meta.height, bytes: clean.length },
      });
      return { id, status: 'AVAILABLE' };
    },

    // ── People ──

    /** Your screenshots, or someone's in your viewing scope (metadata only; images through view-url). @param {{ employeeId?: string, date?: string, sessionId?: string }} q */
    async list(q) {
      const employeeId = q.employeeId ?? ctx().employeeId;
      if (!employeeId) return [];
      const own = employeeId === ctx().employeeId;
      const reviewer = holds('manage_monitoring_policy');
      if (!own && !reviewer && !(await canViewOthers(employeeId))) throw new ForbiddenError();
      const emp = await db().employee.findUnique({ where: { id: employeeId }, select: { timezone: true } });
      if (!emp) throw new NotFoundError();
      const day = q.date ?? localYmd(now(), emp.timezone);
      const rows = await db().screenshotRecord.findMany({
        where: {
          employeeId,
          ...(q.sessionId
            ? { sessionId: q.sessionId }
            : {
                capturedAtServer: {
                  gte: zonedTime(day, 0, emp.timezone),
                  lt: zonedTime(/** @type {string} */ (addDays(day, 1)), 0, emp.timezone),
                },
              }),
          status:
            own || reviewer
              ? { in: ['AVAILABLE', 'UNDER_DISPUTE', 'PROCESSING', 'UPLOADED'] }
              : { in: VISIBLE },
        },
        orderBy: { capturedAtServer: 'asc' },
        take: 500,
      });
      const skips = own
        ? await db().screenshotSkip.groupBy({
            by: ['reason'],
            where: {
              deviceId: { in: [...new Set(rows.map((x) => x.deviceId))] },
              occurredAt: {
                gte: zonedTime(day, 0, emp.timezone),
                lt: zonedTime(/** @type {string} */ (addDays(day, 1)), 0, emp.timezone),
              },
            },
            _count: { _all: true },
          })
        : [];
      return {
        date: day,
        data: rows.map(dto),
        skipped: skips.map((s) => ({ reason: s.reason, count: s._count._all })),
      };
    },

    /** A 60-second link to view one screenshot (or its thumbnail). Every call is logged. @param {string} id @param {{ thumb?: boolean }} o */
    async viewUrl(id, { thumb = false } = {}) {
      const { r } = await viewable(id);
      const key = thumb ? r.thumbKey : r.s3Key;
      if (!key) throw new ConflictError('not_ready', 'This screenshot is still being processed');
      await logAccess(db(), id, 'VIEW', thumb ? 'thumbnail' : null);
      return { url: await files.viewUrl(bucket, key, 'image/webp'), expiresInSec: 60 };
    },

    /** A watermarked copy (download_screenshots); logged. @param {string} id */
    async download(id) {
      if (!holds('download_screenshots')) throw new ForbiddenError();
      const { r } = await viewable(id);
      if (!r.s3Key || r.status !== 'AVAILABLE')
        throw new ConflictError('not_ready', 'This screenshot cannot be downloaded');
      const buf = await files.get(bucket, r.s3Key);
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 1280;
      const text = `Confidential - ${ctx().userId} - ${now().toISOString()} - ${r.id.slice(0, 8)}`;
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="40"><rect width="100%" height="100%" fill="black" fill-opacity="0.55"/><text x="12" y="27" font-family="sans-serif" font-size="18" fill="white">${text.replace(/[<>&]/g, '')}</text></svg>`,
      );
      const out = await sharp(buf)
        .composite([{ input: svg, gravity: 'south' }])
        .webp({ quality: 85 })
        .toBuffer();
      await logAccess(db(), id, 'DOWNLOAD');
      await audit(db(), { action: 'screenshot.downloaded', entityType: 'ScreenshotRecord', entityId: id });
      return { body: out, fileName: `screenshot-${r.id.slice(0, 8)}.webp` };
    },

    /** Deleted by its owner (when the policy allows) or a monitoring administrator; logged with the reason. @param {string} id @param {string} reason */
    async remove(id, reason) {
      const r = await db().screenshotRecord.findUnique({ where: { id }, include: { policy: true } });
      if (!r || r.status === 'DELETED') throw new NotFoundError();
      const own = r.employeeId === ctx().employeeId;
      if (!(holds('manage_monitoring_policy') || (own && r.policy.employeeCanDelete))) {
        if (own)
          throw new ForbiddenError(
            'delete_not_allowed',
            'Your company’s policy does not let you delete screenshots. You can dispute one instead.',
          );
        throw new NotFoundError();
      }
      await logAccess(db(), id, 'DELETE', reason);
      await erase(db(), r, own ? `OWNER:${reason}` : reason);
      await audit(db(), {
        action: 'screenshot.deleted',
        entityType: 'ScreenshotRecord',
        entityId: id,
        changes: { reason, byOwner: own },
      });
      return { id, status: 'DELETED' };
    },

    /** Who looked at a screenshot: its owner, or audit.log.view. @param {{ screenshotId?: string, actorUserId?: string }} q */
    async accessLog(q) {
      if (q.screenshotId) {
        const r = await db().screenshotRecord.findUnique({
          where: { id: q.screenshotId },
          select: { employeeId: true },
        });
        if (!r) throw new NotFoundError();
        if (r.employeeId !== ctx().employeeId && !ctx().permissions?.has('audit.log.view'))
          throw new NotFoundError();
      } else if (!ctx().permissions?.has('audit.log.view')) throw new ForbiddenError();
      const rows = await db().screenshotAccessLog.findMany({
        where: {
          ...(q.screenshotId ? { screenshotId: q.screenshotId } : {}),
          ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        },
        orderBy: { at: 'desc' },
        take: 500,
      });
      return rows.map((l) => ({
        id: l.id,
        screenshotId: l.screenshotId,
        actorUserId: l.actorUserId,
        action: l.action,
        reason: l.reason,
        at: l.at,
      }));
    },

    // ── Disputes and incidents ──

    /** The owner flags a screenshot; it is hidden from managers at once. @param {string} id @param {{ reason: string }} b */
    async dispute(id, b) {
      const r = await db().screenshotRecord.findUnique({ where: { id } });
      if (!r || r.employeeId !== ctx().employeeId || r.status === 'DELETED') throw new NotFoundError();
      if (r.status === 'UNDER_DISPUTE')
        throw new ConflictError('already_disputed', 'This screenshot is already under review');
      const d = await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.screenshotRecord.update({ where: { id }, data: { status: 'UNDER_DISPUTE' } });
        await logAccess(tx, id, 'DISPUTE', b.reason.slice(0, 255));
        return tx.screenshotDispute.create({
          data: { id: newId(), screenshotId: id, employeeId: r.employeeId, reason: b.reason },
        });
      });
      await audit(db(), { action: 'screenshot.disputed', entityType: 'ScreenshotDispute', entityId: d.id });
      return { id: d.id, status: d.status };
    },

    /** Open disputes (manage_monitoring_policy) or your own. */
    async listDisputes() {
      const reviewer = holds('manage_monitoring_policy');
      const rows = await db().screenshotDispute.findMany({
        where: reviewer ? {} : { employeeId: ctx().employeeId ?? '-' },
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          screenshot: { select: { capturedAtServer: true, status: true } },
        },
        take: 300,
      });
      return rows.map((d) => ({
        id: d.id,
        screenshotId: d.screenshotId,
        employee: {
          code: d.employee.employeeCode,
          name: [d.employee.firstName, d.employee.lastName].filter(Boolean).join(' '),
        },
        capturedAt: d.screenshot.capturedAtServer,
        reason: d.reason,
        status: d.status,
        resolution: d.resolution,
        resolvedAt: d.resolvedAt,
      }));
    },

    /** @param {string} id @param {{ outcome: 'RESTORED' | 'DELETED' | 'TIME_CORRECTED', resolution: string }} b */
    async resolveDispute(id, b) {
      if (!holds('manage_monitoring_policy')) throw new ForbiddenError();
      const d = await db().screenshotDispute.findUnique({ where: { id }, include: { screenshot: true } });
      if (!d) throw new NotFoundError();
      if (d.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'Someone else must review your dispute');
      if (!['OPEN', 'UNDER_REVIEW'].includes(d.status))
        throw new ConflictError('already_decided', 'This dispute was already resolved');
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.screenshotDispute.update({
          where: { id },
          data: {
            status: b.outcome,
            resolution: b.resolution,
            resolvedAt: now(),
            reviewerEmployeeId: ctx().employeeId ?? null,
          },
        });
        if (b.outcome === 'DELETED') {
          await logAccess(tx, d.screenshotId, 'DELETE', 'dispute');
          await erase(tx, d.screenshot, 'DISPUTE');
        } else {
          await tx.screenshotRecord.update({ where: { id: d.screenshotId }, data: { status: 'AVAILABLE' } });
          await logAccess(tx, d.screenshotId, 'RESTORE', b.outcome);
        }
      });
      await audit(db(), {
        action: 'screenshot.dispute_resolved',
        entityType: 'ScreenshotDispute',
        entityId: id,
        changes: { outcome: b.outcome },
      });
      return { id, status: b.outcome };
    },

    /** Anyone can report a privacy incident; a screenshot named in it is hidden at once. @param {{ screenshotId?: string, description: string }} b */
    async reportIncident(b) {
      const me = ctx().employeeId;
      if (!me)
        throw new ConflictError('no_employee_record', 'Your sign-in is not linked to an employee record');
      if (b.screenshotId) {
        const r = await db().screenshotRecord.findUnique({ where: { id: b.screenshotId } });
        if (!r || r.employeeId !== me)
          throw new ValidationError([
            { path: 'body.screenshotId', message: 'Choose one of your own screenshots' },
          ]);
        if (r.status === 'AVAILABLE')
          await db().screenshotRecord.update({ where: { id: r.id }, data: { status: 'UNDER_DISPUTE' } });
      }
      const i = await db().privacyIncident.create({
        data: {
          id: newId(),
          reporterEmployeeId: me,
          screenshotId: b.screenshotId ?? null,
          description: b.description,
        },
      });
      await audit(db(), {
        action: 'privacy.incident_reported',
        entityType: 'PrivacyIncident',
        entityId: i.id,
      });
      return { id: i.id, status: i.status };
    },

    async listIncidents() {
      const reviewer = holds('manage_monitoring_policy');
      const rows = await db().privacyIncident.findMany({
        where: reviewer ? {} : { reporterEmployeeId: ctx().employeeId ?? '-' },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      return rows.map((i) => ({
        id: i.id,
        screenshotId: i.screenshotId,
        description: i.description,
        status: i.status,
        resolution: i.resolution,
        createdAt: i.createdAt,
        resolvedAt: i.resolvedAt,
      }));
    },

    /** Deletion is the default outcome for a reported screenshot. @param {string} id @param {{ resolution: string, deleteScreenshot: boolean }} b */
    async resolveIncident(id, b) {
      if (!holds('manage_monitoring_policy')) throw new ForbiddenError();
      const i = await db().privacyIncident.findUnique({ where: { id }, include: { screenshot: true } });
      if (!i) throw new NotFoundError();
      if (i.status === 'RESOLVED')
        throw new ConflictError('already_decided', 'This incident was already resolved');
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.privacyIncident.update({
          where: { id },
          data: { status: 'RESOLVED', resolution: b.resolution, resolvedAt: now(), handledBy: ctx().userId },
        });
        if (i.screenshot && i.screenshot.status !== 'DELETED') {
          if (b.deleteScreenshot) {
            await logAccess(tx, i.screenshot.id, 'DELETE', 'privacy incident');
            await erase(tx, i.screenshot, 'PRIVACY_INCIDENT');
          } else {
            await tx.screenshotRecord.update({
              where: { id: i.screenshot.id },
              data: { status: 'AVAILABLE' },
            });
            await logAccess(tx, i.screenshot.id, 'RESTORE', 'privacy incident');
          }
        }
      });
      await audit(db(), {
        action: 'privacy.incident_resolved',
        entityType: 'PrivacyIncident',
        entityId: id,
        changes: { deleted: b.deleteScreenshot },
      });
      return { id, status: 'RESOLVED' };
    },

    /**
     * Worker (nightly, per company): deletes images past retention (not those under dispute, which wait for the
     * outcome) and fails upload slots that were never completed.
     */
    async retentionSweep() {
      const t = now();
      const expired = await db().screenshotRecord.findMany({
        where: {
          retentionUntil: { lt: t },
          status: { in: ['AVAILABLE', 'INVALID', 'UPLOADED', 'PROCESSING', 'SLOT_ISSUED'] },
        },
        take: 2000,
      });
      for (const r of expired) {
        await logAccess(db(), r.id, 'DELETE', 'retention');
        await erase(db(), r, 'RETENTION');
      }
      const stale = await db().screenshotRecord.updateMany({
        where: {
          status: 'SLOT_ISSUED',
          capturedAtServer: { lt: new Date(t.getTime() - CONFIRM_WINDOW_MS * 2) },
        },
        data: { status: 'INVALID' },
      });
      return { deleted: expired.length, expiredSlots: stale.count };
    },
  };
  return service;
}
