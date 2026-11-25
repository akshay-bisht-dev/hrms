// @ts-check
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from '@hrms/shared/schemas/employee';
import { audit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';

/**
 * Worker step after an upload (Phase 3, FILE-02): the real file type is read from its bytes and must match the
 * declared type; oversized or mismatched files are deleted. Malware scanning (ClamAV, FILE-03) plugs in here.
 * Runs inside the job's tenant context. Safe to run twice.
 * @param {{ files: ReturnType<typeof import('../../lib/storage.js').storage>, bucket: string }} deps @param {string} documentId
 */
export async function verifyDocument({ files, bucket }, documentId) {
  const d = await db().employeeDocument.findUnique({ where: { id: documentId } });
  if (!d || d.deletedAt || d.scanStatus !== 'PENDING') return d?.scanStatus ?? 'MISSING';
  const fail = async (reason) => {
    await files.remove(bucket, d.s3Key).catch(() => {});
    await db().employeeDocument.update({ where: { id: d.id }, data: { scanStatus: 'FAILED' } });
    await audit(db(), {
      actorType: 'SYSTEM',
      action: 'employee.document_rejected',
      entityType: 'Employee',
      entityId: d.employeeId,
      changes: { documentId, reason },
    });
    return 'FAILED';
  };
  const body = await files.get(bucket, d.s3Key);
  if (body.length > DOCUMENT_MAX_BYTES) return fail('too_large');
  const detected = await fileTypeFromBuffer(body);
  const expected = /** @type {Record<string, string>} */ (DOCUMENT_TYPES)[d.mimeType];
  if (!detected || detected.ext !== expected) return fail(`type_mismatch:${detected?.ext ?? 'unknown'}`);
  await db().employeeDocument.update({
    where: { id: d.id },
    data: {
      scanStatus: 'CLEAN',
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    },
  });
  return 'CLEAN';
}
