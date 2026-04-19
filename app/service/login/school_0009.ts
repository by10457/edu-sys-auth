/**
 * 湖南农业大学（0009）Playwright 自动化登录
 *
 * 登录入口：WebVPN + CAS
 * https://webvpn.hunau.edu.cn/https/77777776706e697374686562657374210e03473ff678aae237e91e44aaddcc6d/cas/login?service=http%3A%2F%2Fjwxt.hunau.edu.cn%2Fsso.jsp
 */

import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';

const SSO_URL =
  'https://webvpn.hunau.edu.cn/https/77777776706e697374686562657374210e03473ff678aae237e91e44aaddcc6d/cas/login?service=http%3A%2F%2Fjwxt.hunau.edu.cn%2Fsso.jsp';

export const school0009Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    await page.goto(SSO_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // 1. 等待账密输入框出现
    const usernameSelector = 'input.email-username, input[placeholder*="学工号"]';
    const passwordSelector = 'input[type="password"], input[placeholder*="密码"]';

    await page.waitForSelector(usernameSelector, { timeout: 10_000 });

    // 检查是否存在已被风控要求验证码的情况
    const captchaVisible = await page.$('input.captcha').catch(() => null);
    if (captchaVisible) {
      throw new Error('账号密码错误或触发风控，需要输入验证码');
    }

    // 2. 填写账号密码
    await page.fill(usernameSelector, username);
    await page.fill(passwordSelector, password);

    // 3. 点击登录按钮
    const loginBtnSelector = 'button.exeActionBtn';
    const beforeClickUrl = page.url();

    const navDone = page
      .waitForURL(url => url.href !== beforeClickUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      .catch(() => null);

    // 等待网页弹出的 div 等报错框 (通常是 body 下的新节点，且不引起跳转)
    // 根据可视化测试，湖南农大如果报错，会弹框提示“用户名或密码错误”等
    const errVisible = page
      .waitForFunction(
        () => {
          return (
            document.body.innerText.includes('错误') || document.body.innerText.includes('验证码')
          );
        },
        null,
        { timeout: 15_000 },
      )
      .catch(() => null);

    await page.click(loginBtnSelector);
    await Promise.race([navDone, errVisible]);

    const currentUrl = page.url();

    // 4a. 失败判断：停留在 WebVPN 的 CAS 登录页
    if (currentUrl.includes('cas/login')) {
      // 稍微等待 DOM 渲染错误提示文本
      await page.waitForTimeout(1000);
      const liveContent = await page.content();

      const isCredentialError =
        liveContent.includes('密码错误') ||
        liveContent.includes('用户名错误') ||
        liveContent.includes('账号不存在') ||
        liveContent.includes('验证码') ||
        liveContent.includes('登录失败超过');

      if (isCredentialError) {
        throw new Error('账号或密码错误（或触发频繁登录锁定限制）');
      }

      throw new Error('登录失败，仍停留在登录页，且未识别到预期错误文本。');
    }

    // 4b. 成功判断：确保最终到达教务系统
    if (!page.url().includes('jwxt.hunau.edu.cn')) {
      await page
        .waitForURL('**/*jwxt.hunau.edu.cn/**', { waitUntil: 'domcontentloaded', timeout: 15_000 })
        .catch(() => {
          throw new Error('登录系统已放行，但等待跳转至最终教务系统超时');
        });
    }

    // 5. 提取 Cookie
    const cookies = await page.context().cookies();

    const sessionId = cookies.find(
      c =>
        // WebVPN 登录教务系统的 Session 票据
        (c.name.toLowerCase() === 'jsessionid' || c.name.toLowerCase().includes('token')) &&
        (c.domain.includes('hunau.edu.cn') || c.domain.includes('webvpn')),
    )?.value;

    return {
      cookies,
      sessionId,
      loginAt: Date.now(),
    };
  },
};
