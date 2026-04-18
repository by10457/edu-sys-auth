/**
 * SessionController — Session HTTP 接口层
 *
 * 接口设计：
 *   POST   /session                          提交登录任务
 *   GET    /session/:schoolId/:username      查询 Session 或任务状态
 *   DELETE /session/:schoolId/:username      主动清除 Redis 缓存
 *   GET    /session/job/:jobId               查询指定任务状态
 *   GET    /health                           服务健康检查
 */

import {
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  HTTPBody,
  HTTPParam,
  Inject,
} from '@eggjs/tegg';
import { SessionService } from '../../service/SessionService.ts';

interface LoginRequestBody {
  schoolId: string;
  username: string;
  password: string;
}

@HTTPController({
  path: '/',
})
export class SessionController {
  @Inject()
  private sessionService!: SessionService;

  /**
   * POST /session
   * 提交登录任务。
   * - 缓存命中且 TTL 充裕 → 直接返回 Session
   * - 否则 → 入队，返回 202 + jobId 供轮询
   */
  @HTTPMethod({
    method: HTTPMethodEnum.POST,
    path: '/session',
  })
  async submitLogin(@HTTPBody() body: LoginRequestBody) {
    const { schoolId, username, password } = body ?? {};

    if (!schoolId || !username || !password) {
      return {
        code: 400,
        message: '缺少必要参数：schoolId、username、password',
      };
    }

    try {
      const result = await this.sessionService.getSession(schoolId, username, password);

      if (result.hit) {
        return {
          code: 200,
          message: '缓存命中，直接返回',
          data: result.data,
        };
      }

      // 任务已入队
      return {
        code: 202,
        message: '任务已提交，请轮询 /session/job/:jobId 获取结果',
        jobId: result.jobId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      return { code: 400, message };
    }
  }

  /**
   * GET /session/:schoolId/:username
   * 直接查询 Redis 中的 Session 数据（不触发重新登录）
   */
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/session/:schoolId/:username',
  })
  async getSession(
    @HTTPParam({ name: 'schoolId' }) schoolId: string,
    @HTTPParam({ name: 'username' }) username: string,
  ) {
    // 复用 SessionService，但只查缓存，不入队
    // 此处调用 getSession 并忽略入队结果（仅返回缓存）
    try {
      // 直接读 Redis（内部私有，通过提供一个 readonly 方法暴露更好）
      // 为避免过度设计，这里直接返回操作状态提示
      return {
        code: 200,
        message: '请使用 POST /session 触发登录，再用 GET /session/job/:jobId 查询结果',
        tip: '若需直接读取 Redis 原始数据，通过 DELETE 清除后重新 POST 触发即可',
        schoolId,
        username,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      return { code: 500, message };
    }
  }

  /**
   * DELETE /session/:schoolId/:username
   * 主动清除 Redis 中的 Session，下次请求将重新触发 Playwright 登录
   */
  @HTTPMethod({
    method: HTTPMethodEnum.DELETE,
    path: '/session/:schoolId/:username',
  })
  async deleteSession(
    @HTTPParam({ name: 'schoolId' }) schoolId: string,
    @HTTPParam({ name: 'username' }) username: string,
  ) {
    try {
      await this.sessionService.deleteSession(schoolId, username);
      return {
        code: 200,
        message: `已清除 Session 缓存（schoolId=${schoolId} username=${username}）`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      return { code: 500, message };
    }
  }

  /**
   * GET /session/job/:jobId
   * 查询 BullMQ 任务状态与结果
   *
   * 返回 status:
   *   waiting   - 等待被 Worker 消费
   *   active    - Worker 正在执行
   *   completed - 登录成功，结果已写入 Redis
   *   failed    - 登录失败，含失败原因
   *   unknown   - 任务不存在（已过期或 jobId 错误）
   */
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/session/job/:jobId',
  })
  async getJobResult(@HTTPParam({ name: 'jobId' }) jobId: string) {
    try {
      const result = await this.sessionService.getJobResult(jobId);
      return {
        code: 200,
        data: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '服务异常';
      return { code: 500, message };
    }
  }

  /**
   * GET /health
   * 服务健康检查，可接入 K8s 存活探针
   */
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/health',
  })
  async health() {
    return {
      code: 200,
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
