// @ts-check
/**
 * A submitted or approved weekly timesheet locks the time it covers: task time and work-session corrections for
 * those days are refused until the approver asks for changes (or the timesheet is rejected).
 */
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { ConflictError } from '../../lib/errors.js';
import { ymdToDate, weekStart } from '../../lib/time.js';

export const LOCKING_STATUSES = ['SUBMITTED', 'APPROVED'];

/** The week (YYYY-MM-DD of its first day) containing `ymd` for a person, by their legal entity's week start. */
export async function weekOf(/** @type {string} */ employeeId, /** @type {string} */ ymd) {
  const emp = await db().employee.findUnique({
    where: { id: employeeId },
    select: { legalEntity: { select: { weekStartDay: true } } },
  });
  return /** @type {string} */ (weekStart(ymd, emp?.legalEntity?.weekStartDay ?? 1));
}

/** The timesheet locking that day, or null. @param {string} employeeId @param {string} ymd */
export async function lockingTimesheet(employeeId, ymd) {
  const ws = await weekOf(employeeId, ymd);
  const tenantId = /** @type {any} */ (currentContext()).tenantId;
  const t = await db().timesheetApproval.findUnique({
    where: { tenantId_employeeId_weekStart: { tenantId, employeeId, weekStart: ymdToDate(ws) } },
  });
  return t && LOCKING_STATUSES.includes(t.status) ? t : null;
}

/** Throws when the day belongs to a submitted or approved timesheet. @param {string} employeeId @param {string} ymd */
export async function assertWeekOpen(employeeId, ymd) {
  const t = await lockingTimesheet(employeeId, ymd);
  if (t)
    throw new ConflictError(
      'timesheet_locked',
      t.status === 'APPROVED'
        ? 'The timesheet for this week is approved, so its time can no longer change'
        : 'The timesheet for this week was submitted. Ask your approver to send it back first',
    );
}
