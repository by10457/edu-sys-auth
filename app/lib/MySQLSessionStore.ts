/**
 * MySQLSessionStore — edu-sys-spider 兼容登录会话持久化。
 *
 * auth 服务的主链路仍然是 Redis；MySQL 写入用于补齐 spider 的 DB fallback。
 */

import { createPool, type Pool } from 'mysql2/promise';
import type { SpiderCookieMap } from './SessionStore.ts';

export const SPIDER_LOGIN_SESSION_TABLE = 'spider_login_session';

export interface MySQLSessionConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

export interface SaveMySQLSessionParams {
  schoolId: string;
  username: string;
  password: string;
  accountType: number;
  cookieMap: SpiderCookieMap;
}

type EnvLike = Record<string, string | undefined>;

export function getMySQLSessionConfigFromEnv(env: EnvLike = process.env): MySQLSessionConfig {
  return {
    enabled: env.MYSQL_ENABLED !== 'false',
    host: env.MYSQL_HOST ?? '127.0.0.1',
    port: Number.parseInt(env.MYSQL_PORT ?? '3306', 10),
    user: env.MYSQL_USER ?? 'root',
    password: env.MYSQL_PASSWORD ?? '',
    database: env.MYSQL_DB ?? 'wxy_edu',
    connectionLimit: Number.parseInt(env.MYSQL_CONNECTION_LIMIT ?? '3', 10),
  };
}

export function createMySQLSessionPool(config = getMySQLSessionConfigFromEnv()): Pool | null {
  if (!config.enabled) return null;
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    charset: 'utf8mb4',
  });
}

export async function saveSessionToMySQL(
  pool: Pool,
  params: SaveMySQLSessionParams,
): Promise<void> {
  const cookies = JSON.stringify(params.cookieMap);
  await pool.execute(
    `
      INSERT INTO ${SPIDER_LOGIN_SESSION_TABLE}
        (cid, sid, pwd, account_type, cookies)
      VALUES
        (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pwd = VALUES(pwd),
        cookies = VALUES(cookies),
        update_time = CURRENT_TIMESTAMP
    `,
    [params.schoolId, params.username, params.password, String(params.accountType), cookies],
  );
}

export async function closeMySQLSessionPool(pool: Pool | null): Promise<void> {
  if (pool) {
    await pool.end();
  }
}
