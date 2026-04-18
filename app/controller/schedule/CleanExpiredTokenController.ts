import { SingletonProto } from '@eggjs/tegg';
import { Schedule } from 'egg/schedule';
import type { ScheduleSubscriber } from '@eggjs/tegg-types';

/**
 * 定时任务：每天凌晨 2 点执行，清理过期 token
 * 参见: https://eggjs.org/zh-CN/basics/schedule
 */
@Schedule(
  {
    type: 'worker', // 只让一个 worker 执行
    scheduleData: {
      cron: '0 2 * * *',
    },
  },
)
@SingletonProto()
export class CleanExpiredTokenController implements ScheduleSubscriber {
  async subscribe() {
    // TODO: 清理过期 token 逻辑
    console.info('[CleanExpiredToken] task started');
  }
}

