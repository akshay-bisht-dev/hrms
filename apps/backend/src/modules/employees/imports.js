// @ts-check
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { newId } from '@hrms/shared/ids';
import { IMPORT_COLUMNS, ImportRow } from '@hrms/shared/schemas/employee';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { keys } from '../../lib/storage.js';
import { safeCsvCell } from './employees.service.js';

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
/** @returns {any} */
const ctx = () => currentContext();

/** Template with a header row and one example. */
export const importTemplate = () =>
  stringify([
    IMPORT_COLUMNS,
    [
      'E00100',
      'Priya',
      'Sharma',
      'priya@example.com',
      '+91 98765 43210',
      '2026-01-05',
      '',
      'ENG',
      'Software Engineer',
      'BLR',
      '',
      'HYBRID',
      'FULL_TIME',
      'ACTIVE',
      '',
    ],
  ]);

/**
 * Bulk employee import (Phase 1, EMP-05): upload CSV → start → the worker processes rows → results CSV.
 * Re-running the same file is refused (same SHA-256); rows whose employee code already exists are skipped, so a
 * retried job never creates duplicates.
 * @param {{ employees: ReturnType<typeof import('./employees.service.js').createEmployeesService>,
 *           files: ReturnType<typeof import('../../lib/storage.js').storage>, buckets: { reports: string },
 *           queues?: { imports?: import('bullmq').Queue } }} deps
 */
