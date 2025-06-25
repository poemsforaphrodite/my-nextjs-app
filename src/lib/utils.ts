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

/**
 * Async generator that yields parsed JSON objects from an SSE Response.
 * Usage:  for await (const obj of decodeSSE(resp)) {...}
 */
export async function* decodeSSE(resp: Response): AsyncGenerator<unknown, void, unknown> {
  if (!resp.body) {
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);

        const lines = frame.split('\n');
        const jsonStr = lines
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trimStart())   // 5 = "data:"
          .join('');
        if (jsonStr) {
          const parsed = safeJsonParse(jsonStr);
          if (parsed !== undefined) {
            yield parsed;
          } else {
            console.warn('Failed to parse SSE frame:', jsonStr);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
