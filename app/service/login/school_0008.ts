/**
 * 南华大学（0008）Playwright 自动化登录
 *
 * 登录入口：http://jwzx.usc.edu.cn:8924/jsxsd/
 *
 * 特殊机制：
 * 1. 强智 S5.7 登录页提交时会把账号密码写入 hidden encoded 字段
 * 2. 页面包含图形验证码，需要 OCR 后填写 RANDOMCODE
 * 3. 验证码错误会回到登录页，需要刷新验证码后重试
 */

import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';
import { recognizeCaptcha } from '../../utils/ocr.ts';

/** 南华大学强智教务登录入口 */
const SSO_URL = 'http://jwzx.usc.edu.cn:8924/jsxsd/';
/** 账号输入框 */
const USERNAME_SELECTOR = '#userAccount';
/** 密码输入框 */
const PASSWORD_SELECTOR = '#userPassword';
/** 验证码输入框 */
const CAPTCHA_INPUT_SELECTOR = '#RANDOMCODE';
/** 验证码图片 */
const CAPTCHA_IMG_SELECTOR = '#SafeCodeImg';
/** 登录按钮 */
const LOGIN_BUTTON_SELECTOR = 'button.login_btn';
/** 验证码最大重试次数 */
const MAX_CAPTCHA_RETRIES = 3;

export const school0008Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
      await page.goto(SSO_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForSelector(USERNAME_SELECTOR, { timeout: 10_000 });

      await page.fill(USERNAME_SELECTOR, username);
      await page.fill(PASSWORD_SELECTOR, password);

      const captchaImg = page.locator(CAPTCHA_IMG_SELECTOR);
      await captchaImg.waitFor({ state: 'visible', timeout: 10_000 });
      const captchaText = await recognizeCaptcha(await captchaImg.screenshot(), '10113');
      await page.fill(CAPTCHA_INPUT_SELECTOR, captchaText);

      const beforeClickUrl = page.url();
      const navDone = page
        .waitForURL(url => url.href !== beforeClickUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        })
        .catch(() => null);
      const pageSettled = page.waitForTimeout(3000).catch(() => null);

      await page.click(LOGIN_BUTTON_SELECTOR);
      await Promise.race([navDone, pageSettled]);

      const content = await page.content();
      if (content.includes('验证码错误')) {
        if (attempt < MAX_CAPTCHA_RETRIES) continue;
        throw new Error('验证码 OCR 识别连续失败 3 次，请稍后重试');
      }

      if (
        content.includes('用户名或密码错误') ||
        content.includes('账号或密码错误') ||
        (content.includes('<title>登录</title>') && page.url().includes('/jsxsd/'))
      ) {
        throw new Error('账号或密码错误');
      }

      await page
        .waitForURL(url => url.href.includes('/jsxsd/framework/') || url.href.includes('xsMain'), {
          waitUntil: 'domcontentloaded',
          timeout: 10_000,
        })
        .catch(() => null);

      const cookies = await page.context().cookies();
      const sessionId = cookies.find(
        c => c.name.toLowerCase() === 'jsessionid' && c.domain.includes('usc.edu.cn'),
      )?.value;

      if (!cookies.length) {
        throw new Error('登录成功但未获取到 Cookie');
      }

      return {
        cookies,
        sessionId,
        loginAt: Date.now(),
      };
    }

    throw new Error('验证码 OCR 识别连续失败 3 次，请稍后重试');
  },
};