export function createImportsService({ employees, files, buckets, queues }) {
  /** @param {any} j */
  const jobDto = (j) => ({
    id: j.id,
    status: j.status,
    totalRows: j.totalRows,
    okRows: j.okRows,
    errorRows: j.errorRows,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    hasResult: Boolean(j.resultKey),
  });

  return {
    async startUpload() {
      const uploadId = newId();
      const url = await files.uploadUrl(
        buckets.reports,
        keys.importFile(ctx().tenantId, uploadId),
        'text/csv',
      );
      return {
        uploadId,
        uploadUrl: url,
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        maxBytes: IMPORT_MAX_BYTES,
        expiresInSec: 60,
      };
    },

    /** @param {string} uploadId */
    async start(uploadId) {
      const key = keys.importFile(ctx().tenantId, uploadId);
      let head;
      try {
        head = await files.head(buckets.reports, key);
      } catch {
        throw new ConflictError('upload_missing', 'Upload the file first');
      }
      if ((head.ContentLength ?? 0) > IMPORT_MAX_BYTES) {
        await files.remove(buckets.reports, key);
        throw new ValidationError([{ path: 'file', message: 'The file is larger than 2 MB' }]);
      }
      const body = await files.get(buckets.reports, key);
      const sha = createHash('sha256').update(body).digest('hex');
      const existing = await db().bulkImportJob.findFirst({ where: { type: 'EMPLOYEES', fileSha256: sha } });
      if (existing)
        throw new ConflictError('duplicate_import', `This file was already imported (job ${existing.id})`);
      const job = await db().bulkImportJob.create({
        data: { id: uploadId, type: 'EMPLOYEES', fileKey: key, fileSha256: sha, createdBy: ctx().userId },
      });
      await queues?.imports?.add(
        'employees',
        { tenantId: ctx().tenantId, userId: ctx().userId, jobId: job.id },
        { jobId: `import-${job.id}` },
      );
      await audit(db(), { action: 'employee.import_started', entityType: 'BulkImportJob', entityId: job.id });
      return jobDto(job);
    },

    /** @param {string} id */
    async get(id) {
      const j = await db().bulkImportJob.findUnique({ where: { id } });
      if (!j) throw new NotFoundError();
      return jobDto(j);
    },

    async list() {
      const rows = await db().bulkImportJob.findMany({
        where: { type: 'EMPLOYEES' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return rows.map(jobDto);
    },

    /** @param {string} id */
    async resultUrl(id) {
      const j = await db().bulkImportJob.findUnique({ where: { id } });
      if (!j?.resultKey) throw new NotFoundError();
      return {
        url: await files.downloadUrl(buckets.reports, j.resultKey, `import-${id.slice(0, 8)}-result.csv`),
        expiresInSec: 60,
      };
    },

    /**
     * Processes a job (runs in the worker inside the job's tenant context). Safe to run twice.
     * @param {string} jobId
     */
    async process(jobId) {
      const job = await db().bulkImportJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundError();
      if (job.status === 'SUCCEEDED' || job.status === 'PARTIAL') return jobDto(job);
      await db().bulkImportJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

      const results = [['row', 'employeeCode', 'result', 'message']];
      let ok = 0;
      let failed = 0;
      /** @type {Record<string, string>[]} */
      let records = [];
      try {
        records = parse(await files.get(buckets.reports, job.fileKey), {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: false,
        });
      } catch (err) {
        await db().bulkImportJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', totalRows: 0, okRows: 0, errorRows: 0, finishedAt: new Date() },
        });
        await files.put(
          buckets.reports,
          keys.importResult(job.tenantId, jobId),
          stringify([
            ['row', 'result', 'message'],
            [
              '-',
              'error',
              `Could not read the CSV: ${String(/** @type {any} */ (err).message).slice(0, 200)}`,
            ],
          ]),
          'text/csv',
        );
        await db().bulkImportJob.update({
          where: { id: jobId },
          data: { resultKey: keys.importResult(job.tenantId, jobId) },
        });
        return;
      }
      if (records.length > IMPORT_MAX_ROWS) records = records.slice(0, IMPORT_MAX_ROWS);

      // Reference data, resolved by human-friendly codes.
      const [entities, depts, desigs, branches] = await Promise.all([
        db().legalEntity.findMany({ where: { deletedAt: null } }),
        db().department.findMany({}),
        db().designation.findMany({}),
        db().branch.findMany({}),
      ]);
      const byCode = (/** @type {any[]} */ list, /** @type {string} */ field) =>
        new Map(list.map((x) => [String(x[field]).toUpperCase(), x.id]));
      const deptMap = byCode(depts, 'code');
      const desigMap = byCode(desigs, 'title');
      const branchMap = byCode(branches, 'code');
      const entityMap = byCode(entities, 'name');
      const defaultEntity = entities[0]?.id;

      // Managers may appear later in the same file, so rows are processed in passes until no more progress.
      let pending = records.map((r, i) => ({ row: i + 2, raw: r }));
      for (let pass = 0; pending.length && pass < 10; pass++) {
        const deferred = [];
        for (const item of pending) {
          const parsed = ImportRow.safeParse(
            Object.fromEntries(Object.entries(item.raw).filter(([k]) => IMPORT_COLUMNS.includes(k))),
          );
          const unknown = Object.keys(item.raw).filter((k) => !IMPORT_COLUMNS.includes(k));
          if (unknown.length) {
            results.push([
              item.row,
              item.raw.employeeCode ?? '',
              'error',
              `Unknown column(s): ${unknown.join(', ')}`,
            ]);
            failed++;
            continue;
          }
          if (!parsed.success) {
            results.push([
              item.row,
              item.raw.employeeCode ?? '',
              'error',
              parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            ]);
            failed++;
            continue;
          }
          const r = parsed.data;
          const exists = await db().employee.findFirst({
            where: { employeeCode: r.employeeCode },
            select: { id: true },
          });
          if (exists) {
            results.push([item.row, r.employeeCode, 'skipped', 'Employee code already exists']);
            ok++;
            continue;
          }
          const ref = (
            /** @type {Map<string,string>} */ map,
            /** @type {string | undefined} */ value,
            /** @type {string} */ label,
          ) => {
            if (!value) return undefined;
            const id = map.get(value.toUpperCase());
            if (!id) throw new Error(`${label} "${value}" not found`);
            return id;
          };
          try {
            let managerId;
            if (r.managerEmployeeCode) {
              const m = await db().employee.findFirst({
                where: { employeeCode: r.managerEmployeeCode.toUpperCase() },
                select: { id: true },
              });
              if (!m) {
                if (pass < 9) {
                  deferred.push(item);
                  continue;
                }
                throw new Error(`Manager "${r.managerEmployeeCode}" not found`);
              }
              managerId = m.id;
            }
            const created = await employees.create(
              {
                employeeCode: r.employeeCode,
                firstName: r.firstName,
                lastName: r.lastName || null,
                workEmail: r.workEmail || null,
                phone: r.phone || null,
                dateOfJoining: r.dateOfJoining,
                probationEndDate: r.probationEndDate || null,
                legalEntityId: r.legalEntity ? ref(entityMap, r.legalEntity, 'Legal entity') : defaultEntity,
                departmentId: ref(deptMap, r.departmentCode, 'Department'),
                designationId: ref(desigMap, r.designation, 'Designation'),
                branchId: ref(branchMap, r.branchCode, 'Branch'),
                managerId,
                workMode: r.workMode || 'OFFICE',
                employmentType: r.employmentType || 'FULL_TIME',
                ...(r.status ? { status: r.status } : {}),
              },
              { source: `import:${jobId}` },
            );
            results.push([item.row, created.employeeCode, 'created', '']);
            ok++;
          } catch (err) {
            const e = /** @type {any} */ (err);
            results.push([
              item.row,
              r.employeeCode,
              'error',
              e?.extra?.errors?.map((x) => x.message).join('; ') ||
                e?.title ||
                e?.message ||
                'Could not create',
            ]);
            failed++;
          }
        }
        if (deferred.length === pending.length) {
          for (const item of deferred) {
            results.push([
              item.row,
              item.raw.employeeCode ?? '',
              'error',
              `Manager "${item.raw.managerEmployeeCode}" not found`,
            ]);
            failed++;
          }
          break;
        }
        pending = deferred;
      }

      const resultKey = keys.importResult(job.tenantId, jobId);
      const sorted = [results[0], ...results.slice(1).sort((a, b) => Number(a[0]) - Number(b[0]))];
      await files.put(
        buckets.reports,
        resultKey,
        stringify(sorted.map((row) => row.map(safeCsvCell))),
        'text/csv',
      );
      const status = failed === 0 ? 'SUCCEEDED' : ok === 0 ? 'FAILED' : 'PARTIAL';
      const done = await db().bulkImportJob.update({
        where: { id: jobId },
        data: {
          status,
          totalRows: records.length,
          okRows: ok,
          errorRows: failed,
          resultKey,
          finishedAt: new Date(),
        },
      });
      await audit(db(), {
        action: 'employee.import_finished',
        entityType: 'BulkImportJob',
        entityId: jobId,
        changes: { status, ok, failed },
      });
      return jobDto(done);
    },
  };
}
