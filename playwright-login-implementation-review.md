# Playwright 登录架构实现评估

## 1. 评估结论

当前仓库已经具备了 **Playwright + BullMQ + Redis** 这条链路的基础雏形，但整体状态更接近：

- **核心能力已开始落地**
- **关键接口契约尚未闭环**
- **运行与部署方式还不够工程化**
- **测试、类型校验、文档同步明显不足**

如果按 `playwright-login-arch.md` 的目标来评估，当前项目可以认为是 **“部分实现，可用于继续开发验证，但还不适合直接作为完整生产方案交付”**。

---

## 2. 本次核对范围

### 2.1 对照文档

- `playwright-login-arch.md`

### 2.2 核对的核心实现文件

- `app/controller/http/SessionController.ts`
- `app/service/SessionService.ts`
- `app/lib/LoginQueue.ts`
- `app/lib/BrowserPool.ts`
- `app/worker/loginWorker.ts`
- `app/service/login/registry.ts`
- `app/service/login/school_0001.ts`
- `app/config/schools.ts`
- `config/config.default.ts`
- `config/config.local.ts`
- `config/config.prod.ts`
- `config/config.unittest.ts`
- `package.json`
- `README.md`

### 2.3 实际验证结果

- `npm run lint`：通过
- `npm run build`：通过
- `npm run typecheck`：失败，原因是 `tsgo` 命令不存在
- `npm test`：失败，原因是没有任何测试文件

---

## 3. 架构实现状态对照

| 模块 | 文档目标 | 当前状态 | 结论 |
|---|---|---|---|
| API 接入层 | `POST /session`、`GET /session/:accountId`、`DELETE /session/:accountId`、`GET /health` | `POST /session`、`DELETE`、`GET /health` 已有雏形；`GET /session/:schoolId/:username` 只是提示文案，不会真正读 Redis | **部分实现** |
| 异步任务查询 | 调用方轮询结果接口拿到登录结果 | 提供了 `GET /session/job/:jobId`，但只能看到任务状态，不返回 session 数据 | **部分实现** |
| BullMQ 队列 | 固定 jobId 去重、重试、超时、完成记录保留 | 去重 / 重试 / 结果查询已做；任务级 `timeout` 未配置 | **部分实现** |
| Worker + BrowserPool | 预热 Browser / Context、并发消费、崩溃恢复、优雅退出 | 预热、并发、优雅退出已做；真正的多进程 cluster 管理未接入主服务 | **部分实现** |
| Context 隔离 | 每个任务独占 Context，使用后回收为“干净状态” | 只清了 Cookie，没有清理 LocalStorage / SessionStorage / IndexedDB / Service Worker | **实现不完整** |
| Redis Session 缓存 | 存 cookies / token / sessionId / loginAt / expiresAt | 只存了 `cookies`、`loginAt`、`expiresAt`，没有 `token` / `sessionId` | **部分实现** |
| 学校登录实现 | 支持按学校注册扩展 | 注册表机制已做，但当前只有 `0001` 一个学校实现 | **部分实现** |
| Cluster 模型 | 主进程 fork Worker 并自动拉起 | 仓库里没有 cluster 入口，也没有自动拉起 Worker 的主流程 | **未实现** |
| 生产配置 | API / Worker / Redis 配置可统一管理 | API 走 Egg 配置，Worker 走环境变量，`config.prod.ts` 还是空的 | **明显欠缺** |
| 监控告警 | health / queue / worker / redis 维度可观测 | 只有一个非常浅的 `/health`，没有 Redis / Worker / Queue 的真实检查 | **未实现** |
| 测试保障 | 至少有关键链路测试 | 当前没有登录链路测试 | **未实现** |

---

## 4. 关键问题与风险

下面这些问题里，前 5 项建议按高优先级处理。

### 4.1 异步登录链路没有真正“闭环”

**问题**

当前异步链路是这样的：

1. `POST /session` 未命中缓存时返回 `jobId`
2. 客户端被提示去轮询 `GET /session/job/:jobId`
3. 但 `GET /session/job/:jobId` 只返回任务状态
4. 真正应该拿 session 的 `GET /session/:schoolId/:username` 又没有实现

也就是说，**文档里承诺的“提交任务 -> 轮询结果 -> 拿到 session”这条链路在当前 API 上并没有打通**。

