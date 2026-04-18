# 高并发自动化登录服务架构说明

> 技术栈：Node.js · Playwright · BullMQ · Redis · Cluster

---

## 一、整体架构概述

本系统面向需要大量账号自动化登录、批量获取 Cookie 或 Token 的业务场景。核心目标是在高并发请求下，通过浏览器进程池 + 任务队列消费的方式，避免每次请求冷启动浏览器带来的巨大开销，同时将登录结果缓存至 Redis，实现多次请求的复用。

整体分为四层：

```
┌─────────────────────────────────────────┐
│         接入层：API Server（Express）      │
│     接收登录请求，查缓存 / 推入任务队列     │
└─────────────────────┬───────────────────┘
                      │
┌─────────────────────▼───────────────────┐
│        队列层：BullMQ 任务队列            │
│    基于 Redis 持久化，支持重试/优先级/去重  │
└──────┬──────────────┬──────────────┬────┘
       │              │              │
┌──────▼───┐   ┌──────▼───┐   ┌──────▼───┐
│ Worker#1 │   │ Worker#2 │   │ Worker#N │
│ 消费进程  │   │ 消费进程  │   │ 消费进程  │
│ 浏览器池  │   │ 浏览器池  │   │ 浏览器池  │
└──────┬───┘   └──────┬───┘   └──────┬───┘
       └──────────────┼──────────────┘
                      │
┌─────────────────────▼───────────────────┐
│           存储层：Redis                  │
│  Cookie/Token + 过期时间 TTL 写入缓存     │
└─────────────────────────────────────────┘
```

---

## 二、各模块详细说明

### 2.1 接入层：API Server

**职责**

对外暴露 HTTP 接口，作为整个系统的入口。主进程（Cluster Primary）独占运行，不参与 Playwright 操作。

**核心逻辑**

1. 收到登录请求时，先用 `accountId` 查询 Redis 是否已有有效 session。
2. 若命中缓存且距过期时间充裕（默认剩余 > 5 分钟），直接返回，**不走浏览器**。
3. 若缓存不存在或即将过期，将任务写入 BullMQ 队列，返回 `202 Accepted` 及 `jobId`，由调用方轮询结果接口。

**接口设计**

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/session` | 提交登录任务（缓存未命中则入队） |
| `GET` | `/session/:accountId` | 查询 session 结果 |
| `DELETE` | `/session/:accountId` | 主动清除缓存，强制下次重新登录 |
| `GET` | `/health` | 健康检查，可接入 K8s 探针 |

---

### 2.2 队列层：BullMQ

**选型理由**

BullMQ 基于 Redis 实现，天然持久化，进程崩溃后任务不丢失。相比内存队列，支持跨机器分布式消费，后续横向扩容无需改动代码。

**关键配置**

| 配置项 | 说明 |
|--------|------|
| `jobId` | 设置为 `login:{accountId}`，实现相同账号自动去重，防止任务堆积 |
| `attempts` | 失败后最多重试 3 次，采用指数退避策略 |
| `timeout` | 单任务超时 60 秒，防止 Playwright 挂死阻塞 Worker |
| `removeOnComplete` | 保留最近 1000 条完成记录，便于排查问题 |
| `concurrency` | 每个 Worker 进程的并发消费数 = `浏览器数 × 每浏览器 Context 数` |

**任务生命周期**

```
waiting → active → completed
                ↘ failed → (retry) → waiting
```

---

### 2.3 执行层：Worker 进程 + 浏览器进程池

这是整个架构的核心，解决高并发下冷启动问题的关键所在。

#### 2.3.1 多进程模型（Cluster）

通过 Node.js `cluster` 模块 fork 出多个 Worker 进程，每个 Worker 进程独立持有一套浏览器池并消费队列任务。

- **主进程**：运行 API Server，负责 fork 管理，监听 Worker 异常退出并自动重启。
- **Worker 进程**：运行 BullMQ Consumer + 浏览器池，与主进程完全隔离，崩溃不影响接入层。

推荐 Worker 进程数配置参考：

| 机器规格 | Worker 数 | 每 Worker 浏览器数 | 每浏览器 Context 数 | 总并发 |
|---------|----------|-----------------|-------------------|--------|
| 4 核 8G  | 2        | 2               | 5                 | 20     |
| 8 核 16G | 4        | 2               | 5                 | 40     |
| 16 核 32G| 6        | 3               | 5                 | 90     |

#### 2.3.2 浏览器进程池（BrowserPool）

**核心设计**：进程启动时预热所有 Browser，任务进来直接从池中取 Context，消除冷启动耗时（启动一个 Chromium 通常需要 1～3 秒）。

**Context 隔离机制**

每个 Browser 进程下创建多个独立的 `BrowserContext`，Context 之间 Cookie、Session Storage、Local Storage 完全隔离，互不污染。这等同于多个"不同身份的用户"在同一浏览器进程内并发操作，资源消耗远低于"每个任务启动一个浏览器"的方案。

```
Browser 进程 #1
 ├── Context A  ← 账号甲的登录操作
 ├── Context B  ← 账号乙的登录操作
 ├── Context C  ← 账号丙的登录操作
 └── ...（最多 N 个并发）
