# edu-sys-auth

基于 [Egg.js](https://eggjs.org/zh-CN/) (ESM Beta) + TypeScript 构建的**教务系统 Playwright 自动化登录服务**。

核心能力：通过 Playwright 驱动真实浏览器模拟学生登录各高校教务系统，自动获取会话 Cookie，以高并发、可复用的方式供爬虫服务调用。

---

## 技术栈

| 类别 | 技术 |
|---|---|
| 运行时 | Node.js >= 22.18.0 |
| 框架 | Egg.js (beta / ESM) |
| 语言 | TypeScript 5 |
| 自动化浏览器 | Playwright + Chromium |
| 任务队列 | BullMQ（基于 Redis >= 5.0） |
| 缓存 | Redis（ioredis 驱动） |
| Lint | oxlint（Rust 驱动，--type-aware 模式） |
| 格式化 | Prettier |

---

## 架构概述

```
HTTP 接口层（Egg.js）           Worker 进程（独立子进程）
  POST /session/login    →    BullMQ 任务队列（Redis 持久化）
  GET  /session/job/:id  ←         ↓
                               BrowserPool（Playwright）
                                    ↓
                               各学校登录 Service
                                    ↓
                               Redis 写入 Session（TTL 30分钟）
```

- **API 进程**（Egg.js）：接收请求，查 Redis 缓存，缓存命中直返；未命中写入 BullMQ 队列，返回 jobId
- **Worker 进程**（独立 Node.js）：预热 Playwright 浏览器池，并发消费队列，将 Cookie 写入 Redis
- **Redis**：同时承担 BullMQ 存储 + Session 缓存，两个进程共用同一实例

---

## 快速开始

### 前置要求

- Node.js >= 22.18.0
- Redis >= 5.0（BullMQ 要求，推荐 Redis 7）
- 复制环境变量文件：

```bash
cp .env.example .env
# 然后按实际情况修改 .env
```

### 安装与启动

```bash
# 安装依赖
npm install

# 安装 Playwright Chromium 浏览器
npx playwright install chromium

# 方式一：两个终端分开启动（日志更清晰）
# 终端 1：API 服务（热重载）
npm run dev

# 终端 2：BullMQ Worker（Playwright 浏览器池）
npm run worker:dev

# 方式二：一条命令同时启动两个进程
npm run dev:all
```

> ⚠️ **两个进程必须同时运行**，缺少 Worker 时登录任务会持续排队而不被消费。

---

## NPM Scripts

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发，API 服务热重载 |
| `npm run worker:dev` | 本地开发，启动 Playwright Worker 进程（读取 `.env`） |
| `npm run dev:all` | 同时启动 API 和 Worker（使用 concurrently） |
| `npm run build` | 编译 TypeScript → JavaScript（生产用） |
| `npm start` | 以守护进程方式启动生产 API 服务 |
| `npm stop` | 停止生产守护进程 |
| `npm run lint` | oxlint 代码检查 |
| `npm run clean` | 清理 TypeScript 编译产物 |

---

## HTTP 接口

所有响应体格式统一：

```json
{ "code": 0, "message": "ok", "data": { ... } }
```

| code | 含义 |
|------|------|
| `0`  | 成功 |
| `1`  | 异步处理中（等待 Worker 执行） |
| `2`  | 任务失败（登录失败） |
| `-1` | 参数错误 / 资源不存在 / 服务异常 |

---

### POST `/session/login`

提交自动化登录任务，支持 `force` 强制刷新。

- 缓存命中且 TTL 充裕 → **同步返回** Session（`code: 0`）
- 缓存未命中 / `force: true` → 入队，**异步执行**，返回 `jobId`（`code: 1`），调用方轮询结果

**请求体：**

```json
{
  "cid": "0001",
  "sid": "8303221115",
  "pwd": "your_password",
  "force": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cid` | string | ✅ | 学校 ID（见学校列表） |
| `sid` | string | ✅ | 学号 |
| `pwd` | string | ✅ | 密码（明文，传输请走 HTTPS） |
| `force` | boolean | ❌ | 默认 `false`；为 `true` 时跳过缓存，强制重新登录 |

**响应示例（缓存命中，直接返回）：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "schoolId": "0001",
    "username": "8303221115",
    "cookies": [ { "name": "JSESSIONID", "value": "...", "domain": "..." } ],
    "sessionId": "TGT-XXXXX",
    "loginAt": 1713400000000,
    "expiresAt": 1713401800000
  }
}
```

**响应示例（缓存未命中，异步处理）：**

```json
{
  "code": 1,
  "message": "登录任务已提交，请轮询 GET /session/job/:jobId 获取结果",
  "data": { "jobId": "login:0001:8303221115" }
}
```

---

### GET `/session/job/:jobId`

轮询 BullMQ 任务状态。**任务完成时直接返回 Session 数据**，无需再调用 query 接口。

| 状态 | code | 说明 |
|------|------|------|
| completed | 0 | 登录成功，`data` 为 Session 数据 |
| waiting / active | 1 | 排队中或执行中 |
| failed | 2 | 登录失败，`message` 含失败原因 |
| unknown | -1 | 任务不存在（已过期或 jobId 有误） |

```
GET /session/job/login:0001:8303221115
```

> 建议轮询间隔 2 秒，超时时间 60 秒（登录通常在 5~10 秒内完成）。

---

### POST `/session/query`

直接读取 Redis 中已有的 Session，不触发重新登录。

```json
{ "cid": "0001", "sid": "8303221115" }
```

---

### POST `/session/delete`

清除 Redis 中的 Session 缓存。下次调用 `/session/login` 将重新入队登录。

```json
{ "cid": "0001", "sid": "8303221115" }
```

---

### GET `/health`

健康检查，验证 Redis 连通性。

```json
{
  "code": 0,
  "message": "ok",
  "data": { "redis": true, "timestamp": "2024-04-18T10:00:00.000Z" }
}
```

---

## 推荐调用流程（爬虫项目）

```
第一次请求（正常流程）
  │
  ├─ POST /session/login { cid, sid, pwd }
  │     ↓ code: 0 → 直接使用 data.cookies 发请求
  │     ↓ code: 1 → 拿到 jobId
  │           ↓
  │     轮询 GET /session/job/:jobId（间隔 2s）
  │           ↓ code: 0 → 使用 data.cookies 发请求
  │           ↓ code: 1 → 继续等待
  │           ↓ code: 2 → 登录失败，提示用户检查账号密码

