import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '@/lib/utils';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const obj = { hello: 'world' };
    const parsed = safeJsonParse(JSON.stringify(obj));
    expect(parsed).toEqual(obj);
  });

  it('parses JSON with leading text', () => {
    const raw = 'data: {"foo":"bar"}';
    const parsed = safeJsonParse(raw);
    expect(parsed).toEqual({ foo: 'bar' });
  });

  it('returns undefined on invalid JSON', () => {
    const parsed = safeJsonParse('not-json');
    expect(parsed).toBeUndefined();
  });
}); 