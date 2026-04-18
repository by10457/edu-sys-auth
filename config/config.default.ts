import { defineConfigFactory, type PartialEggConfig } from 'egg';

export default defineConfigFactory((appInfo) => {
  const config = {
    // use for cookie sign key, should change to your own and keep security
    keys: appInfo.name + '_{{keys}}',

    // add your egg config in here
    middleware: [] as string[],

    // change multipart mode to file
    // @see https://github.com/eggjs/multipart/blob/master/src/config/config.default.ts#L104
    multipart: {
      mode: 'file' as const,
    },

    // Redis 配置（具体连接参数在 config.local.ts / config.prod.ts 中覆盖）
    redis: {
      client: {
        host: '127.0.0.1',
        port: 6379,
        password: '',
        db: 0,

        // ── 连接超时控制 ──────────────────────────────
        // 建立 TCP 连接的超时时间（ms），超时后触发重连
        connectTimeout: 3000,

        // ── 命令队列控制（防止高并发下无限积压）────────
        // 单个连接上最大排队命令数，超出后新命令直接报错而非无限等待
        // ioredis 默认无限制，生产环境务必设置
        maxRetriesPerRequest: 3,

        // ── 离线队列（连接断开期间的请求处理）──────────
        // true：断连期间命令进入队列等待重连（适合短暂抖动）
        // false：断连期间命令立即报错（适合对延迟敏感的场景）
        enableOfflineQueue: true,

        // ── 自动重连策略 ──────────────────────────────
        // 返回重连等待时间（ms），retryTimes 为已重试次数
        // 指数退避：100ms → 200ms → 400ms，最长 3s，超 10 次放弃
        retryStrategy: (retryTimes: number) => {
          if (retryTimes > 10) return null; // null = 停止重连，抛出错误
          return Math.min(100 * 2 ** retryTimes, 3000);
        },
      },
    },
  } as PartialEggConfig;

  // add your special config in here
  // Usage: `app.config.bizConfig.sourceUrl`
  const bizConfig = {
    sourceUrl: `https://github.com/eggjs/examples/tree/master/${appInfo.name}`,
  };

  // the return config will combines to EggAppConfig
  return {
    ...config,
    bizConfig,
  };
});
