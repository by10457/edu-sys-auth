/**
 * loginWorker — BullMQ 消费 Worker（独立子进程入口）
 *
 * 运行模式：
 *   作为独立的 Node.js 子进程启动（不依赖 Egg.js 框架）
 *   Redis 配置统一通过环境变量注入，与 Egg.js 生产配置保持一致。
 *
 * 职责：
 *   1. 进程启动时预热 BrowserPool
 *   2. 持续消费 BullMQ 的 edu-login 队列
 *   3. 每个任务：acquire Context → 执行学校登录 → 写 Redis → release Context
 *   4. 监听 SIGTERM，优雅退出
 *
 * 启动方式：
 *   开发：npm run worker:dev
 *   生产：node --import @oxc-node/core/register app/worker/loginWorker.ts
 *
 * 环境变量：
 *   REDIS_HOST            Redis 地址，默认 127.0.0.1
 *   REDIS_PORT            Redis 端口，默认 6379
 *   REDIS_PASSWORD        Redis 密码，默认空
 *   REDIS_DB              Redis 数据库索引，默认 0
 *   BROWSER_COUNT         Browser 实例数，默认：无头模式 2，有头模式 1
 *   CONTEXTS_PER_BROWSER  每个 Browser 的 Context 数，默认：无头模式 5，有头模式 2
 *   HEADLESS              是否无头模式，默认 true；设为 false 开启有头调试
 *                         有头模式下 BROWSER_COUNT 和 CONTEXTS_PER_BROWSER 默认值自动降低
 *
 * ⚠️  Redis 配置注意事项：
 *   Worker 进程是独立子进程，无法读取 Egg.js 的 config.default.ts。
 *   生产部署时，请确保此处的环境变量与 config.prod.ts 或 config.local.ts
 *   中的 redis.client 配置指向同一个 Redis 实例，否则 API 写队列而 Worker
 *   看不到任务，或 Worker 写 Session 而 API 查不到缓存。
 */

import { Worker, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { BrowserPool } from '../lib/BrowserPool.ts';
import { LOGIN_QUEUE_NAME, type LoginJobData } from '../lib/LoginQueue.ts';
import { getLoginService } from '../service/login/registry.ts';
import { writeSessionToRedis } from '../lib/SessionStore.ts';
import { getSchoolConfig } from '../config/schools.ts';

// ── 从环境变量读取 Redis 配置 ─────────────────────────────────────────────────
// 生产部署时，通过 Docker / PM2 / systemd 的环境变量注入，与 Egg config 保持一致

const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? '';
const REDIS_DB = parseInt(process.env.REDIS_DB ?? '0', 10);

// ── 浏览器池参数 ──────────────────────────────────────────────────────────────

/**
 * 有头/无头模式控制：
 * - 生产和默认值：HEADLESS=true（无头，低资源，高并发）
 * - 开发调试时：设 HEADLESS=false（有头，可视化，自动降低并发）
 */
const HEADLESS = process.env.HEADLESS !== 'false'; // 默认为 true

// 有头模式下默认并发数自动降低（浏览器窗口数多会拖垮开发机）
// 可通过环境变量手动覆盖
const DEFAULT_BROWSER_COUNT = HEADLESS ? 2 : 1;
const DEFAULT_CONTEXTS_PER_BROWSER = HEADLESS ? 5 : 2;

const BROWSER_COUNT = parseInt(process.env.BROWSER_COUNT ?? String(DEFAULT_BROWSER_COUNT), 10);
const CONTEXTS_PER_BROWSER = parseInt(
  process.env.CONTEXTS_PER_BROWSER ?? String(DEFAULT_CONTEXTS_PER_BROWSER),
  10,
);
/** BullMQ 每个 Worker 并发消费数 = 总 Context 数 */
const CONCURRENCY = BROWSER_COUNT * CONTEXTS_PER_BROWSER;

if (!HEADLESS) {
  console.log(
    `[Worker] ⚠️  有头模式（HEADLESS=false）：浏览器窗口将可见，并发降低至 ${CONCURRENCY}`,
  );
}

// ── BullMQ Worker 要求 maxRetriesPerRequest: null ──────────────────────────────
const redisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || undefined,
  db: REDIS_DB,
  maxRetriesPerRequest: null as unknown as number,
};

// ── 初始化资源 ────────────────────────────────────────────────────────────────

// Session 写入用的 Redis 连接（不需要 maxRetriesPerRequest: null）
const redisForSession = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD || undefined,
  db: REDIS_DB,
  maxRetriesPerRequest: 3,
});

