// @ts-check
import { z } from 'zod';
import { Email, Password } from './auth.js';
import { PERMISSION_CODES, DATA_SCOPES } from '../permissions.js';

export const InviteBody = z
  .object({ email: Email, roleIds: z.array(z.uuid()).min(1).max(10), employeeId: z.uuid().optional() })
  .strict();
export const LinkEmployeeBody = z.object({ employeeId: z.uuid().nullable() }).strict();
export const MemberRolesBody = z.object({ roleIds: z.array(z.uuid()).min(1).max(10) }).strict();
export const AcceptInviteBody = z
  .object({
    token: z.string().min(20).max(200),
    fullName: z.string().trim().min(1).max(120).optional(),
    password: Password.optional(),
  })
  .strict();

const Grant = z
  .object({
    permissionCode: z.string().refine((c) => PERMISSION_CODES.has(c), 'Unknown permission'),
    scope: z.enum(/** @type {[string, ...string[]]} */ ([...DATA_SCOPES])),
  })
  .strict();

export const RoleBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(255).nullish(),
    grants: z
      .array(Grant)
      .max(200)
      .refine((g) => new Set(g.map((x) => x.permissionCode)).size === g.length, 'Each permission once'),
  })
  .strict();

export const SwitchTenantBody = z.object({ tenantId: z.uuid() }).strict();
