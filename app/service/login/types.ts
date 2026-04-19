/**
 * 各学校 Playwright 登录 Service 公共类型定义
 */

import type { Cookie, Page } from 'playwright';

/** Playwright 登录结果 */
export interface PlaywrightLoginResult {
  /** Playwright 原始 Cookie 数组，可直接用于后续请求回放 */
  cookies: Cookie[];
  /**
   * 核心 Session Cookie 值（可选，便于调用方快速取用）
   * 各学校实现应尽量提取，常见字段：JSESSIONID、MOD_AUTH_CAS 等
   */
  sessionId?: string;
  /** 登录时间戳（ms） */
  loginAt: number;
}

/** 所有学校登录 Service 必须实现的接口 */
export interface SchoolLoginService {
  /**
   * 执行自动化登录
   * @param page - 已隔离的 Playwright Page 实例（由 BrowserPool 提供）
   * @param username - 学号/账号
   * @param password - 密码（明文，加密由各学校实现内部处理）
   * @throws {Error} 账号密码错误时抛出包含「账号或密码错误」的异常，不触发重试
   * @throws {Error} 其他异常触发重试（最多 3 次）
   */
  login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult>;
}
