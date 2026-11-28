// @ts-check
/**
 * Task status rules (pure). Assignees move their own work forward; the person who created the task, or a manager,
 * reviews, reopens and cancels. A task that needs approval goes through UNDER_REVIEW and only someone other than
 * the assignee can complete it.
 */

/** @typedef {'ASSIGNED'|'IN_PROGRESS'|'ON_HOLD'|'UNDER_REVIEW'|'COMPLETED'|'CANCELLED'} Status */
/** @typedef {{ isAssignee: boolean, isReviewer: boolean }} Actor  isReviewer = creator, direct manager or task.assign in scope */

const WORK = 'work'; // the assignee's own progress
const REVIEW = 'review'; // creator / manager decisions

/** from → to → who may make the move */
const MOVES = /** @type {Record<Status, Partial<Record<Status, string>>>} */ ({
  ASSIGNED: { IN_PROGRESS: WORK, ON_HOLD: WORK, CANCELLED: REVIEW },
  IN_PROGRESS: { ON_HOLD: WORK, UNDER_REVIEW: WORK, COMPLETED: WORK, CANCELLED: REVIEW },
  ON_HOLD: { IN_PROGRESS: WORK, CANCELLED: REVIEW },
  UNDER_REVIEW: { COMPLETED: REVIEW, IN_PROGRESS: REVIEW },
  COMPLETED: { IN_PROGRESS: REVIEW },
  CANCELLED: {},
});

export const OPEN_STATUSES = /** @type {const} */ (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'UNDER_REVIEW']);

/**
 * Checks one status change.
 * @param {{ status: Status, requiresApproval: boolean }} task
 * @param {Status} to
 * @param {Actor} actor
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function checkMove(task, to, actor) {
  if (task.status === to)
    return { ok: false, code: 'same_status', message: 'The task already has this status' };
  const who = MOVES[task.status]?.[to];
  if (!who)
    return {
      ok: false,
      code: 'invalid_transition',
      message: `A task can't go from ${label(task.status)} to ${label(to)}`,
    };
  if (to === 'COMPLETED' && task.status === 'IN_PROGRESS' && task.requiresApproval)
    return {
      ok: false,
      code: 'needs_review',
      message: 'This task needs approval: send it for review instead',
    };
  if (to === 'UNDER_REVIEW' && !task.requiresApproval)
    return {
      ok: false,
      code: 'no_review_needed',
      message: 'This task does not need approval: mark it completed',
    };
  if (who === WORK && !actor.isAssignee && !actor.isReviewer)
    return { ok: false, code: 'not_assignee', message: 'Only the people working on this task can do that' };
  if (who === REVIEW && !actor.isReviewer)
    return {
      ok: false,
      code: 'not_reviewer',
      message: 'Only the person who set the task, or a manager, can do that',
    };
  // Nobody approves their own work.
  if (task.status === 'UNDER_REVIEW' && to === 'COMPLETED' && actor.isAssignee)
    return { ok: false, code: 'own_review', message: 'Someone else must approve your work' };
  return { ok: true };
}

/** Statuses the actor may move the task to (for the UI). @param {{ status: Status, requiresApproval: boolean }} task @param {Actor} actor */
export function allowedMoves(task, actor) {
  return /** @type {Status[]} */ (Object.keys(MOVES[task.status] ?? {})).filter(
    (to) => checkMove(task, to, actor).ok,
  );
}

const label = (/** @type {string} */ s) => s.toLowerCase().replace('_', ' ');
