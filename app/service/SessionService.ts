/**
 * SessionService — Session 核心业务逻辑
 *
 * 不使用 Tegg @SingletonProto/@Inject()，改用工厂函数实例化。
 * 原因：@SingletonProto 必须在 ModuleLoadUnit 中使用，而当前项目
 * 的 Egg.js + ts-node/ESM 混合环境使得 ModuleLoadUnit 加载有兼容限制。
 *
 * 职责：
 * 1. 查询 Redis 缓存（命中且 TTL 充裕 → 直接返回）
 * 2. 缓存未命中或即将过期 → 写入 BullMQ 队列，返回 jobId
 * 3. 直接读取 Redis Session 数据（不触发登录）
 * 4. 删除指定账号的 Session 缓存
 * 5. 健康检查（Redis 连通性）
 *
 * 注意：此服务面向纯内部可信调用，缓存命中时不校验密码，
 * 即：只要 session:{cid}:{sid} 在 Redis 中有效，任何请求都直接返回。
 */

import type { Redis } from 'ioredis';
import { LoginQueue, type LoginQueueConfig } from '../lib/LoginQueue.ts';
import { getSchoolConfig } from '../config/schools.ts';
import {
  buildSessionKey,
  readSessionFromRedis,
  deleteSessionFromRedis,
  type SessionData,
} from '../lib/SessionStore.ts';

export type { SessionData };

/** getSession 的返回结果 */
export type GetSessionResult = { hit: true; data: SessionData } | { hit: false; jobId: string };

/** getJobResult 的返回结果 */
export interface JobResult {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
  /** 任务完成时直接带回 Session 数据，避免调用方再发一次请求 */
  sessionData?: SessionData | null;
  failReason?: string;
}

/** LoginQueue 模块级单例（避免每次请求重建连接） */
let _loginQueueInstance: LoginQueue | null = null;

function getLoginQueue(redisConfig: LoginQueueConfig): LoginQueue {
  if (!_loginQueueInstance) {
    _loginQueueInstance = new LoginQueue(redisConfig);
  }
  return _loginQueueInstance;
}

export class SessionService {
  private redis: Redis;
  private loginQueue: LoginQueue;

  constructor(redis: Redis, redisConfig: LoginQueueConfig) {
    this.redis = redis;
    this.loginQueue = getLoginQueue(redisConfig);
  }

  /**
   * 获取 Session：命中缓存直返，否则入队并返回 jobId
   *
   * @param force 为 true 时跳过 Redis 缓存，删除旧 Session 并直接触发自动化登录
   *             用于爬虫项目发现缓存 Cookie 已失效后的“强制刷新”场景
   */
  async getSession(
    schoolId: string,
    username: string,
    password: string,
    force = false,
  ): Promise<GetSessionResult> {
    const schoolConfig = getSchoolConfig(schoolId);
    if (!schoolConfig) {
      throw new Error(`不支持的学校 ID：${schoolId}`);
    }
    if (!schoolConfig.playwright.enabled) {
      throw new Error(`学校 ${schoolConfig.name}（${schoolId}）尚未实现 Playwright 自动化登录`);
    }

    // force 模式：删除旧缓存，直接入队
    if (force) {
      await deleteSessionFromRedis(this.redis, schoolId, username);
      const jobId = await this.loginQueue.enqueue({ schoolId, username, password });
      return { hit: false, jobId };
    }

    // 1. 查询 Redis 缓存
    if (schoolConfig.cache.enabled) {
      const data = await readSessionFromRedis(this.redis, schoolId, username);
      if (data) {
        const ttl = await this.redis.ttl(buildSessionKey(schoolId, username));
        if (ttl > schoolConfig.cache.minRemain) {
          return { hit: true, data };
        }
      }
    }

    // 2. 缓存不存在或即将过期，写入队列
    const jobId = await this.loginQueue.enqueue({ schoolId, username, password });
    return { hit: false, jobId };
  }

  /**
   * 直接从 Redis 读取 Session 数据，不触发登录
   */
  async readSession(schoolId: string, username: string): Promise<SessionData | null> {
    return readSessionFromRedis(this.redis, schoolId, username);
  }

  /**
   * 查询队列任务状态，任务完成时一并从 Redis 读取 Session 数据
   */
  async getJobResult(jobId: string): Promise<JobResult> {
    const result = await this.loginQueue.getJobResult(jobId);

    if (result.status === 'completed') {
      const rv = result.result as { schoolId?: string; username?: string } | undefined;
      let sessionData: SessionData | null = null;
      if (rv?.schoolId && rv?.username) {
        sessionData = await readSessionFromRedis(this.redis, rv.schoolId, rv.username);
      }
      return { status: 'completed', sessionData };
    }

    return { status: result.status, failReason: result.failReason };
  }

  /**
   * 主动删除 Session 缓存（强制下次重新登录）
   */
  async deleteSession(schoolId: string, username: string): Promise<void> {
    return deleteSessionFromRedis(this.redis, schoolId, username);
  }

  /**
   * Redis 健康检查
   */
  async healthCheck(): Promise<{ redis: boolean }> {
    try {
      await this.redis.ping();
      return { redis: true };
    } catch {
      return { redis: false };
    }
  }
}
