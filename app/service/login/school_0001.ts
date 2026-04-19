/**
 * 中南大学（0001）Playwright 自动化登录
 *
 * 登录入口：统一身份认证 SSO（ca.csu.edu.cn）
 *
 * 登录流程（基于实际浏览器调试）：
 * 1. 打开 SSO 登录页
 * 2. 直接填写明文账号和密码（页面 JS 会在提交时自动加密密码）
 * 3. 点击登录按钮（a#login_submit）
 * 4. 等待页面跳转
 * 5. 通过 URL 和页面内容判断登录结果
 * 6. 成功后提取所有 Cookie，重点关注 CASTGC 和教务系统 JSESSIONID
 *
 */

import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';

/** SSO 登录入口 URL */
const SSO_URL =
  'https://ca.csu.edu.cn/authserver/login?service=http%3A%2F%2Fcsujwc.its.csu.edu.cn%2Fsso.jsp';

/**
 * 中南大学登录实现
 *
 * CAS 标准登录流程，无滑块/图形验证码（首次登录）。
 * 若触发验证码（高频失败后），任务会抛出异常触发重试。
 */
export const school0001Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    // 1. 打开 SSO 登录页，等待账号输入框出现（确认页面加载完成）
    await page.goto(SSO_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('#username', { timeout: 10_000 });

    // 2. 填写账号和密码（明文即可，页面 JS 在提交时自动加密）
    await page.fill('#username', username);
    await page.fill('#password', password);

    // 3. 点击登录按钮
    //    登录结果有两种情况：
    //    a) 登录成功或传统 POST 表单失败 → 页面跳转（waitForNavigation 会触发）
    //    b) 前端 JS 直接渲染错误（如验证码校验）→ 不触发 navigation，错误元素直接出现
    //    所以不能只等 waitForNavigation，需要 race 两种情况
    await page.click('#login_submit');

    const beforeClickUrl = page.url();
    // 并行等待「页面 URL 发生变化（包含成功跳转或被重定向回错误页）」或「错误提示元素出现」
    // 两个 Promise 都 catch 成 null，保证 race 不会 reject
    const navDone = page
      .waitForURL(url => url.href !== beforeClickUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      .catch(() => null);
    const errVisible = page
      .waitForSelector('#showErrorTip, .auth_error, .error-msg, [class*="error"]', {
        state: 'visible',
        timeout: 15_000,
      })
      .catch(() => null);

    await Promise.race([navDone, errVisible]);

    // 4. 判断登录结果
    const currentUrl = page.url();

    // 4a. 失败判断：仍停留在登录页 + 出现错误提示
    if (currentUrl.includes('authserver/login') || currentUrl.includes('ca.csu.edu.cn')) {
      // CAS 错误提示由 JS 在 domcontentloaded 后异步注入，需等待渲染完成
      // 先尝试等待错误元素出现（最多 3 秒），超时则降级继续检测
      await page
        .waitForSelector('#showErrorTip, .auth_error, .error-msg, [class*="error"]', {
          state: 'visible',
          timeout: 3000,
        })
        .catch(() => null);

      // 等待后重新获取页面内容（包含 JS 动态注入的错误文字）
      const liveContent = await page.content();
      const errorText = await page
        .$eval(
          '#showErrorTip, .auth_error, .error-msg, [class*="error"]',
          el => el.textContent?.trim() ?? '',
        )
        .catch(() => '');

      // 账号密码错误检测
      const isCredentialError =
        liveContent.includes('您提供的用户名或者密码有误') ||
        liveContent.includes('账号或密码错误') ||
        liveContent.includes('用户名或密码有误') ||
        errorText.includes('密码') ||
        // 图形动态码错误：通常由密码错误触发后服务器要求验证码，
        // automation 无法自动填写，归类为凭据问题，不重试
        errorText.includes('图形') ||
        errorText.includes('验证码') ||
        errorText.includes('动态码');

      if (isCredentialError) {
        throw new Error('账号或密码错误');
      }

      // 其他登录页错误（账号被锁、服务不可用等）→ 抛出带原始信息的异常（会触发重试）
      throw new Error(
        `登录失败，仍停留在登录页。${errorText ? `页面提示：${errorText}` : '未知错误'}`,
      );
    }

    // 4b. 成功判断：URL 已跳转到教务系统
    //     成功后会跳转到类似 http://csujwc.its.csu.edu.cn/jsxsd/framework/xsMain.jsp
    if (!currentUrl.includes('csujwc.its.csu.edu.cn') && !currentUrl.includes('xsMain')) {
      // 跳转到了未预期的 URL（可能是 SSO 中间跳转页），等待到达最终目标页
      await page
        .waitForURL('**/*csujwc.its.csu.edu.cn/**', { waitUntil: 'domcontentloaded', timeout: 10_000 })
        .catch(() => null);
    }

    // 5. 提取 Cookie
    //    需要收集所有域名的 Cookie：
    //    - ca.csu.edu.cn：CASTGC（CAS 主票据，可用于重新获取服务票据）
    //    - csujwc.its.csu.edu.cn：JSESSIONID（教务系统 Session）
    const cookies = await page.context().cookies();

    // 提取关键 Session Cookie 便于调用方快速取用
    const sessionId = cookies.find(
      c =>
        // 教务系统的 JSESSIONID 优先（domain 包含 csujwc）
        (c.name === 'JSESSIONID' && c.domain.includes('csujwc')) ||
        // 其次是 CAS 主票据
        c.name === 'CASTGC',
    )?.value;

    return {
      cookies,
      sessionId,
      loginAt: Date.now(),
    };
  },
};
