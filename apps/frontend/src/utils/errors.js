import { ApiError } from '@/services/api';

/**
 * User-facing message for a failed request. Server titles are written for people (Phase 2, writing style),
 * so they are shown as-is; network and rate-limit errors get local wording.
 * @param {unknown} err @param {(k: string, o?: object) => string} t
 */
export function errorMessage(err, t) {
  if (err instanceof ApiError) {
    if (err.status === 429)
      return t('auth.errors.tooMany', { minutes: Math.max(1, Math.ceil((err.retryAfterSec ?? 60) / 60)) });
    return err.message || t('auth.errors.generic');
  }
  if (err instanceof TypeError) return t('auth.errors.network');
  return t('auth.errors.generic');
}
