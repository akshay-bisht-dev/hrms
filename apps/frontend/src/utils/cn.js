import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, letting later Tailwind utilities win. @param {...any} inputs */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