发现 Cookie 已失效（目标服务器返回 401/302）
  │
  └─ POST /session/login { cid, sid, pwd, force: true }
        ↓ 自动清除旧缓存，直接触发 Playwright 重新登录
        ↓ 返回 jobId → 轮询拿新 Cookie → 重试请求
```

---

## 目录结构

```
edu-sys-auth/
│
├── app/
│   ├── config/
│   │   └── schools.ts                    # 学校配置（学校ID、baseUrl、缓存TTL、blockImages等）
│   │
│   ├── controller/http/
│   │   ├── HomeController.ts             # GET /
│   │   └── SessionController.ts         # Session 接口（login/query/delete/job/health）
│   │
│   ├── lib/
│   │   ├── BrowserPool.ts               # Playwright 浏览器进程池（预热/隔离/崩溃重建/资源屏蔽）
│   │   ├── LoginQueue.ts                # BullMQ 队列封装（生产者，含去重/重试配置）
│   │   └── SessionStore.ts              # Redis Session 读写工具（纯函数，Worker/API 共用）
│   │
│   ├── service/
│   │   ├── SessionService.ts            # Session 核心业务（Redis读写/入队/健康检查）
│   │   └── login/
│   │       ├── types.ts                 # SchoolLoginService 接口定义
│   │       ├── registry.ts              # 学校登录服务注册表
│   │       └── school_0001.ts           # 中南大学 Playwright 登录实现
│   │
│   ├── worker/
│   │   └── loginWorker.ts               # BullMQ Worker 独立进程入口
│   │
│   └── extend/
│       └── context.ts                   # ctx.success / ctx.fail 响应辅助方法
│
├── config/
│   ├── config.default.ts                # 通用配置（Redis 连接、CSRF 白名单、重连策略）
│   ├── config.local.ts                  # 本地开发配置
│   └── config.prod.ts                   # 生产配置（环境变量注入）
│
├── .env                                 # Worker 环境变量（不提交 git）
├── .env.example                         # 环境变量模板（提交 git）
├── tsconfig.json
└── package.json
```

---

## 学校支持列表

学校配置位于 `app/config/schools.ts`，已预置 40+ 所高校的基础配置。

目前已实现 Playwright 自动化登录的学校：

| 学校 ID | 学校名称 | 状态 |
|---------|---------|------|
| 0001 | 中南大学 | ✅ 已实现 |

其余学校的 `playwright.enabled` 为 `false`，调用时会返回 400 错误提示。

**扩展新学校只需三步：**

1. 在 `app/service/login/` 新建 `school_{id}.ts`，实现 `SchoolLoginService` 接口
2. 在 `registry.ts` 注册映射关系
3. 在 `schools.ts` 对应学校设置 `playwright.enabled: true`；若该学校有图形验证码，额外设置 `blockImages: false`

---

## Redis Session 数据结构

```
Key:   session:{cid}:{sid}
TTL:   默认 1800 秒（30 分钟），各学校可在 schools.ts 单独配置
```

> TTL 策略：保守设置（短于目标学校 Session 实际有效期），配合爬虫项目的"遇 401 主动 force 刷新"机制，保证 Cookie 始终有效。

```json
{
  "schoolId": "0001",
  "username": "8303221115",
  "cookies": [ { "name": "JSESSIONID", "value": "...", "domain": "..." } ],
  "sessionId": "关键Cookie值（快速取用）",
  "loginAt": 1713400000000,
  "expiresAt": 1713401800000
}
```

---

## Worker 环境变量（`.env`）

Worker 进程独立于 Egg.js，通过 `node --env-file=.env` 读取配置。**务必与 Egg.js 的 Redis 配置指向同一实例。**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | `""` | Redis 密码（无则留空） |
| `REDIS_DB` | `0` | Redis 数据库索引 |
| `BROWSER_COUNT` | `2` | 每个 Worker 启动的 Browser 进程数 |
| `CONTEXTS_PER_BROWSER` | `5` | 每个 Browser 的并发 Context 数 |

**总并发数 = `BROWSER_COUNT × CONTEXTS_PER_BROWSER`**（默认 10）

**生产服务器推荐配置（62GB/56核）：**

```ini
BROWSER_COUNT=8
CONTEXTS_PER_BROWSER=10
# → 80 并发，内存约 3.6GB
```

> 多进程扩展：可同时运行多个 `worker:dev` 进程，BullMQ 自动在各进程间分配任务，不会重复消费。

---

## 资源屏蔽策略

为加快 Playwright 登录速度，BrowserPool 默认拦截以下请求：

| 屏蔽类型 | 说明 |
|---------|------|
| 字体文件（`.woff .ttf .otf`） | 登录流程不依赖字体 |
| 媒体文件（`.mp4 .mp3` 等） | 登录页无音视频 |
| 第三方埋点（Google Analytics、百度统计等） | 不影响登录 |
| 图片（`.png .jpg .gif` 等） | **默认屏蔽**，有图形验证码的学校设 `blockImages: false` 关闭 |

在 `schools.ts` 中控制图片屏蔽行为：

```typescript
// 有图形验证码（需 OCR 识别）的学校
playwright: { enabled: true, blockImages: false }

// 无图形验证码的学校（默认，性能更好）
playwright: { enabled: true, blockImages: true }
```
