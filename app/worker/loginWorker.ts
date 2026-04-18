/**
 * loginWorker — BullMQ 消费 Worker（独立子进程入口）
 *
 * 运行模式：
 *   作为独立的 Node.js 子进程启动（不依赖 Egg.js 框架）
 *   通过环境变量读取 Redis 连接配置和浏览器池参数
 *
 * 职责：
 *   1. 进程启动时预热 BrowserPool
 *   2. 持续消费 BullMQ 的 edu-login 队列
 *   3. 每个任务：acquire Context → 执行学校登录 → 写 Redis → release Context
 *   4. 监听 SIGTERM，优雅退出
 *
 * 启动方式（在主进程中 fork）：
 *   node --import @oxc-node/core/register app/worker/loginWorker.ts
 */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { BrowserPool } from '../lib/BrowserPool.ts';
import { LOGIN_QUEUE_NAME, type LoginJobData } from '../lib/LoginQueue.ts';
import { getLoginService } from '../service/login/registry.ts';
import { SessionService } from '../service/SessionService.ts';
import { getSchoolConfig } from '../config/schools.ts';

// ── 从环境变量读取配置 ────────────────────────────────────────────────────────

const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? '';
const REDIS_DB = parseInt(process.env.REDIS_DB ?? '0', 10);

const BROWSER_COUNT = parseInt(process.env.BROWSER_COUNT ?? '2', 10);
const CONTEXTS_PER_BROWSER = parseInt(process.env.CONTEXTS_PER_BROWSER ?? '5', 10);
/** BullMQ 每个 Worker 并发消费数 = 总 Context 数 */
const CONCURRENCY = BROWSER_COUNT * CONTEXTS_PER_BROWSER;

const redisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || undefined,
  db: REDIS_DB,
  maxRetriesPerRequest: null, // BullMQ 要求此项为 null
};

// ── 初始化资源 ────────────────────────────────────────────────────────────────

const redis = new Redis(redisOptions);
const pool = new BrowserPool({ browserCount: BROWSER_COUNT, contextsPerBrowser: CONTEXTS_PER_BROWSER });

let isShuttingDown = false;

// ── 初始化 BrowserPool ────────────────────────────────────────────────────────

console.log(`[Worker] 预热浏览器池：${BROWSER_COUNT} Browser × ${CONTEXTS_PER_BROWSER} Context...`);
await pool.init();
console.log(`[Worker] 浏览器池就绪，并发消费数：${CONCURRENCY}`);

// ── 启动 BullMQ Worker ────────────────────────────────────────────────────────

const worker = new Worker<LoginJobData>(
  LOGIN_QUEUE_NAME,
  async (job) => {
    const { schoolId, username, password } = job.data;
    const schoolConfig = getSchoolConfig(schoolId);
    if (!schoolConfig) {
      throw new Error(`未知学校 ID：${schoolId}`);
    }

    const loginService = getLoginService(schoolId);
    const managed = await pool.acquire();

    let dirty = false;
    try {
      // 在独立 Page 中执行登录
      const page = await managed.ctx.newPage();
      let result;
      try {
        result = await loginService.login(page, username, password);
      } finally {
        await page.close().catch(() => null);
      }

      // 写入 Redis
      const ttl = schoolConfig.cache.ttl;
      await SessionService.writeSession(redis, schoolId, username, result.cookies, ttl);

      console.log(
        `[Worker] 登录成功 schoolId=${schoolId} username=${username} TTL=${ttl}s`,
      );

      return { success: true, loginAt: result.loginAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] 登录失败 schoolId=${schoolId} username=${username}: ${message}`);

      // 账号密码错误不重试，直接标记失败
      if (message.includes('账号或密码错误')) {
        // 抛出 UnrecoverableError 阻止 BullMQ 重试
        const { UnrecoverableError } = await import('bullmq');
        throw new UnrecoverableError(message);
      }

      // Context 可能损坏，标记为 dirty
      dirty = true;
      throw err;
    } finally {
      await pool.release(managed, dirty);
    }
  },
  {
    connection: redisOptions,
    concurrency: CONCURRENCY,
  },
);

worker.on('failed', (job, err) => {
  console.error(`[Worker] 任务失败 jobId=${job?.id}: ${err.message}`);
});

worker.on('error', (err) => {
  console.error(`[Worker] Worker 错误: ${err.message}`);
});

console.log(`[Worker] 已启动，监听队列「${LOGIN_QUEUE_NAME}」`);

// ── 优雅退出 ──────────────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker] 收到 ${signal}，开始优雅退出...`);

  // 1. 停止接收新任务，等待当前任务完成
  await worker.close();
  console.log('[Worker] BullMQ Worker 已关闭');

  // 2. 关闭浏览器池
  await pool.close();
  console.log('[Worker] BrowserPool 已关闭');

  // 3. 关闭 Redis 连接
  redis.disconnect();
  console.log('[Worker] Redis 连接已断开');

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
