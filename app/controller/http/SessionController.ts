/**
 * SessionController — Session HTTP 接口层
 *
 * 接口设计：
 *   POST /session/login          提交登录任务（缓存命中直返，否则异步入队）
 *   POST /session/query          查询 Redis Session（不触发登录）
 *   POST /session/delete         主动清除 Redis 缓存
 *   GET  /session/job/:jobId     查询任务状态（任务完成时一并返回 Session）
 *   GET  /health                 服务健康检查（含 Redis 连通性）
 *
 * 请求体统一字段：
 *   cid  - 学校 ID（如 "0001"）
 *   sid  - 学号
 *   pwd  - 密码（明文，仅在触发实际登录时使用）
 *
 * body.code 规范（HTTP 状态始终为 200）：
 *   200  成功，data 有数据
 *   202  已接受，异步处理中，凭 jobId 轮询 GET /session/job/:jobId
 *   400  参数错误 / 学校未实现
 *   401  账号或密码错误
 *   404  任务不存在 / Session 不存在
 *   410  Session 已过期，需重新登录
 *   500  系统 / 自动化异常
 */

import {
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  HTTPBody,
  HTTPParam,
  HTTPContext,
} from '@eggjs/tegg';
import type { Context } from 'egg';
import type { Redis } from 'ioredis';
import { SessionService } from '../../service/SessionService.ts';
import type { LoginQueueConfig } from '../../lib/LoginQueue.ts';

/** 标准请求体：学校 ID + 学号 + 密码 */
interface SessionRequestBody {
  /** 学校 ID，如 "0001" */
  cid: string;
  /** 学号 */
  sid: string;
  /** 密码（明文） */
  pwd: string;
  /** 账号类型，对齐 edu-sys-spider 的 type/account_type */
  type?: number | string;
  /** 账号类型的兼容字段 */
  account_type?: number | string;
  /**
   * 是否强制重新登录（跳过 Redis 缓存）
   * - 默认 false：缓存命中直返
   * - true：删除旧缓存并重新触发 Playwright 登录
   *
   * 典型使用场景：爬虫项目带着缓存 Cookie 发请求，对方返回 401/302 后再次调用本接口
   */
  force?: boolean;
}

@HTTPController({
  path: '/',
})
export class SessionController {
  /** 创建 SessionService 实例（LoginQueue 内部使用模块级单例，多次调用不会重建连接） */
  private getSessionService(ctx: Context): SessionService {
    const redis = (ctx.app as unknown as { redis: Redis }).redis;
    const redisConfig = (ctx.app.config as unknown as { redis: { client: LoginQueueConfig } }).redis
      .client;
    return new SessionService(redis, redisConfig);
  }

  /** 解析账号类型，兼容 spider 的 type/account_type 两种入参 */
  private getAccountType(body: Pick<SessionRequestBody, 'type' | 'account_type'> | null): number {
    const rawType = body?.type ?? body?.account_type ?? 0;
    const accountType = Number(rawType);
    return Number.isFinite(accountType) && accountType >= 0 ? accountType : 0;
  }

