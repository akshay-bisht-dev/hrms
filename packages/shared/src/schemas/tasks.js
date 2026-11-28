// @ts-check
import { z } from 'zod';
import { patchOf } from './patch.js';

const Id = z.uuid();
const DateStr = z.iso.date();

export const PROJECT_STATUSES = /** @type {const} */ ([
  'PLANNED',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
]);
export const TASK_PRIORITIES = /** @type {const} */ (['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const TASK_STATUSES = /** @type {const} */ ([
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'UNDER_REVIEW',
  'COMPLETED',
  'CANCELLED',
]);
export const REVIEW_DECISIONS = /** @type {const} */ (['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']);

const ProjectShape = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
    name: z.string().trim().min(1, 'Required').max(150),
    description: z.string().trim().max(5000).nullable().optional(),
    clientName: z.string().trim().max(150).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).default('ACTIVE'),
    isBillable: z.boolean().default(false),
    ownerEmployeeId: Id.nullable().optional(),
    startDate: DateStr.nullable().optional(),
    endDate: DateStr.nullable().optional(),
  })
  .strict();
/** @param {any} b @param {z.RefinementCtx} c */
const checkDates = (b, c) => {
  if (b.startDate && b.endDate && b.endDate < b.startDate)
    c.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after the start date' });
};
export const ProjectBody = ProjectShape.superRefine(checkDates);
export const ProjectPatch = patchOf(ProjectShape).superRefine(checkDates);
export const ProjectMembersBody = z
  .object({ employeeIds: z.array(Id).min(1).max(200), role: z.enum(['MEMBER', 'LEAD']).default('MEMBER') })
  .strict();

const TaskShape = z
  .object({
    title: z.string().trim().min(1, 'Required').max(250),
    description: z.string().trim().max(10_000).nullable().optional(),
    projectId: Id.nullable().optional(),
    parentTaskId: Id.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
    dueDate: DateStr.nullable().optional(),
    estimateMin: z.number().int().min(1).max(100_000).nullable().optional(),
    requiresApproval: z.boolean().default(false),
    /** Empty means "assign to me". Assigning anyone else needs task.assign in scope or being their manager. */
    assigneeIds: z.array(Id).max(20).default([]),
  })
  .strict();
export const TaskBody = TaskShape;
export const TaskPatch = patchOf(
  TaskShape.omit({ assigneeIds: true, projectId: true, parentTaskId: true }).extend({
    progressPct: z.number().int().min(0).max(100),
  }),
);
export const TaskAssigneesBody = z.object({ assigneeIds: z.array(Id).min(1).max(20) }).strict();
export const TaskStatusBody = z
  .object({ status: z.enum(TASK_STATUSES), comment: z.string().trim().max(2000).optional() })
  .strict();
export const TaskListQuery = z
  .object({
    view: z.enum(['mine', 'created', 'team', 'project']).default('mine'),
    projectId: Id.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    open: z.enum(['true', 'false']).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export const CommentBody = z.object({ body: z.string().trim().min(1, 'Write something').max(5000) }).strict();

export const ManualTimeBody = z
  .object({
    taskId: Id,
    date: DateStr,
    minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    note: z.string().trim().max(255).optional(),
  })
  .strict();
export const TimeEntryQuery = z
  .object({ from: DateStr, to: DateStr })
  .strict()
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'Must be on or after the start date' });

export const ReportNotesBody = z.object({ notes: z.string().trim().max(10_000) }).strict();
export const ReviewBody = z
  .object({ decision: z.enum(REVIEW_DECISIONS), comment: z.string().trim().max(2000).optional() })
  .strict()
  .refine((b) => b.decision === 'APPROVED' || (b.comment && b.comment.length > 0), {
    path: ['comment'],
    message: 'Add a short note so the person knows what to change',
  });
export const ReviewListQuery = z
  .object({
    view: z.enum(['mine', 'approvals']).default('mine'),
    status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).optional(),
  })
  .strict();
export const DayParams = z.object({ date: DateStr }).strict();
export const WeekQuery = z.object({ week: DateStr.optional() }).strict();
export const DashboardQuery = z
  .object({ from: DateStr.optional(), to: DateStr.optional() })
  .strict()
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    path: ['to'],
    message: 'Must be on or after the start date',
  });
