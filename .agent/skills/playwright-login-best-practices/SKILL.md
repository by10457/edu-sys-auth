---
name: Playwright Login Best Practices
description: Guidelines and battle-tested patterns for building robust Playwright automated login scripts for various school SSO and WebVPN systems.
---

# Playwright 自动化登录实战指南 (教务系统)

在针对不同学校（如中南大学 0001、湖南师范大学 0003、湖南农业大学 0009）的教务系统（SSO、WebVPN、CAS）编写跨终端自动化登录脚本时，面临着重定向复杂、异步渲染多、反爬安全机制等挑战。

本项 Skill 总结了开发过程中踩过的所有坑点及最佳解决方案。在后续新增其他学校的自动化服务时，请务必严格遵守以下规范：

## 1. 废弃死板的等待，拥抱精准的 URL 监听拦截 (WebVPN/重定向问题)
**现象**：登录成功后，页面通常会经过鉴权中心、WebVPN 等多个跳板服务器（例如先跳 `vweb...` 再跳回 `jwglnew...`）。传统的 `await page.waitForTimeout(3000)` 极度不可靠，网络波动会导致刚取到空白 Cookie 脚本就提前结束。
**规范**：
- 替换过期方法：绝对禁止使用已弃用的 `waitForNavigation`，改用新标准的 `page.waitForURL`。
- 最终目标锁定：成功判断时，必须指定终态 URL 域进行强校验。
```typescript
// ✅ 动态兜底等待跳板，最高容忍 15 秒
if (!page.url().includes('jwglnew.hunnu.edu.cn')) {
  await page
    .waitForURL('**/*jwglnew.hunnu.edu.cn/**', { waitUntil: 'domcontentloaded', timeout: 15_000 })
    .catch(() => {
      throw new Error('登录系统已放行，但等待跳转至最终教务系统超时'); // 触发系统重试
    });
}
```

## 2. Race 竞争条件下的选择器精准度 (Vue/React 动态弹窗问题)
**现象**：SPA 站点经常使用组件化弹窗（如 Vuetify 的 `.v-alert`）。点击登录时，我们通常使用 `Promise.race([waitForURL, waitForError])` 来并行判断成功与否。但部分学校（如 0003 湖南师范大学）登录成功时也会弹一个绿色 Info 框：“登录成功！正在跳转...”。如果抓错的 Selector 太宽泛，就会错误地将成功判定为失败。
**规范**：
- 提取报错弹框的 CSS 选择器时，**必须带上明确区分状态的类名**（如 `.bg-error`、`.text-error`）。
- 或者使用 `waitForFunction` 根据内部本文是否存在明显报错（如“错误”）作为判断。
```typescript
// ✅ Race 判断 URL 变化或准确拦截错误提示框
const beforeClickUrl = page.url();
const navDone = page.waitForURL(url => url.href !== beforeClickUrl, { timeout: 15_000 }).catch(() => null);

// 务必排除成功的反馈色块！只保留 error 的特征类
const errVisible = page.waitForSelector('.v-alert.bg-error, .text-error', { state: 'visible', timeout: 15_000 }).catch(() => null);
await page.click('button.login');
await Promise.race([navDone, errVisible]);
```

## 3. 防控机制前置侦测与账号锁定保护 (风控反爬问题)
**现象**：一些高校（如 0009 湖南农业大学）并未在初始页面要求输入验证码，但如果连续密码错误超过 3 次，页面会在下一次加载或异步注入一个难以逾越的 `input.captcha`。此时若系统盲目按“未知错误”不断重试，不仅会彻底永久锁死用户账号，导致阻塞请求队列。
**规范**：
- **前置侦测**：在填写账号密码前，必须嗅探是否有已经触发防爆破保护的 DOM（如 `#captcha`, `.captcha-input`）。
- **统一认定 401**：不管是“密码错误”还是“触发验证风控”，在程序解析时一律归入 `isCredentialError` 阵营。只要抛出带有特定关键字（“账号或密码错误”）的 Error，Worker 会直接终止任务并给终端响应 401，禁止重试机制滚雪球。
```typescript
// ✅ 填写前的反制侦测
const captchaVisible = await page.$('input.captcha').catch(() => null);
if (captchaVisible) {
  throw new Error('账号密码错误或触发风控，需要输入验证码'); // 立马阻断，归类为前端认证失败 401
}
```

## 4. 异步渲染下的 DOM-First 文本内容匹配
**现象**：只用 `page.url()` 或 `page.content()` 进行状态判定十分脆弱，因为当点击登录后，前端通过 API 拿到密码错误并用 JS 渲染进 DOM 是需要数百毫秒时间的；直接同步读取 `liveContent` 会误判为空。
**规范**：
- 当确定停留在原 URL 并需要萃取错误日志时，必须**显式等待错误选择器**加载出现，若超时则拿一个默认全量内容保底。
```typescript
// ✅ 异步等待错误浮窗显现后再获取 Text
await page.waitForSelector('.error-msg', { state: 'visible', timeout: 3000 }).catch(() => null);
const liveContent = await page.content(); // 作为全局后备分析文本
```

## 5. 设计统一的标准响应结构
将所有 `waitForXXX` 最底层的 Exception 上浮捕获，并根据 Error Message 是否包含凭据关键词决定返回：
* `code 500`: 系统超时 / 网页改版导致未找到输入框 (走 Worker 可靠的多次重试)。
* `code 401`: 封号 / 需要验证码 / 密码错误 (Fail-fast，不重试，拦截请求并直接告知终端更换密码)。
