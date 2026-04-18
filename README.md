# edu-sys-auth

基于 [Egg.js](https://eggjs.org/zh-CN/) (ESM Beta) + TypeScript 构建的**教育系统认证服务**，提供用户注册、登录、Token 管理等功能，使用 Redis 管理会话与 Token 生命周期。

---

## 技术栈

| 类别 | 技术 |
|---|---|
| 运行时 | Node.js >= 22.18.0 |
| 框架 | Egg.js (beta / ESM) |
| 语言 | TypeScript 5 |
| 缓存 | Redis（ioredis 驱动） |
| 测试 | Vitest 4 + @eggjs/mock |
| Lint | oxlint（Rust 驱动，--type-aware 模式） |
| 格式化 | Prettier |

---

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发（热重载）
npm run dev
# 访问 http://localhost:7001

# 生产启动
npm run build
npm start

# 停止生产进程
npm stop
```

---

## NPM Scripts

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发，自动热重载 |
| `npm run build` | 编译 TypeScript → JavaScript |
| `npm start` | 以守护进程方式启动生产服务 |
| `npm stop` | 停止生产守护进程 |
| `npm run lint` | oxlint 代码检查（type-aware 模式） |
| `npm run lint -- --fix` | oxlint 自动修复 |
| `npm test` | 运行全量单元测试 |
| `npm run ci` | CI 模式：lint + 测试 + 覆盖率报告 |
| `npm run clean` | 清理 TypeScript 编译产物 |
| `npm run typecheck` | 仅做类型检查，不输出文件 |

---

## 目录结构

```
edu-sys-auth/
│
├── app/                              # 应用核心代码（Egg.js 约定目录）
│   ├── controller/                   # 控制器层：解析请求，调用 Service，返回响应
│   │   ├── http/                     # HTTP RESTful 接口控制器
│   │   │   └── HomeController.ts     # 根路由示例（GET /）
│   │   └── schedule/                 # 定时任务控制器（非 HTTP）
│   │       └── CleanExpiredTokenController.ts  # 每日凌晨 2 点清理过期 Token
│   │
│   ├── module/                       # Egg Tegg DI 模块（按业务领域隔离）
│   │   ├── bar/                      # bar 模块（示例：用户相关接口）
│   │   │   ├── controller/
│   │   │   │   ├── home.ts           # bar 模块首页控制器
│   │   │   │   └── user.ts           # 用户接口控制器（注册/登录等）
│   │   │   └── package.json          # 模块声明（name/eggModule 字段）
│   │   └── foo/                      # foo 模块（示例：基础服务）
│   │       ├── index.ts              # 模块入口
│   │       ├── service/
│   │       │   └── HelloService.ts   # 示例 Service
│   │       └── package.json          # 模块声明
│   │
│   ├── service/                      # 全局 Service 层（跨模块通用业务逻辑）
│   │   └── UserService.ts            # 用户查询、状态管理等公共业务方法
│   │
│   ├── middleware/                   # Koa 中间件（横切关注点）
│   │   └── ResponseTimeMiddleware.ts # 向响应头注入 X-Response-Time 耗时信息
│   │
│   ├── extend/                       # 框架对象扩展（全局注入自定义方法）
│   │   └── context.ts                # 扩展 ctx：ctx.success(data) / ctx.fail(msg)
│   │
│   ├── public/                       # 静态资源目录（由 @eggjs/static 插件托管）
│   │
│   └── typings/                      # TypeScript 类型声明扩展
│       └── redis.d.ts                # 为 app.redis 补充 ioredis 类型，使 IDE 有完整提示
│
├── config/                           # 环境配置（Egg.js 约定目录）
│   ├── plugin.ts                     # 启用的 Egg 插件声明（egg-redis、@eggjs/tracer）
│   ├── config.default.ts             # 通用默认配置（所有环境共享的基础配置）
│   ├── config.local.ts               # 本地开发覆盖配置（不提交到 Git）
│   ├── config.prod.ts                # 生产环境覆盖配置（敏感信息用环境变量注入）
│   └── config.unittest.ts            # 单元测试专用配置
│
├── test/                             # 单元测试（目录结构镜像 app/）
│   ├── setup.ts                      # 全局测试初始化（Vitest setupFiles）
│   ├── controller/
│   │   └── http/                     # HTTP 控制器测试
│   ├── middleware/                   # 中间件测试
│   └── app/
│       └── module/
│           ├── bar/controller/
│           │   ├── home.test.ts      # bar 模块首页接口测试
│           │   └── user.test.ts      # 用户接口测试
│           └── foo/service/
│               └── HelloService.test.skip.ts  # foo 模块 Service 测试（已跳过）
│
├── .vscode/                          # VSCode 工作区配置（建议提交到 Git 以统一团队开发体验）
│   ├── settings.json                 # 保存时自动格式化（Prettier）+ oxlint 自动修复
│   ├── extensions.json               # 推荐插件列表（Prettier、OXC）
│   └── launch.json                   # 调试启动配置
│
├── .prettierrc.json                  # Prettier 格式化规则（单引号、分号、100字符宽度等）
├── tsconfig.json                     # TypeScript 编译配置（继承 @eggjs/tsconfig）
├── vitest.config.ts                  # Vitest 测试配置（setupFiles、V8 覆盖率）
└── package.json                      # 项目依赖与 npm scripts
```

---

## 核心设计说明

### 配置分层策略

```
config.default.ts   ← 所有环境的基础配置（Redis 连接参数默认值等）
      ↓ 被覆盖
config.local.ts     ← 本地开发（127.0.0.1，无密码）
config.prod.ts      ← 生产环境（从 process.env 读取真实地址和密码）
config.unittest.ts  ← 测试环境（可指向 mock 或独立 Redis 实例）
```

### Redis 使用说明

- 驱动：`ioredis`（单连接多路复用，无需连接池）
- 注入方式：`app.redis`（全局单例，在 Service 中通过 `this.app.redis` 访问）
- 连接配置含指数退避重连策略，最多重试 10 次，最大等待 3 秒

### 响应格式约定

所有 HTTP 接口统一通过 `app/extend/context.ts` 中的扩展方法返回：

```typescript
// 成功
ctx.success(data)
// → { code: 0, message: 'ok', data: ... }

// 失败
ctx.fail('错误信息', 1001, 400)
// → { code: 1001, message: '错误信息', data: null }
```
