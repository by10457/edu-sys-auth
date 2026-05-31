import { describe, expect, it } from 'vitest';
import type { Cookie } from 'playwright';
import {
  buildSessionKey,
  buildSpiderSessionKey,
  toSpiderCookieMap,
} from '../app/lib/SessionStore.ts';

describe('SessionStore', () => {
  it('builds auth and spider compatible redis keys with account type', () => {
    expect(buildSessionKey('0008', '20220001', 0)).toBe('session:0008:20220001:0');
    expect(buildSpiderSessionKey('0008', '20220001', 0)).toBe(
      'spider:login_session:0008:20220001:0',
    );
  });

  it('converts Playwright cookies to spider cookie map', () => {
    const cookies = [
      {
        name: 'JSESSIONID',
        value: 'abc',
        domain: 'jwzx.usc.edu.cn',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ] satisfies Cookie[];

    expect(toSpiderCookieMap(cookies)).toEqual({ JSESSIONID: 'abc' });
  });
});
