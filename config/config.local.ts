import { defineConfig } from 'egg';

export default defineConfig({
  // 本地开发 Redis 连接（覆盖 config.default.ts）
  redis: {
    client: {
      host: '127.0.0.1',
      port: 6379,
      password: '',
      db: 0,
    },
  },
});
