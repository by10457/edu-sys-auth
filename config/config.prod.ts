import { defineConfig } from 'egg';

export default defineConfig({
  // 生产 Redis 连接必须与 edu-sys-spider 指向同一个实例和 DB。
  redis: {
    client: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD ?? '',
      db: Number.parseInt(process.env.REDIS_DB ?? '0', 10),
    },
  },
});
