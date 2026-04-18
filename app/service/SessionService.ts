/**
 * SessionService — Session 核心业务逻辑
 *
 * 职责：
 * 1. 查询 Redis 缓存（命中且 TTL 充裕 → 直接返回）
 * 2. 缓存未命中或即将过期 → 写入 BullMQ 队列，返回 jobId
 * 3. 写入登录结果到 Redis（由 Worker 调用）
 * 4. 删除指定账号的 Session 缓存
 */

import { SingletonProto, AccessLevel, Inject } from '@eggjs/tegg';
import type { EggContext } from '@eggjs/tegg';
import type { Redis } from 'ioredis';
import type { Cookie } from 'playwright';
import { LoginQueue } from '../lib/LoginQueue.ts';
import { getSchoolConfig } from '../config/schools.ts';

/** Redis 中存储的 Session 数据结构 */
export interface SessionData {
  /** 学校 ID */
  schoolId: string;
  /** 账号（学号） */
  username: string;
  /** Playwright 原始 Cookie 数组 */
  cookies: Cookie[];
  /** 登录时间戳（ms） */
  loginAt: number;
  /** 预估过期时间戳（ms） */
  expiresAt: number;
}

/** getSession 的返回结果 */
export type GetSessionResult =
  | { hit: true; data: SessionData }
  | { hit: false; jobId: string };

/** Session Redis key 前缀 */
const SESSION_KEY_PREFIX = 'session';

function buildKey(schoolId: string, username: string): string {
  return `${SESSION_KEY_PREFIX}:${schoolId}:${username}`;
}

@SingletonProto({
  accessLevel: AccessLevel.PUBLIC,
})
export class SessionService {
  @Inject()
  private ctx!: EggContext;

  private get redis(): Redis {
    // egg-redis 挂载在 app.redis 上
    return (this.ctx.app as unknown as { redis: Redis }).redis;
  }

  private _loginQueue: LoginQueue | null = null;

  private get loginQueue(): LoginQueue {
    if (!this._loginQueue) {
      const redisConfig = (this.ctx.app.config as unknown as { redis: { client: object } }).redis
        .client;
      this._loginQueue = new LoginQueue(redisConfig as ConstructorParameters<typeof LoginQueue>[0]);
    }
    return this._loginQueue;
  }

  /**
   * 获取 Session：命中缓存直返，否则入队并返回 jobId
   */
  async getSession(
    schoolId: string,
    username: string,
    password: string,
  ): Promise<GetSessionResult> {
    const schoolConfig = getSchoolConfig(schoolId);
    if (!schoolConfig) {
      throw new Error(`不支持的学校 ID：${schoolId}`);
    }
    if (!schoolConfig.playwright.enabled) {
      throw new Error(`学校 ${schoolConfig.name}（${schoolId}）尚未实现 Playwright 自动化登录`);
    }

    const key = buildKey(schoolId, username);

    // 1. 查询 Redis
    if (schoolConfig.cache.enabled) {
      const raw = await this.redis.get(key);
      if (raw) {
        const ttl = await this.redis.ttl(key); // 返回剩余秒数
        // TTL 充裕（剩余时间 > minRemain），直接返回
        if (ttl > schoolConfig.cache.minRemain) {
          return { hit: true, data: JSON.parse(raw) as SessionData };
        }
      }
    }

    // 2. 缓存不存在或即将过期，写入队列
    const jobId = await this.loginQueue.enqueue({ schoolId, username, password });
    return { hit: false, jobId };
  }

  /**
   * 查询队列任务状态
   */
  async getJobResult(jobId: string) {
    return this.loginQueue.getJobResult(jobId);
  }

  /**
   * 主动删除 Session 缓存（强制下次重新登录）
   */
  async deleteSession(schoolId: string, username: string): Promise<void> {
    const key = buildKey(schoolId, username);
    await this.redis.del(key);
  }

  /**
   * 将登录结果写入 Redis（由 Worker 进程在登录成功后调用）
   * 此方法也可通过 HTTP 内部调用，或直接在 Worker 中操作 Redis 写入。
   */
  static async writeSession(
    redis: Redis,
    schoolId: string,
    username: string,
    cookies: Cookie[],
    ttlSeconds: number,
  ): Promise<void> {
    const key = buildKey(schoolId, username);
    const now = Date.now();
    const data: SessionData = {
      schoolId,
      username,
      cookies,
      loginAt: now,
      // 安全余量：TTL 减去 10 分钟，避免拿到即将失效的 Session
      expiresAt: now + (ttlSeconds - 600) * 1000,
    };
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }
}
