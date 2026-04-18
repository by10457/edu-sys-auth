import type { Context } from 'egg';

/**
 * 扩展 Egg 的 Context，添加自定义辅助方法
 * 使用方式: ctx.success({ data })
 */
export default {
  /**
   * 统一成功响应格式
   */
  success(this: Context, data: unknown, message = 'ok') {
    this.body = { code: 0, message, data };
    this.status = 200;
  },

  /**
   * 统一失败响应格式
   */
  fail(this: Context, message: string, code = 1, status = 400) {
    this.body = { code, message, data: null };
    this.status = status;
  },
};
