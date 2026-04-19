/**
 * 湖南师范大学（0003）Playwright 自动化登录
 *
 * 登录入口：https://jwglnew.hunnu.edu.cn/
 * 底层鉴权：https://login.hunnu.edu.cn/Login
 *
 * 依赖 WebVPN 重定向（自动处理）：
 * 登录成功后会经过 vweb.hunnu.edu.cn，最后回到 jwglnew.hunnu.edu.cn
 */

import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';

const SSO_URL = 'https://jwglnew.hunnu.edu.cn/';

export const school0003Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    // 1. 打开入口页（会自动重定向到 SSO 统一身份认证中心）
    await page.goto(SSO_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // 2. 湖南师大的 SSO（基于 Vue/Vuetify）默认使用扫码或其他标签
    // 需要等待左侧菜单"密码"按钮出现并点击
    const pwdTabSelector = 'button:has-text("密码")';
    await page.waitForSelector(pwdTabSelector, { timeout: 10_000 });
    await page.click(pwdTabSelector);

    // 3. 填写账号密码
    const usernameSelector = 'input[placeholder*="用户名"]';
    const passwordSelector = 'input[placeholder="密码"]';
    await page.waitForSelector(usernameSelector, { timeout: 10_000 });
    await page.fill(usernameSelector, username);
    await page.fill(passwordSelector, password);

    // 4. 点击登录按钮并等待响应
    // 登录按钮是 btn bg-red-darken-3
    const loginBtnSelector = 'button.bg-red-darken-3:has-text("登录")';

    // 并行等待跳转与前端动态报错
    const beforeClickUrl = page.url();
    const navDone = page
      .waitForURL(url => url.href !== beforeClickUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      .catch(() => null);

    // 避免抓到成功的 v-alert（如登录成功：网瑞达），只抓取包含 error 的
    const errVisible = page
      .waitForSelector('.v-alert.bg-error, .text-error, .v-snackbar__content, [class*="error"]', {
        state: 'visible',
        timeout: 15_000,
      })
      .catch(() => null);

    await page.click(loginBtnSelector);
    await Promise.race([navDone, errVisible]);

    const currentUrl = page.url();

    // 5a. 失败判断：停留在 login.hunnu.edu.cn 并有前端弹窗报错
    if (currentUrl.includes('login.hunnu.edu.cn')) {
      const liveContent = await page.content();
      
      // 如果页面出现明确的“登录成功”提示（如跳转网瑞达代理），说明其实是成功的，只是在中转停顿
      if (!liveContent.includes('登录成功')) {
        // 尝试等待错误元素
        await page
          .waitForSelector('.v-alert.bg-error, .text-error, .v-snackbar__content, [class*="error"]', {
            state: 'visible',
            timeout: 3000,
          })
          .catch(() => null);

        const errorText = await page
          .$eval('.v-alert, .v-snackbar__content, [class*="error"]', el => el.textContent?.trim() ?? '')
          .catch(() => '');

        const isCredentialError =
          liveContent.includes('密码错误') ||
          liveContent.includes('用户名错误') ||
          liveContent.includes('账号不存在') ||
          errorText.includes('密码') ||
          errorText.includes('未找到相关账号信息');

        if (isCredentialError) {
          throw new Error('账号或密码错误');
        }

        throw new Error(
          `登录失败，仍停留在登录页。${errorText ? `页面提示：${errorText}` : '未知错误'}`,
        );
      }
    }

    // 5b. 成功判断：无论是瞬间跳走，还是有“登录成功”提示停留，都需要确保最终达到教务系统
    // 跳转涉及 https://vweb.hunnu.edu.cn/... 中转，最终回落 https://jwglnew.hunnu.edu.cn/...
    if (!page.url().includes('jwglnew.hunnu.edu.cn')) {
      await page
        .waitForURL('**/*jwglnew.hunnu.edu.cn/**', { waitUntil: 'domcontentloaded', timeout: 15_000 })
        .catch(() => {
          throw new Error('登录系统已放行，但等待跳转至最终教务系统超时');
        });
    }

    // 6. 提取 Cookie
    const cookies = await page.context().cookies();

    const sessionId = cookies.find(
      c =>
        // 教务系统主 Session
        c.name.toLowerCase() === 'jsessionid' && c.domain.includes('hunnu')
    )?.value;

    return {
      cookies,
      sessionId,
      loginAt: Date.now(),
    };
  },
};
