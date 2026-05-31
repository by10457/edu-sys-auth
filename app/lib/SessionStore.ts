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

/** spider 项目直接可用的 Cookie 字典结构 */
export type SpiderCookieMap = Record<string, string>;

/** Redis 中存储的 Session 数据结构 */
export interface SessionData {
  /** 学校 ID */
  schoolId: string;
  /** 账号（学号） */
  username: string;
  /** 账号类型，对齐 edu-sys-spider 的 type/account_type */
  accountType: number;
  /** Playwright 原始 Cookie 数组，可直接用于请求回放 */
  cookies: Cookie[];
  /** edu-sys-spider 可直接传给 aiohttp 的 Cookie 字典 */
  cookieMap: SpiderCookieMap;
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

/** edu-sys-spider 登录态 Redis key 前缀 */
const SPIDER_SESSION_KEY_PREFIX = 'spider:login_session';

/** 安全余量（秒）：expiresAt 比 Redis TTL 提前的时间 */
const EXPIRES_AT_SAFETY_MARGIN_SEC = 600;

/** 构建 auth Session Redis Key：session:{schoolId}:{username}:{accountType} */
export function buildSessionKey(schoolId: string, username: string, accountType = 0): string {
  return `${SESSION_KEY_PREFIX}:${schoolId}:${username}:${accountType}`;
}

/** 构建 spider 兼容 Redis Key：spider:login_session:{cid}:{sid}:{account_type} */
export function buildSpiderSessionKey(schoolId: string, username: string, accountType = 0): string {
  return `${SPIDER_SESSION_KEY_PREFIX}:${schoolId}:${username}:${accountType}`;
}

/** 将 Playwright Cookie 数组压缩成 spider 使用的 name/value 字典 */
export function toSpiderCookieMap(cookies: Cookie[]): SpiderCookieMap {
  const cookieMap: SpiderCookieMap = {};
  for (const cookie of cookies) {
    cookieMap[cookie.name] = cookie.value;
  }
  return cookieMap;
}

/**
 * 从 Redis 读取 Session 数据
 * @returns null 表示不存在或已过期
 */
export async function readSessionFromRedis(
  redis: Redis,
  schoolId: string,
  username: string,
  accountType = 0,
): Promise<SessionData | null> {
  const key = buildSessionKey(schoolId, username, accountType);
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
  accountType: number,
  cookies: Cookie[],
  ttlSeconds: number,
  sessionId?: string,
): Promise<void> {
  const key = buildSessionKey(schoolId, username, accountType);
  const spiderKey = buildSpiderSessionKey(schoolId, username, accountType);
  const now = Date.now();
  const safeMargin = Math.min(EXPIRES_AT_SAFETY_MARGIN_SEC, ttlSeconds);
  const cookieMap = toSpiderCookieMap(cookies);
  const data: SessionData = {
    schoolId,
    username,
    accountType,
    cookies,
    cookieMap,
    sessionId,
    loginAt: now,
    expiresAt: now + (ttlSeconds - safeMargin) * 1000,
  };
  await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  await redis.set(spiderKey, JSON.stringify(cookieMap), 'EX', ttlSeconds);
}

/**
 * 删除 Session 缓存
 */
export async function deleteSessionFromRedis(
  redis: Redis,
  schoolId: string,
  username: string,
  accountType = 0,
): Promise<void> {
  const key = buildSessionKey(schoolId, username, accountType);
  const spiderKey = buildSpiderSessionKey(schoolId, username, accountType);
  await redis.del(key, spiderKey);
}
