/**
 * BrowserPool — Playwright 浏览器进程池
 *
 * 设计思路：
 * - 每个 Worker 进程启动时创建固定数量的 Browser 实例（预热）
 * - 每个 Browser 下维护若干独立 BrowserContext（完全隔离的 Cookie/Storage）
 * - 任务到来时 acquire() 直接取用，无冷启动延迟
 * - Context 使用次数达上限后强制重建，防止内存泄漏
 * - Browser 崩溃时自动重建，恢复池容量
 */

import { chromium, Browser, BrowserContext, type BrowserContextOptions } from 'playwright';

/** 浏览器池配置 */
export interface BrowserPoolConfig {
  /** 每个 Worker 进程启动的 Browser 实例数，默认 2 */
  browserCount?: number;
  /** 每个 Browser 下的 BrowserContext 数量，默认 5 */
  contextsPerBrowser?: number;
  /** Context 最大使用次数，超出后强制重建，默认 50 */
  maxContextUsage?: number;
  /** acquire 等待超时（毫秒），默认 30000 */
  acquireTimeoutMs?: number;
}

interface ManagedContext {
  ctx: BrowserContext;
  usageCount: number;
  browserId: number;
}

export class BrowserPool {
  private readonly browserCount: number;
  private readonly contextsPerBrowser: number;
  private readonly maxContextUsage: number;
  private readonly acquireTimeoutMs: number;

  /** 空闲 Context 队列 */
  private idlePool: ManagedContext[] = [];
  /** 等待获取 Context 的 Promise 队列 */
  private waitQueue: Array<{ resolve: (ctx: ManagedContext) => void; reject: (err: Error) => void }> = [];
  /** browser id → Browser 实例 */
  private browsers: Map<number, Browser> = new Map();
  private nextBrowserId = 0;
  private closed = false;

  constructor(config: BrowserPoolConfig = {}) {
    this.browserCount = config.browserCount ?? 2;
    this.contextsPerBrowser = config.contextsPerBrowser ?? 5;
    this.maxContextUsage = config.maxContextUsage ?? 50;
    this.acquireTimeoutMs = config.acquireTimeoutMs ?? 30_000;
  }

  /** 启动所有 Browser 并预热 Context（进程启动时调用一次） */
  async init(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < this.browserCount; i++) {
      tasks.push(this.launchBrowser());
    }
    await Promise.all(tasks);
    console.log(
      `[BrowserPool] 初始化完成，共 ${this.browsers.size} 个 Browser，` +
        `${this.idlePool.length} 个空闲 Context`,
    );
  }

  /** 从池中获取一个空闲 Context（无空闲则等待，超时报错） */
  async acquire(): Promise<ManagedContext> {
    if (this.closed) throw new Error('[BrowserPool] 池已关闭');

    if (this.idlePool.length > 0) {
      return this.idlePool.shift()!;
    }

    // 无空闲 Context，挂起等待
    return new Promise<ManagedContext>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error('[BrowserPool] 等待空闲 Context 超时（30s），请稍后重试'));
      }, this.acquireTimeoutMs);

      this.waitQueue.push({
        resolve: (managed) => {
          clearTimeout(timer);
          resolve(managed);
        },
        reject,
      });
    });
  }

  /**
   * 归还 Context 到池中
   * @param managed - 之前 acquire() 返回的对象
   * @param dirty - true 时强制重建 Context 而非归还（登录失败/Context 异常时）
   */
  async release(managed: ManagedContext, dirty = false): Promise<void> {
    if (dirty || managed.usageCount >= this.maxContextUsage) {
      // 强制重建
      await this.rebuildContext(managed);
      return;
    }

    // 清空 Cookie，归还
    try {
      await managed.ctx.clearCookies();
    } catch {
      // Context 可能已损坏，重建
      await this.rebuildContext(managed);
      return;
    }

    this.returnToPool(managed);
  }

  /** 优雅关闭，等待所有 Browser 关闭 */
  async close(): Promise<void> {
    this.closed = true;
    // 拒绝所有等待中的请求
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('[BrowserPool] 池已关闭'));
    }
    this.waitQueue = [];
    this.idlePool = [];

    for (const browser of this.browsers.values()) {
      try {
        await browser.close();
      } catch {
        // 忽略关闭错误
      }
    }
    this.browsers.clear();
    console.log('[BrowserPool] 已关闭');
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────────

  /** 启动一个 Browser 并创建对应数量的 Context */
  private async launchBrowser(): Promise<void> {
    const id = this.nextBrowserId++;
    const browser = await chromium.launch({
      headless: true,
      args: [
        // 反检测：禁用自动化标志
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    this.browsers.set(id, browser);

    // 监听崩溃事件，自动重建
    browser.on('disconnected', () => {
      if (this.closed) return;
      console.warn(`[BrowserPool] Browser #${id} 已断开，1s 后重建...`);
      // 移除当前 Browser 下的所有 Context
      this.idlePool = this.idlePool.filter((m) => m.browserId !== id);
      this.browsers.delete(id);
      setTimeout(() => this.launchBrowser(), 1000);
    });

    // 预创建 Context
    const tasks: Promise<void>[] = [];
    for (let j = 0; j < this.contextsPerBrowser; j++) {
      tasks.push(this.createContext(id, browser));
    }
    await Promise.all(tasks);
  }

  /** 在指定 Browser 下创建一个新 Context 并加入空闲池 */
  private async createContext(browserId: number, browser: Browser): Promise<void> {
    const ctxOptions: BrowserContextOptions = {
      // 模拟真实用户环境
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      // 注入反自动化检测脚本
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    };

    const ctx = await browser.newContext(ctxOptions);

    // 覆盖 navigator.webdriver 属性（反检测）
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const managed: ManagedContext = { ctx, usageCount: 0, browserId };
    this.returnToPool(managed);
  }

  /** 重建一个 Context（替换损坏或超出次数限制的 Context） */
  private async rebuildContext(managed: ManagedContext): Promise<void> {
    try {
      await managed.ctx.close();
    } catch {
      // 忽略
    }

    const browser = this.browsers.get(managed.browserId);
    if (!browser) return; // Browser 已崩溃，等待 disconnected 回调重建

    await this.createContext(managed.browserId, browser);
  }

  /** 将 ManagedContext 放入空闲队列或唤醒等待者 */
  private returnToPool(managed: ManagedContext): void {
    managed.usageCount++;

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      waiter.resolve(managed);
    } else {
      this.idlePool.push(managed);
    }
  }
}
