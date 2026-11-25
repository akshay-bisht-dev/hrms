import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-slate-100 text-text-muted',
        info: 'bg-primary-soft text-primary-hover',
        success: 'bg-success-soft text-success-text',
        warning: 'bg-warning-soft text-warning-text',
        danger: 'bg-danger-soft text-red-700',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const dot = {
  neutral: 'bg-border-strong',
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** Status badge: always shows text, the dot is decorative (status is never color alone). */
export function Badge({ tone = 'neutral', withDot = false, className, children }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {withDot && <span aria-hidden="true" className={cn('size-2 rounded-full', dot[tone])} />}
      {children}
    </span>
  );
}
