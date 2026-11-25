// @ts-check
import { z } from 'zod';

/** NIST SP 800-63B: length-based policy, all characters allowed, no composition rules. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const Password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

/** 6-digit TOTP code (spaces allowed while typing). */
export const TotpCode = z
  .string()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

export const RecoveryCode = z
  .string()
  .transform((s) => s.replace(/[\s-]+/g, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9]{10}$/, 'Enter a recovery code'));

export const RegisterBody = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your name').max(120),
    email: Email,
    password: Password,
    companyName: z.string().trim().min(2, 'Enter your company name').max(200),
    countryCode: z
      .string()
      .length(2)
      .transform((s) => s.toUpperCase()),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export const LoginBody = z
  .object({
    email: Email,
    password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX),
  })
  .strict();

export const MfaVerifyBody = z
  .object({
    challengeToken: z.string().min(1).max(2048),
    code: TotpCode.optional(),
    recoveryCode: RecoveryCode.optional(),
  })
  .strict()
  .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), {
    message: 'Send either a code or a recovery code',
  });

export const TokenBody = z.object({ token: z.string().min(20).max(200) }).strict();
export const EmailBody = z.object({ email: Email }).strict();
export const ResetPasswordBody = z
  .object({ token: z.string().min(20).max(200), password: Password })
  .strict();
export const ChangePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(PASSWORD_MAX), newPassword: Password })
  .strict();
export const PasswordConfirmBody = z.object({ password: z.string().min(1).max(PASSWORD_MAX) }).strict();
export const MfaConfirmBody = z.object({ code: TotpCode }).strict();
export const MfaDisableBody = z
  .object({ password: z.string().min(1).max(PASSWORD_MAX), code: TotpCode })
  .strict();
