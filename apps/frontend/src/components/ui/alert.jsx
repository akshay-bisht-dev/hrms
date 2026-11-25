import { cn } from '@/utils/cn';

const tones = {
  error: 'border-red-200 bg-danger-soft text-red-900',
  success: 'border-green-200 bg-success-soft text-green-900',
  info: 'border-blue-200 bg-primary-soft text-blue-900',
  warning: 'border-amber-200 bg-warning-soft text-amber-900',
};

/** Inline message. Errors use role="alert" so screen readers announce them; others are polite status. */
export function Alert({ tone = 'info', className, children }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-[var(--radius-control)] border px-3.5 py-3 text-sm', tones[tone], className)}
    >
      {children}
    </div>
  );
}
