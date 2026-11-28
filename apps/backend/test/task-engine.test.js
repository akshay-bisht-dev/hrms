import { allowedMoves, checkMove } from '../src/modules/tasks/task-engine.js';

const assignee = { isAssignee: true, isReviewer: false };
const reviewer = { isAssignee: false, isReviewer: true };
const stranger = { isAssignee: false, isReviewer: false };
const t = (status, requiresApproval = false) => ({ status, requiresApproval });

test('the assignee moves work forward; a stranger cannot', () => {
  expect(checkMove(t('ASSIGNED'), 'IN_PROGRESS', assignee).ok).toBe(true);
  expect(checkMove(t('IN_PROGRESS'), 'COMPLETED', assignee).ok).toBe(true);
  expect(checkMove(t('ASSIGNED'), 'IN_PROGRESS', stranger)).toMatchObject({ code: 'not_assignee' });
});

test('only a reviewer cancels, reopens and approves', () => {
  expect(checkMove(t('ASSIGNED'), 'CANCELLED', assignee)).toMatchObject({ code: 'not_reviewer' });
  expect(checkMove(t('ASSIGNED'), 'CANCELLED', reviewer).ok).toBe(true);
  expect(checkMove(t('COMPLETED'), 'IN_PROGRESS', reviewer).ok).toBe(true);
  expect(checkMove(t('COMPLETED'), 'IN_PROGRESS', assignee)).toMatchObject({ code: 'not_reviewer' });
});

test('tasks that need approval go through review, and nobody approves their own work', () => {
  expect(checkMove(t('IN_PROGRESS', true), 'COMPLETED', assignee)).toMatchObject({ code: 'needs_review' });
  expect(checkMove(t('IN_PROGRESS', true), 'UNDER_REVIEW', assignee).ok).toBe(true);
  expect(checkMove(t('IN_PROGRESS', false), 'UNDER_REVIEW', assignee)).toMatchObject({
    code: 'no_review_needed',
  });
  expect(checkMove(t('UNDER_REVIEW', true), 'COMPLETED', reviewer).ok).toBe(true);
  // A creator who also works on the task still can't approve it.
  expect(
    checkMove(t('UNDER_REVIEW', true), 'COMPLETED', { isAssignee: true, isReviewer: true }),
  ).toMatchObject({
    code: 'own_review',
  });
  expect(checkMove(t('UNDER_REVIEW', true), 'IN_PROGRESS', reviewer).ok).toBe(true); // changes requested
});

test('cancelled is final and same-status moves are refused', () => {
  for (const to of ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'])
    expect(checkMove(t('CANCELLED'), to, reviewer)).toMatchObject({ code: 'invalid_transition' });
  expect(checkMove(t('ON_HOLD'), 'ON_HOLD', reviewer)).toMatchObject({ code: 'same_status' });
  expect(checkMove(t('ASSIGNED'), 'UNDER_REVIEW', assignee)).toMatchObject({ code: 'invalid_transition' });
});

test('allowed moves match the rules for every status and actor', () => {
  expect(allowedMoves(t('ASSIGNED'), assignee).sort()).toEqual(['IN_PROGRESS', 'ON_HOLD']);
  expect(allowedMoves(t('IN_PROGRESS', true), assignee).sort()).toEqual(['ON_HOLD', 'UNDER_REVIEW']);
  expect(allowedMoves(t('UNDER_REVIEW', true), reviewer).sort()).toEqual(['COMPLETED', 'IN_PROGRESS']);
  expect(allowedMoves(t('CANCELLED'), reviewer)).toEqual([]);
  const statuses = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED'];
  for (const s of statuses)
    for (const approval of [true, false])
      for (const actor of [assignee, reviewer, stranger])
        for (const to of allowedMoves(t(s, approval), actor))
          expect(checkMove(t(s, approval), to, actor).ok).toBe(true);
});
