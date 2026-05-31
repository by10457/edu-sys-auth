import { defineConfig } from 'egg';

export default defineConfig({
  // 本地开发 Redis 连接。默认值与 edu-sys-spider 保持一致，也可通过环境变量覆盖。
  redis: {
    client: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD ?? '',
      db: Number.parseInt(process.env.REDIS_DB ?? '0', 10),
    },
  },
});