```

**Context 生命周期管理**

| 场景 | 处理方式 |
|------|--------- |
| 正常使用完毕 | 清空 Cookie，归还至空闲队列 |
| 使用次数达上限（默认 50 次） | 关闭旧 Context，重新创建，防内存泄漏 |
| 登录失败/Context 异常 | 强制重建，不归还脏 Context |
| 无空闲 Context | 请求进入等待队列（Promise），超时 30 秒后报错 |

**Browser 崩溃恢复**

监听 Browser 的 `disconnected` 事件，崩溃后自动从池中移除对应 Context，延迟 1 秒后重新 launch，恢复池容量，期间等待的任务不会丢失（由队列保证）。

---

### 2.4 存储层：Redis

Redis 承担两个职责：一是 BullMQ 的底层存储；二是 session 缓存。

**Session 数据结构**

```
Key:   session:{accountId}
Value: JSON 对象
TTL:   默认 7200 秒（2 小时），可按实际 session 有效期调整
```

JSON 对象包含以下字段：

| 字段 | 说明 |
|------|------|
| `accountId` | 账号标识 |
| `cookies` | 完整 Cookie 数组（可直接回放给 Playwright） |
| `sessionId` | 核心 Cookie 值（快速提取使用） |
| `token` | 若目标站点使用 JWT，存放 token 字符串 |
| `loginAt` | 登录时间戳 |
| `expiresAt` | 预估过期时间戳 |

**缓存刷新策略**

- 查询时检查 Redis TTL，剩余时间低于 5 分钟视为"即将过期"，主动触发重新登录。
- 新 session 写入时，TTL 设置为实际 session 有效期减去安全余量（如 10 分钟），避免取到即将失效的 session。

---

## 三、关键问题与解决方案

### 3.1 冷启动问题

**问题**：Chromium 进程启动耗时 1～3 秒，高并发下每个请求都启动会耗尽服务器资源。

**解决**：Worker 进程启动时一次性预热所有 Browser 和 Context，请求到来时直接取用，无需等待启动。队列保证任务不会因进程重启丢失。

---

### 3.2 并发隔离问题

**问题**：多个任务并发登录时，Cookie 可能相互污染。

**解决**：每个任务独占一个 `BrowserContext`，Context 之间完全隔离，任务结束后清空 Cookie 再归还，下一个任务拿到的是干净状态。

---

### 3.3 重复任务堆积问题

**问题**：同一账号短时间内收到大量登录请求，会在队列中堆积大量重复任务。

**解决**：BullMQ 任务以 `login:{accountId}` 作为固定 `jobId`，相同 jobId 的任务自动去重，队列中同一账号最多一个待处理任务。同时 API 层缓存命中时直接返回，根本不进队列。

---

### 3.4 内存泄漏问题

**问题**：Playwright 的 `BrowserContext` 长时间使用后内存占用持续增长。

**解决**：Context 设置最大使用次数（默认 50 次），达到上限后强制关闭并重建，定期清理内存。

---

### 3.5 浏览器反检测问题

**问题**：目标网站可能检测自动化浏览器特征，导致登录失败。

**建议措施**：

- 启动 Chromium 时禁用 `--enable-automation` 标志。
- 为每个 Context 设置随机 User-Agent 轮转。
- 配置合理的 `viewport`、`locale`、`timezoneId` 模拟真实用户。
- 必要时结合 `playwright-extra` 和 `puppeteer-extra-plugin-stealth` 插件。
- 敏感场景可接入代理池，为不同账号分配不同出口 IP。

---

### 3.6 优雅退出问题

**问题**：强制 kill 进程会导致正在执行中的 Playwright 任务中断，产生脏数据。

**解决**：捕获 `SIGTERM` 信号，先调用 `worker.close()` 停止接新任务，等待当前任务执行完毕，再调用 `pool.close()` 关闭所有 Browser，最后退出进程。

---

## 四、部署与扩容

### 单机部署

```
进程模型（单机）：
  主进程（API Server + Cluster Manager）× 1
  Worker 进程（Browser Pool + Queue Consumer）× N
  Redis（本地或独立节点）× 1
```

推荐通过 `PM2` 或 `systemd` 管理进程，配合 `--watch` 实现代码热重载。

### 横向扩容

BullMQ 队列存于 Redis，天然支持多机消费：

```
机器 A：API Server + Worker × 2
机器 B：Worker × 4（纯消费节点）
机器 C：Worker × 4（纯消费节点）
共用：Redis Cluster / Redis Sentinel
```

扩容时只需在新机器上启动 Worker 进程，无需修改 API Server，队列会自动分发任务。

### 性能参考指标

| 场景 | 配置 | 预估吞吐（QPS） |
|------|------|----------------|
| 基础单机 | 2 Worker × 2 Browser × 5 Context | ~20 并发登录/次 |
| 中等单机 | 4 Worker × 2 Browser × 5 Context | ~40 并发登录/次 |
| 多机集群 | 3 台机器各 4 Worker | ~120 并发登录/次 |

> 实际性能受目标网站响应速度、网络延迟、登录页面复杂度影响较大，需结合压测结果调整 Worker 数与 Context 数的比例。

---

## 五、监控与告警建议

| 监控指标 | 说明 | 告警阈值（参考） |
|---------|------|----------------|
| 队列积压深度 | BullMQ waiting 任务数 | > 500 触发告警 |
| 任务失败率 | failed / total | > 5% 触发告警 |
| 浏览器可用 Context 数 | Pool available 计数 | = 0 且持续 30s 触发告警 |
| Redis 内存占用 | `used_memory` | > 80% 容量触发告警 |
| Worker 进程存活 | 心跳检测 | 任一进程离线立即告警 |

---

## 六、目录结构参考

```
project/
├── src/
│   ├── config.js          全局配置（Browser 数、Context 数、TTL 等）
│   ├── redis.js           Redis 客户端 + session 读写封装
│   ├── browserPool.js     浏览器进程池核心（acquire/release/崩溃恢复）
│   ├── loginService.js    Playwright 登录逻辑 + Redis 缓存判断
│   ├── queue.js           BullMQ Queue 定义（生产者）
│   ├── loginWorker.js     BullMQ Worker（消费者 + 进程入口）
│   ├── server.js          Express API 路由
│   └── index.js           Cluster 入口（fork Worker 进程）
├── package.json
└── README.md
```
