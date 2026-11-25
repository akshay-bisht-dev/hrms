import { useId } from 'react';
import { cn } from '@/utils/cn';

/**
 * Labelled input with help and error text wired through aria-describedby (design system §4: labels always visible).
 * @param {{ label: string, hint?: string, error?: string, className?: string } & import('react').InputHTMLAttributes<HTMLInputElement>} props
 */
export function Field({ label, hint, error, className, id, ...input }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'h-11 rounded-[var(--radius-control)] border bg-surface px-3 text-sm outline-none focus-visible:border-primary',
          error ? 'border-danger' : 'border-border-strong',
        )}
        {...input}
      />
      {hint && !error && (
        <span id={hintId} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

/** @param {{ label: string, children: import('react').ReactNode, error?: string } & import('react').SelectHTMLAttributes<HTMLSelectElement>} props */
export function SelectField({ label, children, error, id, ...select }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
        {...select}
      >
        {children}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
