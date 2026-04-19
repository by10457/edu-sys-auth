/**
 * SessionStore — Redis Session 存取工具
 *
 * 纯函数模块，不依赖 Tegg/Egg.js 框架，可直接在 Worker 进程中使用。
 *
 * 职责：
 * - 构建 Redis Key
 * - 读写 Session 数据
 */

import type { Redis } from 'ioredis';
import type { Cookie } from 'playwright';

/** Redis 中存储的 Session 数据结构 */
export interface SessionData {
  /** 学校 ID */
  schoolId: string;
  /** 账号（学号） */
  username: string;
  /** Playwright 原始 Cookie 数组，可直接用于请求回放 */
  cookies: Cookie[];
  /**
   * 核心 Session Cookie 值（可选，便于调用方快速取用）
   * 各学校实现应尽量提取，常见字段：JSESSIONID、MOD_AUTH_CAS 等
   */
  sessionId?: string;
  /** 登录时间戳（ms） */
  loginAt: number;
  /**
   * 预估过期时间戳（ms）
   * = loginAt + (ttlSeconds - 安全余量) * 1000
   * 安全余量默认 10 分钟，防止调用方拿到即将失效的 Session
   */
  expiresAt: number;
}

/** Session Redis key 前缀 */
const SESSION_KEY_PREFIX = 'session';

/** 安全余量（秒）：expiresAt 比 Redis TTL 提前的时间 */
const EXPIRES_AT_SAFETY_MARGIN_SEC = 600;

/** 构建 Session Redis Key：session:{schoolId}:{username} */
export function buildSessionKey(schoolId: string, username: string): string {
  return `${SESSION_KEY_PREFIX}:${schoolId}:${username}`;
}

/**
 * 从 Redis 读取 Session 数据
 * @returns null 表示不存在或已过期
 */
export async function readSessionFromRedis(
  redis: Redis,
  schoolId: string,
  username: string,
): Promise<SessionData | null> {
  const key = buildSessionKey(schoolId, username);
  const raw = await redis.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

/**
 * 将登录结果写入 Redis
 * 由 Worker 进程在登录成功后调用。
 *
 * expiresAt 安全余量：当 ttlSeconds ≤ 600 时，余量取 ttlSeconds 本身，
 * 避免 expiresAt 落到过去。
 */
export async function writeSessionToRedis(
  redis: Redis,
  schoolId: string,
  username: string,
  cookies: Cookie[],
  ttlSeconds: number,
  sessionId?: string,
): Promise<void> {
  const key = buildSessionKey(schoolId, username);
  const now = Date.now();
  const safeMargin = Math.min(EXPIRES_AT_SAFETY_MARGIN_SEC, ttlSeconds);
  const data: SessionData = {
    schoolId,
    username,
    cookies,
    sessionId,
    loginAt: now,
    expiresAt: now + (ttlSeconds - safeMargin) * 1000,
  };
  await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
}

/**
 * 删除 Session 缓存
 */
export async function deleteSessionFromRedis(
  redis: Redis,
  schoolId: string,
  username: string,
): Promise<void> {
  const key = buildSessionKey(schoolId, username);
  await redis.del(key);
}
