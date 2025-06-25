import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Attempts to parse a string as JSON.  If it fails, it will try to
 *   1. Locate the first '{' and last '}' and parse the substring.
 *   2. Return undefined if still invalid.
 */
export function safeJsonParse(str: string): unknown | undefined {
  try {
    return JSON.parse(str);
  } catch {
    const first = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(str.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
