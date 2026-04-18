/**
 * LoginQueue — BullMQ 任务队列封装（生产者端）
 *
 * 负责将登录任务写入队列，供 Worker 进程消费。
 * 使用固定 jobId（login:{schoolId}:{username}）实现相同账号自动去重。
 */

import { Queue, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

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
  /** 保留最近 1000 条完成记录，便于排查 */
  removeOnComplete: { count: 1000 },
  /** 保留最近 500 条失败记录 */
  removeOnFail: { count: 500 },
};

export class LoginQueue {
  private queue: Queue<LoginJobData>;

  constructor(redisOptions: RedisOptions) {
    this.queue = new Queue<LoginJobData>(LOGIN_QUEUE_NAME, {
      connection: redisOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  /**
   * 将登录任务推入队列
   *
   * jobId 固定为 `login:{schoolId}:{username}`，BullMQ 对相同 jobId 的任务自动去重，
   * 同一账号在队列中最多存在一个待处理任务，避免并发堆积。
   */
  async enqueue(data: LoginJobData): Promise<string> {
    const jobId = `login:${data.schoolId}:${data.username}`;
    const job = await this.queue.add('do-login', data, {
      jobId,
    });
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