**证据**

- `app/controller/http/SessionController.ts:67`
- `app/controller/http/SessionController.ts:79`
- `app/controller/http/SessionController.ts:147`

**影响**

- API 契约和文档不一致
- 调用方必须猜测下一步怎么拿 session
- 当前最像“可用路径”的方式反而是：再次调用 `POST /session`，等缓存命中后返回 session，这不直观也不稳定

**建议**

二选一，最好尽快定下来：

1. **实现真正的 `GET /session/:schoolId/:username`**，直接读取 Redis 并返回 session
2. 或者把 `GET /session/job/:jobId` 改成在任务完成时直接返回 session 数据

---

### 4.2 返回体里写了 `code: 202/400/500`，但 HTTP 状态码大概率仍然是 200

**问题**

`SessionController` 里所有接口都是直接 `return { code: xxx }`，没有设置 `ctx.status`。  
而项目里虽然写了 `ctx.success/ctx.fail` 辅助方法，但控制器没有使用。

**证据**

- `app/controller/http/SessionController.ts:48`
- `app/controller/http/SessionController.ts:67`
- `app/controller/http/SessionController.ts:72`
- `app/extend/context.ts:11`
- `app/extend/context.ts:19`

**影响**

- 文档里说的 `202 Accepted` 实际上不会生效
- 参数错误、业务错误、服务异常都可能被外部网关/调用方当成 200 成功
- 健康检查和监控难以准确判断失败

**建议**

- 统一改成真正设置 HTTP status
- 如果继续保留 `code` 字段，也建议明确区分“HTTP 状态”和“业务状态”

---

### 4.3 API 进程和 Worker 进程没有真正接起来

**问题**

文档设计是“主进程管理 API + fork Worker”，但当前仓库里：

- `npm start` 只启动 Egg 应用
- Worker 需要手动执行 `npm run worker:dev`
- 仓库中没有 cluster 入口，也没有主进程自动拉起 Worker 的代码

**证据**

- `package.json:17`
- `package.json:20`
- `package.json:21`
- `app/worker/loginWorker.ts:14`

**影响**

- 只启动 API 时，任务会入队但不会被消费
- `/health` 也看不出 Worker 没启动
- 生产部署时必须额外记住再起一个独立进程，运维复杂度高

**建议**

- 至少补齐一种明确方案：
  - 方案 A：做真正的 cluster / process-manager 启动入口
  - 方案 B：明确拆成 `api` 和 `worker` 两个独立服务，并补齐部署文档、健康检查和环境变量规范

---

### 4.4 配置源分裂，API 和 Worker 很容易连到不同 Redis

**问题**

当前系统有两套配置来源：

- API 侧通过 Egg 配置读取 Redis：`config.default.ts` / `config.local.ts`
- Worker 侧直接读取环境变量：`REDIS_HOST` / `REDIS_PORT` / `REDIS_DB`

与此同时：

- `config.prod.ts` 是空的
- README 又写成“生产环境从环境变量读取真实地址和密码”，但实际没有实现

**证据**

- `app/service/SessionService.ts:58`
- `app/worker/loginWorker.ts:28`
- `config/config.default.ts:17`
- `config/config.local.ts:4`
- `config/config.prod.ts:1`
- `README.md:131`

**影响**

- 很容易出现 API 和 Worker 指向不同 Redis
- 会出现“API 能写队列 / 查缓存，但 Worker 看不到”或反过来的问题
- 这类问题排查成本很高，而且现象会很诡异

**建议**

- 统一 Redis 配置来源，至少做到：
  - API 和 Worker 共用同一套配置模型
  - 本地 / 测试 / 生产配置行为一致
  - README 写法和真实代码一致

---

### 4.5 BrowserContext 回收时只清 Cookie，隔离承诺不成立

**问题**

文档和注释里都强调了 Context 之间完全隔离、任务结束后归还“干净状态”。  
但当前 `release()` 逻辑只执行了 `clearCookies()`。

**证据**

- `app/lib/BrowserPool.ts:105`

**影响**

- 如果目标站点把 token 放在 `localStorage` / `sessionStorage` / `IndexedDB`
- 或注册了 `Service Worker`
- 那么下一个账号复用这个 Context 时，仍有可能继承前一个账号的站点状态

这会直接影响：