const pool = new BrowserPool({
  browserCount: BROWSER_COUNT,
  contextsPerBrowser: CONTEXTS_PER_BROWSER,
  headless: HEADLESS,
});

let isShuttingDown = false;

// ── 初始化 BrowserPool ────────────────────────────────────────────────────────

console.log(`[Worker] 预热浏览器池：${BROWSER_COUNT} Browser × ${CONTEXTS_PER_BROWSER} Context...`);
await pool.init();
console.log(`[Worker] 浏览器池就绪，并发消费数：${CONCURRENCY}`);

// ── 启动 BullMQ Worker ────────────────────────────────────────────────────────

const worker = new Worker<LoginJobData>(
  LOGIN_QUEUE_NAME,
  async job => {
    const { schoolId, username, password, accountType } = job.data;
    const schoolConfig = getSchoolConfig(schoolId);
    if (!schoolConfig) {
      throw new UnrecoverableError(`未知学校 ID：${schoolId}，任务不重试`);
    }

    const loginService = getLoginService(schoolId);
    const managed = await pool.acquire();

    let dirty = false;
    try {
      // 在独立 Page 中执行登录
      const page = await managed.ctx.newPage();
      let result;
      try {
        // ── Page 级图片屏蔽（按学校配置决定）──────────────────────────────────
        // blockImages 默认为 true（绝大多数学校无图形验证码）
        // 有图形验证码需要 OCR 识别的学校，在 schools.ts 中设置 blockImages: false
        const shouldBlockImages = schoolConfig.playwright.blockImages !== false;
        if (shouldBlockImages) {
          await page.route(
            url => /\.(png|jpg|jpeg|gif|webp|bmp|ico|svg)$/i.test(url.href),
            route => route.abort(),
          );
        }

        result = await loginService.login(page, username, password);
      } finally {
        await page.close().catch(() => null);
      }

      // 写入 Redis（包含 sessionId 字段，由各学校实现提取）
      const ttl = schoolConfig.cache.ttl;
      await writeSessionToRedis(
        redisForSession,
        schoolId,
        username,
        accountType,
        result.cookies,
        ttl,
        result.sessionId,
      );

      console.log(`[Worker] 登录成功 schoolId=${schoolId} username=${username} TTL=${ttl}s`);

      // returnvalue 中携带 schoolId/username，让 SessionService.getJobResult 能定位 Redis key
      return { success: true, schoolId, username, accountType, loginAt: result.loginAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] 登录失败 schoolId=${schoolId} username=${username}: ${message}`);

      // 凭据错误：明确知道是账号或密码等前端验证问题，不再重试
      // 要求各学校登录服务在识别到凭据错误时，抛出消息必须包含以下任意一个关键字
      const isCredentialError =
        message.includes('账号或密码错误') || // 标准前缀：适用于 0001/0003/0009/0052 等
        message.includes('登录过于频繁') || // 超频率账号锁定
        message.includes('账号已被锁定'); // 平台级封吏
      if (isCredentialError) {
        // UnrecoverableError 会让 BullMQ 直接将任务标记为 failed，不做任何重试
        throw new UnrecoverableError(message);
      }

      // 其他异常（超时/网络抄动/页面改版）：Context 可能损坏，标记 dirty 重建并允许 BullMQ 自动重试
      dirty = true;
      throw err;
    } finally {
      await pool.release(managed, dirty);
    }
  },
  {
    connection: redisOptions,
    concurrency: CONCURRENCY,
    /**
     * 任务锁超时（ms）：Worker 持有任务锁的最长时间。
     * 超过此时间未完成，BullMQ 认为 Worker 已崩溃，允许其他 Worker 重新领取任务。
     * 设为 75s（略大于 Playwright 单次登录超时 60s + 余量），防止 Playwright 挂死
     * 时任务永久占用并发槽位。
     */
    lockDuration: 75_000,
  },
);

worker.on('failed', (job, err) => {
  console.error(`[Worker] 任务失败 jobId=${job?.id}: ${err.message}`);
});

worker.on('error', err => {
  console.error(`[Worker] Worker 错误: ${err.message}`);
});

console.log(`[Worker] 已启动，监听队列「${LOGIN_QUEUE_NAME}」`);

// ── 优雅退出 ──────────────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker] 收到 ${signal}，开始优雅退出...`);

  // 1. 停止接收新任务，等待当前任务执行完毕
  await worker.close();
  console.log('[Worker] BullMQ Worker 已关闭');

  // 2. 关闭浏览器池
  await pool.close();
  console.log('[Worker] BrowserPool 已关闭');

  // 3. 关闭 Redis 连接
  redisForSession.disconnect();
  console.log('[Worker] Redis 连接已断开');

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
