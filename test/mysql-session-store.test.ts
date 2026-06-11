import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  getMySQLSessionConfigFromEnv,
  saveSessionToMySQL,
  SPIDER_LOGIN_SESSION_TABLE,
} from '../app/lib/MySQLSessionStore.ts';

describe('MySQLSessionStore', () => {
  it('uses edu_user and spider_login_session defaults', () => {
    const config = getMySQLSessionConfigFromEnv({});

    expect(config.enabled).toBe(true);
    expect(config.database).toBe('edu_user');
    expect(SPIDER_LOGIN_SESSION_TABLE).toBe('spider_login_session');
  });

  it('can disable mysql persistence from env', () => {
    const config = getMySQLSessionConfigFromEnv({ MYSQL_ENABLED: 'false' });

    expect(config.enabled).toBe(false);
  });

  it('upserts spider compatible login session rows', async () => {
    const execute = vi.fn().mockResolvedValue([{}, []]);
    const pool = { execute } as unknown as Pool;

    await saveSessionToMySQL(pool, {
      schoolId: '0008',
      username: '20220001',
      password: 'secret',
      accountType: 0,
      cookieMap: { JSESSIONID: 'abc' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, values] = execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO spider_login_session');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(values).toEqual(['0008', '20220001', 'secret', '0', '{"JSESSIONID":"abc"}']);
  });
});
