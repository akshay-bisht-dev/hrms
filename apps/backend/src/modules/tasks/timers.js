// @ts-check
/** Task timers. Kept separate so the work-session service can stop a timer without depending on the task service. */

/**
 * Stops every running timer of a person at `at` and refreshes the time spent on those tasks.
 * Used when they start another timer, take a break, end a session or the session is closed automatically.
 * @param {any} client Prisma client or transaction @param {string} employeeId @param {Date} at
 * @returns {Promise<string[]>} ids of tasks whose timer was stopped
 */
export async function stopRunningTimers(client, employeeId, at) {
  const open = await client.taskTimeEntry.findMany({ where: { employeeId, endedAt: null } });
  for (const e of open) {
    const endedAt = at < e.startedAt ? e.startedAt : at;
    await client.taskTimeEntry.update({
      where: { id: e.id },
      data: { endedAt, durationSec: Math.floor((endedAt.getTime() - e.startedAt.getTime()) / 1000) },
    });
  }
  const taskIds = [...new Set(open.map((/** @type {any} */ e) => e.taskId))];
  for (const id of taskIds) await refreshActual(client, id);
  return taskIds;
}

/** Recomputes a task's minutes spent from its finished time entries. @param {any} client @param {string} taskId */
export async function refreshActual(client, taskId) {
  const sum = await client.taskTimeEntry.aggregate({
    where: { taskId, endedAt: { not: null } },
    _sum: { durationSec: true },
  });
  await client.task.update({
    where: { id: taskId },
    data: { actualMin: Math.floor((sum._sum.durationSec ?? 0) / 60) },
  });
}