- 账号隔离
- 登录正确性
- 排查难度

**建议**

- 最稳妥：**一个任务一个新 Context，用后直接关闭重建**
- 如果一定要池化复用 Context，就必须补上更完整的“清场”策略，而不是只清 Cookie

---

### 4.6 缓存命中和任务去重都只按 `schoolId + username`，存在安全与业务歧义

**问题**

当前缓存 key 和 BullMQ `jobId` 都不包含密码：

- Session key：`session:{schoolId}:{username}`
- Job key：`login:{schoolId}:{username}`

**证据**

- `app/service/SessionService.ts:40`
- `app/lib/LoginQueue.ts:52`

**影响**

有两个隐藏问题：

1. **缓存命中时不会校验当前提交的密码**
   - 只要该用户名已有有效缓存，哪怕本次传的是错误密码，也会直接返回 session
   - 如果这是一个纯内部可信服务，也许可以接受
   - 但如果它面向外部调用，这会成为安全风险

2. **同账号短时间内改密码重试时，队列可能继续处理旧密码**
   - 因为固定 jobId 会触发去重
   - 新请求未必真的生成新任务
   - 这样调用方会以为“新密码已提交”，实际处理的可能还是旧任务

**建议**

- 需要先明确这个服务的边界：
  - 它是不是只给可信内部系统用
  - 是否允许“只凭用户名拿缓存 session”
- 如果不是强信任内网服务，建议重新设计缓存和 job 去重策略

---

## 5. 其他欠缺与不合理点

### 5.1 文档要求的任务超时没有实现

文档里建议每个任务 `timeout = 60s`，但 `LoginQueue` 默认配置里并没有设置 `timeout`。

**证据**

- `playwright-login-arch.md`
- `app/lib/LoginQueue.ts:21`

**影响**

- 某些 Playwright 场景如果挂住，任务可能长时间占用 Worker 并拖垮并发能力

---

### 5.2 Session 数据结构比文档弱很多

文档里期望 Redis 里至少包含：

- `cookies`
- `sessionId`
- `token`
- `loginAt`
- `expiresAt`

当前只有：

- `schoolId`
- `username`
- `cookies`
- `loginAt`
- `expiresAt`

**证据**

- `app/service/SessionService.ts:18`

**影响**

- 后续调用方如果只想快速拿 `sessionId` / `token`，还得自行解析 cookies
- 与文档契约不一致

---

### 5.3 `writeSession()` 的 `expiresAt` 计算有边界问题

当前逻辑是：

- Redis TTL 直接用 `ttlSeconds`
- `expiresAt = now + (ttlSeconds - 600) * 1000`

**证据**

- `app/service/SessionService.ts:121`

**问题**

- 如果某个学校未来把 TTL 配成小于 600 秒，`expiresAt` 会直接落到过去
- 另外它没有使用登录实现返回的 `result.loginAt`

**建议**

- 对安全余量做 `Math.max()` 下限保护
- 明确 `loginAt` 应该以 Worker 记录为准还是以学校返回为准

---

### 5.4 浏览器池参数可配项太少，硬编码较多

当前只支持通过环境变量配置：

- `BROWSER_COUNT`
- `CONTEXTS_PER_BROWSER`
- Redis 连接

但以下行为仍是硬编码：

- `maxContextUsage = 50`
- `acquireTimeoutMs = 30000`
- 固定 `userAgent`
- 固定 `timezoneId = Asia/Shanghai`
- 固定 `viewport`
- 固定 `--no-sandbox`

**证据**

- `app/lib/BrowserPool.ts:47`
- `app/lib/BrowserPool.ts:176`
- `app/lib/BrowserPool.ts:143`
- `app/worker/loginWorker.ts:33`

**影响**

- 不同学校、不同部署环境下很难做精细调优
- 线上排障时只能改代码，不能改配置

---

### 5.5 学校扩展机制有了，但当前只落地了一个学校

注册表和目录结构设计是合理的，但现在只有 `0001` 被注册。

**证据**

- `app/service/login/registry.ts:19`
- `app/config/schools.ts:44`

**影响**

- 大部分学校配置只是“占位数据”
- 如果 README 或产品侧把这些学校视为“已支持”，会造成误判

---

### 5.6 `GET /health` 太浅，无法体现真实服务状态

