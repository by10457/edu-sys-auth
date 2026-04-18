import type { EggContext, Next } from 'egg';

/**
 * 响应时间中间件 —— 在响应头中注入 X-Response-Time
 */
export default async function ResponseTimeMiddleware(ctx: EggContext, next: Next) {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  ctx.set('X-Response-Time', `${duration}ms`);
}
