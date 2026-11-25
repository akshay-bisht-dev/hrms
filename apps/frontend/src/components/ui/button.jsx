import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:bg-border disabled:text-text-muted',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover',
        secondary: 'border border-border-strong bg-surface text-text hover:bg-bg',
        ghost: 'bg-transparent text-primary hover:bg-primary-soft',
        destructive: 'bg-danger text-white hover:bg-red-700',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-11 px-5 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/**
 * shadcn/ui-style button (JavaScript). `asChild` renders the child element (e.g. a router link) with button styles.
 * @param {{ className?: string, variant?: 'primary'|'secondary'|'ghost'|'destructive', size?: 'sm'|'md'|'lg', asChild?: boolean } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ className, variant, size, asChild = false, type, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    />
  );
}
