import type { Context } from 'egg';

/**
 * 扩展 Egg 的 Context，添加统一响应辅助方法
 *
 * HTTP 状态码：固定 200（框架层统一），业务结果通过 body.code 区分：
 *   200  成功
 *   202  已接受，异步处理中（需轮询）
 *   400  参数错误 / 学校未实现
 *   401  账号或密码错误
 *   404  资源不存在（任务 / Session）
 *   410  Session 已过期，需重新登录
 *   500  系统 / 自动化异常
 */
export default {
  /** 成功响应：code 200 */
  success(this: Context, data: unknown, message = 'ok') {
    this.status = 200;
    this.body = { code: 200, message, data };
  },

  /** 通用失败响应：HTTP 200，code 由调用方传入 */
  fail(this: Context, message: string, code: number) {
    this.status = 200;
    this.body = { code, message, data: null };
  },
};
