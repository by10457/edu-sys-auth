/**
 * 登录服务注册表
 *
 * 对标 Python 版：edu-sys-crawler/app/service/spider_factory.py
 * 新增学校时，在此文件中注册即可，Worker 自动路由到对应实现。
 */

import type { SchoolLoginService } from './types.ts';
import { school0001Login } from './school_0001.ts';
import { school0003Login } from './school_0003.ts';
import { school0009Login } from './school_0009.ts';

/**
 * 学校 ID → Playwright 登录 Service 映射表
 *
 * 命名规范：school_{schoolId}Login
 * 文件规范：school_{schoolId}.ts
 *
 * 注意：只注册 playwright.enabled = true 的学校
 */
const loginRegistry: Record<string, SchoolLoginService> = {
  '0001': school0001Login, // 中南大学
  '0003': school0003Login, // 湖南师范大学
  '0009': school0009Login, // 湖南农业大学

  // ── 后续按相同模式扩展 ────────────────────────────────────
  // '0002': school0002Login, // 湖南大学

  // ...
};

/**
 * 根据学校 ID 获取对应的 Playwright 登录 Service
 * @throws {Error} 该学校尚未实现 Playwright 登录时抛出
 */
export function getLoginService(schoolId: string): SchoolLoginService {
  const service = loginRegistry[schoolId];
  if (!service) {
    throw new Error(`学校 ${schoolId} 暂未实现 Playwright 自动化登录`);
  }
  return service;
}

/** 获取所有已注册的学校 ID 列表 */
export function getRegisteredSchoolIds(): string[] {
  return Object.keys(loginRegistry);
}
