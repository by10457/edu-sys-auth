/**
 * LoginQueue — BullMQ 任务队列封装（生产者端）
 *
 * 负责将登录任务写入队列，供 Worker 进程消费。
 * 使用固定 jobId（login:{schoolId}:{username}）实现相同账号自动去重。
 */

import { Queue, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

/** LoginQueue 的 Redis 连接配置（与 ioredis RedisOptions 兼容） */
export type LoginQueueConfig = RedisOptions;

/** 登录任务的数据结构 */
export interface LoginJobData {
  schoolId: string;
  username: string;
  password: string;
}

/** BullMQ 队列名称 */
export const LOGIN_QUEUE_NAME = 'edu-login';

/** 默认任务配置 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  /** 失败后最多重试 3 次，指数退避 */
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  /**
   * 任务超时控制：在 Worker 侧通过 lockDuration 实现
   * BullMQ v5 已将 timeout 从 JobsOptions 移除，改在 Worker 构造函数中配置。
   * 参见 loginWorker.ts 中的 lockDuration 设置。
   */
  /** 保留最近 1000 条完成记录，便于排查 */
  removeOnComplete: { count: 1000 },
  /** 保留最近 500 条失败记录 */
  removeOnFail: { count: 500 },
};

export class LoginQueue {
  private queue: Queue<LoginJobData>;

  constructor(redisOptions: RedisOptions) {
    // BullMQ 要求 Queue 和 Worker 的 Redis 连接都必须设置 maxRetriesPerRequest: null
    // 否则 ioredis 超时后会抛 MaxRetriesPerRequestError 导致任务写入失败
    // 这里强制覆盖，不依赖外部传入的 Egg Redis 配置值
    const connection: RedisOptions = {
      ...redisOptions,
      maxRetriesPerRequest: null as unknown as number,
    };
    this.queue = new Queue<LoginJobData>(LOGIN_QUEUE_NAME, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  /**
   * 将登录任务推入队列
   *
   * 去重策略：
   * - 若同账号任务处于 waiting/active → 直接复用 jobId（防并发堆积）
   * - 若同账号任务已 completed/failed → 先删除旧 Job，再重新入队
   *   原因：BullMQ 对固定 jobId 的去重基于 Redis hash key 是否存在，
   *   completed 任务的 hash key 会因 removeOnComplete 持续保留，
   *   若不先删除，后续调用 queue.add() 会直接返回旧 Job 而不入队。
   */
  async enqueue(data: LoginJobData): Promise<string> {
    const jobId = `login:${data.schoolId}:${data.username}`;

    // 检查是否有同 ID 的历史 Job
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'waiting' || state === 'active') {
        // 正在排队或执行中 → 直接复用，无需重复入队
        return jobId;
      }
      // completed / failed / unknown → 清理旧记录，腾出 ID 给新 Job
      await existingJob.remove();
    }

    const job = await this.queue.add('do-login', data, { jobId });
    return job.id!;
  }

  /**
   * 查询任务当前状态和结果
   */
  async getJobResult(jobId: string): Promise<{
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
    result?: unknown;
    failReason?: string;
  }> {
    const job = await this.queue.getJob(jobId);
    if (!job) return { status: 'unknown' };

    const state = await job.getState();

    if (state === 'completed') {
      return { status: 'completed', result: job.returnvalue };
    }
    if (state === 'failed') {
      return { status: 'failed', failReason: job.failedReason };
    }
    if (state === 'active') {
      return { status: 'active' };
    }
    return { status: 'waiting' };
  }

  /** 关闭队列连接 */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
