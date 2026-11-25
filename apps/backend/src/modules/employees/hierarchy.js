// @ts-check
/**
 * Reporting hierarchy as a closure table (employee_hierarchies): one row per (ancestor, descendant, depth),
 * including each employee's own row at depth 0. "Who reports to X, at any level" is a single indexed lookup.
 * All functions take a Prisma transaction client so changes commit together with the employee update.
 */

/**
 * Adds a new employee under a manager (or as a root).
 * @param {any} tx @param {string} employeeId @param {string | null} managerId
 */
export async function insertNode(tx, employeeId, managerId) {
  const ancestors = managerId
    ? await tx.employeeHierarchy.findMany({ where: { descendantId: managerId } })
    : [];
  await tx.employeeHierarchy.createMany({
    data: [
      { ancestorId: employeeId, descendantId: employeeId, depth: 0 },
      ...ancestors.map((/** @type {any} */ a) => ({
        ancestorId: a.ancestorId,
        descendantId: employeeId,
        depth: a.depth + 1,
      })),
    ],
  });
}

/**
 * True when `candidateManagerId` is the employee or reports to them (which would create a loop).
 * @param {any} tx @param {string} employeeId @param {string} candidateManagerId
 */
export async function wouldCreateCycle(tx, employeeId, candidateManagerId) {
  if (employeeId === candidateManagerId) return true;
  const row = await tx.employeeHierarchy.findFirst({
    where: { ancestorId: employeeId, descendantId: candidateManagerId },
  });
  return Boolean(row);
}

/**
 * Moves an employee — with everyone under them — to a new manager (or to the top).
 * @param {any} tx @param {string} employeeId @param {string | null} newManagerId
 */
export async function moveSubtree(tx, employeeId, newManagerId) {
  const subtree = await tx.employeeHierarchy.findMany({ where: { ancestorId: employeeId } });
  const subtreeIds = subtree.map((/** @type {any} */ r) => r.descendantId);
  // Drop links from outside the subtree into it.
  await tx.employeeHierarchy.deleteMany({
    where: { descendantId: { in: subtreeIds }, ancestorId: { notIn: subtreeIds } },
  });
  if (!newManagerId) return;
  const ancestors = await tx.employeeHierarchy.findMany({ where: { descendantId: newManagerId } });
  const rows = [];
  for (const a of ancestors) {
    for (const s of subtree)
      rows.push({ ancestorId: a.ancestorId, descendantId: s.descendantId, depth: a.depth + s.depth + 1 });
  }
  if (rows.length) await tx.employeeHierarchy.createMany({ data: rows });
}