当前健康检查只返回一个固定 `ok + timestamp`，不会检查：

- Redis 是否连通
- 队列是否可用
- Worker 是否在线
- 浏览器池是否初始化成功

**证据**

- `app/controller/http/SessionController.ts:160`

**影响**

- K8s / PM2 / 外部探针会认为服务正常
- 但实际上可能出现“API 活着，Worker 全挂了”的假健康状态

---

### 5.7 README 与当前项目实际情况明显不一致

README 里还有不少模板或旧项目内容，包括：

- 目录结构里出现了不存在的 `app/module/bar`、`foo`、大量测试文件
- 项目描述仍然是“用户注册、登录、Token 管理”
- 没有写 Worker 启动方式，也没写 Playwright 登录链路

**证据**

- `README.md:3`
- `README.md:58`

**影响**

- 新同学会被误导
- 运维或测试可能按 README 启动后发现任务不消费

---

### 5.8 `typecheck`、`test`、CI 链路现在不能算可用

**现状**

- `npm run typecheck` 失败：`tsgo` 命令不存在
- `npm test` 失败：没有测试文件

**证据**

- `package.json:29`
- `vitest.config.ts:1`
- `test/` 目录当前没有对应测试文件

**影响**

- 现在的“工程质量保障”主要靠人工读代码和 `lint`
- 登录链路、队列行为、Redis 缓存、浏览器池行为都没有回归保护

---

### 5.9 `package.json` 仍有明显模板残留

包括但不限于：

- `description: "Hello Egg.js"`
- `homepage` / `bugs` / `repository` / `author` 仍是占位符

**证据**

- `package.json:4`
- `package.json:5`
- `package.json:10`
- `package.json:13`

**影响**

- 项目成熟度观感较弱
- 发布、归档、协作都不够规范

---

### 5.10 `postci` 对 Windows 不友好

`postci` 里用了 `sleep 10`，这在 Windows 的 npm script 默认环境下通常不可用。

**证据**

- `package.json:27`

**影响**

- 本地是 Windows 时，完整 CI 脚本不一定能顺利跑通

---

## 6. 我对当前代码结构的整体评价

### 6.1 做得比较好的地方

- `SessionService`、`LoginQueue`、`BrowserPool`、`loginWorker` 的职责边界总体是清楚的
- 学校登录逻辑拆成 `registry + school_xxxx.ts`，这个扩展方式是对的
- BrowserPool 已经有预热、等待队列、崩溃重建、优雅退出这些关键雏形
- Worker 中把“账号密码错误”区分成 `UnrecoverableError`，这个思路是合理的

### 6.2 当前最主要的问题不是“写不出来”，而是“还没收口”

更准确地说，代码目前的问题不是底层思路错了，而是：

- **对外契约没闭环**
- **运行部署没收口**
- **配置没有单一事实来源**
- **测试和文档没有跟上**

这类问题在项目早期很常见，但如果继续往后堆功能，不先补这些基础面，后面会越来越难改。

---

## 7. 建议的整改优先级

### P0：必须先补

1. 打通异步接口闭环
   - 让调用方可以通过一个明确接口拿到最终 session
2. 统一 HTTP 状态码和响应协议
   - 不要只在 body 里写 `code`
3. 统一 API / Worker 的配置来源
   - 尤其是 Redis 配置和运行模式
4. 明确 Worker 启动模型
   - 真 cluster，或显式拆成两个服务
5. 明确缓存 / job 去重的安全边界
   - 只按用户名命中缓存是否可接受

### P1：建议尽快补

1. 修正 BrowserContext 回收策略
2. 补上任务级 timeout
3. 扩展 Session 数据结构
4. 把 `/health` 升级成真实健康检查

### P2：工程化完善

1. 补测试
2. 修 `typecheck`
3. 清理 README / package 模板残留
4. 梳理部署文档和本地开发说明

---

## 8. 最终判断

如果用一句话概括：

**这套实现已经把“Playwright 登录服务”的主骨架搭出来了，但现在更像是一个可继续推进的原型，而不是已经闭环的工程化版本。**

最值得先处理的不是继续加学校，而是先把这几个底层问题补齐：

- API 结果闭环
- Worker 运行方式
- 配置统一
- Context 真正隔离
- 测试与文档同步

这些补完之后，再继续扩学校和扩并发，成本会低很多。