  /**
   * POST /session/login
   * 提交自动化登录任务。
   * - 缓存命中且 TTL 充裕 → 直接返回 Session（同步，code: 200）
   * - 否则 → 入队，返回 jobId（异步，code: 202），由调用方轮询 GET /session/job/:jobId
   */
  @HTTPMethod({
    method: HTTPMethodEnum.POST,
    path: '/session/login',
  })
  async submitLogin(@HTTPContext() ctx: Context, @HTTPBody() body: SessionRequestBody) {
    const { cid, sid, pwd, force = false } = body ?? {};
    const accountType = this.getAccountType(body ?? null);

    if (!cid || !sid || !pwd) {
      ctx.status = 200;
      ctx.body = {
        code: 400,
        message: '缺少必要参数：cid（学校ID）、sid（学号）、pwd（密码）',
        data: null,
      };
      return;
    }

    try {
      const sessionService = this.getSessionService(ctx);
      const result = await sessionService.getSession(cid, sid, pwd, accountType, force);

      if (result.hit) {
        // 缓存命中，直接返回 Session
        ctx.status = 200;
        ctx.body = { code: 200, message: 'ok', data: result.data };
        return;
      }

      // 异步处理中，返回 jobId
      ctx.status = 200;
      ctx.body = {
        code: 202,
        message: force
          ? '已提交强制刷新登录任务，请轮询 GET /session/job/:jobId 获取结果'
          : '登录任务已提交，请轮询 GET /session/job/:jobId 获取结果',
        data: { jobId: result.jobId },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      const isClientError = message.includes('尚未实现') || message.includes('不支持的学校');
      ctx.status = 200;
      ctx.body = { code: isClientError ? 400 : 500, message, data: null };
    }
  }

  /**
   * POST /session/query
   * 直接读取 Redis 中的 Session 数据，不触发重新登录。
   */
  @HTTPMethod({
    method: HTTPMethodEnum.POST,
    path: '/session/query',
  })
  async querySession(
    @HTTPContext() ctx: Context,
    @HTTPBody() body: Pick<SessionRequestBody, 'cid' | 'sid' | 'type' | 'account_type'>,
  ) {
    const { cid, sid } = body ?? {};
    const accountType = this.getAccountType(body ?? null);

    if (!cid || !sid) {
      ctx.status = 200;
      ctx.body = { code: 400, message: '缺少必要参数：cid、sid', data: null };
      return;
    }

    try {
      const sessionService = this.getSessionService(ctx);
      const data = await sessionService.readSession(cid, sid, accountType);
      if (!data) {
        ctx.status = 200;
        ctx.body = {
          code: 404,
          message: 'Session 不存在或已过期，请通过 POST /session/login 重新登录',
          data: null,
        };
        return;
      }
      ctx.status = 200;
      ctx.body = { code: 200, message: 'ok', data };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      ctx.status = 200;
      ctx.body = { code: 500, message, data: null };
    }
  }

  /**
   * POST /session/delete
   * 主动清除 Redis 中的 Session 缓存，下次请求将重新触发 Playwright 登录。
   */
  @HTTPMethod({
    method: HTTPMethodEnum.POST,
    path: '/session/delete',
  })
  async deleteSession(
    @HTTPContext() ctx: Context,
    @HTTPBody() body: Pick<SessionRequestBody, 'cid' | 'sid' | 'type' | 'account_type'>,
  ) {
    const { cid, sid } = body ?? {};
    const accountType = this.getAccountType(body ?? null);

    if (!cid || !sid) {
      ctx.status = 200;
      ctx.body = { code: 400, message: '缺少必要参数：cid、sid', data: null };
      return;
    }

    try {
      const sessionService = this.getSessionService(ctx);
      await sessionService.deleteSession(cid, sid, accountType);
      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: `已清除 Session 缓存（cid=${cid} sid=${sid}）`,
        data: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      ctx.status = 200;
      ctx.body = { code: 500, message, data: null };
    }
  }

  /**
   * GET /session/job/:jobId
   * 查询 BullMQ 任务状态。任务完成时，一并从 Redis 读取 Session 数据返回。
   *
   * code 含义：
   *   200  完成，data 中包含 Session 数据
   *   202  排队中 / 执行中，继续轮询
   *   401  账号或密码错误（登录失败，不会重试）
   *   404  任务不存在（已过期或 jobId 有误）
   *   410  Session 已过期（job 完成但 TTL 到期），需重新调用 /session/login
   *   500  自动化系统异常（网络超时 / 页面结构变化等）
   */
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/session/job/:jobId',
  })
  async getJobResult(@HTTPContext() ctx: Context, @HTTPParam({ name: 'jobId' }) jobId: string) {
    try {
      const sessionService = this.getSessionService(ctx);
      const result = await sessionService.getJobResult(jobId);

      if (result.status === 'unknown') {
        ctx.status = 200;
        ctx.body = { code: 404, message: '任务不存在，可能已过期或 jobId 有误', data: null };
        return;
      }

      if (result.status === 'failed') {
        const reason = result.failReason ?? '登录失败';
        // 账号或密码错误 → 401；其余自动化系统问题 → 500
        const isAuthError = reason.includes('账号或密码错误') || reason.includes('用户名或密码');
        ctx.status = 200;
        ctx.body = { code: isAuthError ? 401 : 500, message: reason, data: null };
        return;
      }

      if (result.status === 'completed') {
        if (!result.sessionData) {
          // job 已完成但 Session TTL 已到期，需重新登录
          ctx.status = 200;
          ctx.body = {
            code: 410,
            message: 'Session 已过期，请重新调用 POST /session/login 获取新凭证',
            data: null,
          };
          return;
        }
        ctx.status = 200;
        ctx.body = { code: 200, message: 'ok', data: result.sessionData };
        return;
      }

      // waiting / active
      ctx.status = 200;
      ctx.body = {
        code: 202,
        message: result.status === 'active' ? '登录任务执行中，请稍候...' : '任务排队等待中...',
        data: { status: result.status },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      ctx.status = 200;
      ctx.body = { code: 500, message, data: null };
    }
  }

  /**
   * GET /health
   * 服务健康检查，验证 Redis 连通性。
   */
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/health',
  })
  async health(@HTTPContext() ctx: Context) {
    const sessionService = this.getSessionService(ctx);
    const check = await sessionService.healthCheck();
    ctx.status = 200;
    ctx.body = {
      code: check.redis ? 200 : 500,
      message: check.redis ? 'ok' : 'Redis 连接异常，服务不可用',
      data: { redis: check.redis, timestamp: new Date().toISOString() },
    };
  }
}
