/**
 * 湖南财政经济学院（0052）Playwright 自动化登录
 *
 * 登录入口：WebVPN + CAS
 * https://vpn.hufe.edu.cn/https/77726476706e69737468656265737421e5fe40d22f256e55300d8db9d6562d/cas/login?service=http:%2F%2Fjiaowu2.hufe.edu.cn%2Fsso.jsp
 *
 * 特殊机制：
 * 1. 进入页面后有"操作指南"二维码弹窗（遮挡登录按钮，必须先关闭）
 * 2. 登录按钮初始为 disabled，需填写账密并 blur 触发 Angular 校验解锁
 * 3. 点击登录后，服务端可能返回图片验证码（校验码），需 OCR 最多重试 3 次
 */

import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';
import { recognizeCaptcha } from '../../utils/ocr.ts';

const SSO_URL =
  'https://vpn.hufe.edu.cn/https/77726476706e69737468656265737421e5fe40d22f256e55300d8db9d6562d/cas/login?service=http:%2F%2Fjiaowu2.hufe.edu.cn%2Fsso.jsp';

// ── 精确选择器（通过浏览器调试确认）────────────────────────────────────────────
const USERNAME_SELECTOR = 'input[placeholder="请输入学工号/绑定手机/证件号"]';
const PASSWORD_SELECTOR = 'input[placeholder="请输入密码"]';
const LOGIN_BTN_SELECTOR = 'button.login-button';
// 操作指南弹窗关闭按钮（nz-modal 右上角 X）
const MODAL_CLOSE_SELECTOR = '.ant-modal-close, .ant-modal-close-x, button[aria-label="Close"]';
// 验证码图片（点击登录后动态注入）
const CAPTCHA_IMG_SELECTOR = '.code-reload-content img, img[src*="captcha"], img[src*="code"]';
// 验证码输入框
const CAPTCHA_INPUT_SELECTOR = 'input[placeholder="校验码不区分大小写"]';
// 验证码刷新链接
const CAPTCHA_RELOAD_SELECTOR = 'a.code-reload-content';

export const school0052Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    await page.goto(SSO_URL, { waitUntil: 'networkidle', timeout: 25_000 });

    // 1. 关闭操作指南弹窗（如果存在）
    //    弹窗出现时会完全遮挡登录按钮，必须先关掉
    const modalClose = await page.$(MODAL_CLOSE_SELECTOR);
    if (modalClose) {
      await modalClose.click().catch(() => null);
      // 等待弹窗动画消失
      await page
        .waitForSelector(MODAL_CLOSE_SELECTOR, { state: 'hidden', timeout: 3_000 })
        .catch(() => null);
      console.log('[0052] 操作指南弹窗已关闭');
    }

    // 2. 等待输入框完全就绪后填写账号密码
    //    注意：页面框架（Vue/Angular）渲染有延迟，waitForSelector 命中时 value 可能还未绑定
    //    策略：等待 + 填写 + 验证已填值，如未填成功则再等稍稍后补填
    await page.waitForSelector(USERNAME_SELECTOR, { timeout: 10_000 });
    await page.waitForTimeout(300); // 等待 Vue/Angular 完成数据绑定

    await page.fill(USERNAME_SELECTOR, username);
    await page.fill(PASSWORD_SELECTOR, password);

    // 验证填写是否成功，未成功则补填（防止页面渲染竞争导致 fill 被清空）
    const actualUsername = await page.inputValue(USERNAME_SELECTOR);
    const actualPassword = await page.inputValue(PASSWORD_SELECTOR);
    if (!actualUsername) {
      console.log('[0052] 账号未成功填入，补填...');
      await page.fill(USERNAME_SELECTOR, username);
    }
    if (!actualPassword) {
      console.log('[0052] 密码未成功填入，补填...');
      await page.fill(PASSWORD_SELECTOR, password);
    }

    // 触发 blur 解锁 Angular 表单的 disabled 按钮
    await page.press(PASSWORD_SELECTOR, 'Tab');
    await page.waitForTimeout(500);

    // 3. 等待登录按钮变为可用（disabled 属性消失）
    await page
      .waitForFunction(
        (selector: string) => {
          const btn = document.querySelector(selector) as HTMLButtonElement | null;
          return btn !== null && !btn.disabled;
        },
        LOGIN_BTN_SELECTOR,
        { timeout: 5_000 },
      )
      .catch(() => null); // 超时则继续，evaluate 强解锁会兜底

    // 兜底：强制移除 disabled（防止 Angular 校验未触发）
    await page.evaluate((selector: string) => {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (btn) btn.removeAttribute('disabled');
    }, LOGIN_BTN_SELECTOR);

    // 4. 点击登录按钮（首次提交）
    const beforeClickUrl = page.url();

    // race：页面跳走（成功） OR 验证码输入框出现（需要 OCR）
    // 注意：不在此处等错误文本，避免 [class*="error"] 宽泛匹配误触发
    const navDone = page
      .waitForURL(url => url.href !== beforeClickUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      .catch(() => null);

    // 只精确等验证码输入框（精准选择器，不会假阳性）
    const captchaAppeared = page
      .waitForSelector(CAPTCHA_INPUT_SELECTOR, {
        state: 'visible',
        timeout: 10_000,
      })
      .catch(() => null);

    await page.click(LOGIN_BTN_SELECTOR);
    // 正常登录成功：navDone 先赢，captchaAppeared 被丢弃（不阻塞，不误判）
    // 验证码出现：captchaAppeared 先赢，进入重试循环
    await Promise.race([navDone, captchaAppeared]);

    // 5. 验证码重试循环（最多 3 次）
    const MAX_CAPTCHA_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
      // 已跳出登录页 → 成功，退出循环
      if (!page.url().includes('cas/login')) break;

      // 检查是否有验证码
      const captchaImg = await page.$(CAPTCHA_IMG_SELECTOR);
      if (!captchaImg) break; // 没有验证码，进入后续失败判断

      console.log(`[0052] 出现验证码，OCR 识别第 ${attempt}/${MAX_CAPTCHA_RETRIES} 次...`);

      // 截图验证码图片 → OCR → 填写
      const imgBuffer = await captchaImg.screenshot();
      const captchaText = await recognizeCaptcha(imgBuffer, '10113');
      console.log(`[0052] OCR 识别结果: ${captchaText}`);

      await page.fill(CAPTCHA_INPUT_SELECTOR, captchaText);

      // 提交
      const urlBeforeRetry = page.url();
      const retryNavDone = page
        .waitForURL(url => url.href !== urlBeforeRetry, {
          waitUntil: 'domcontentloaded',
          timeout: 12_000,
        })
        .catch(() => null);

      const retryErrVisible = page
        .waitForFunction(
          () => {
            const t = document.body.innerText;
            return (
              t.includes('验证码错误') ||
              t.includes('校验码不正确') ||
              t.includes('用户名或密码错误')
            );
          },
          null,
          { timeout: 12_000 },
        )
        .catch(() => null);

      await page.click(LOGIN_BTN_SELECTOR);
      await Promise.race([retryNavDone, retryErrVisible]);

      // 已跳出 → 成功
      if (!page.url().includes('cas/login')) break;

      // 仍在登录页：是密码错误还是验证码问题
      const content = await page.content();
      if (content.includes('用户名或密码错误') || content.includes('账号不存在')) {
        throw new Error('账号或密码错误');
      }

      if (attempt < MAX_CAPTCHA_RETRIES) {
        console.log('[0052] 验证码识别错误，等待验证码刷新后重试...');

        // 记录旧 src（用 page.$eval 避免 ElementHandle 被页面刷新后失效）
        const oldSrc =
          (await page
            .$eval(CAPTCHA_IMG_SELECTOR, (el: Element) => (el as HTMLImageElement).src)
            .catch(() => '')) ?? '';

        // 优先点击刷新链接触发换码
        await page.click(CAPTCHA_RELOAD_SELECTOR).catch(() => null);

        // 等待 src 更新（每次都从 DOM 重新查询，避免 stale handle 问题）
        await page
          .waitForFunction(
            (args: { selector: string; oldSrc: string }) => {
              const el = document.querySelector(args.selector) as HTMLImageElement | null;
              return el ? el.src !== args.oldSrc && el.src !== '' : false;
            },
            { selector: CAPTCHA_IMG_SELECTOR, oldSrc },
            { timeout: 5_000 },
          )
          .catch(() => null);
      } else {
        throw new Error(
          '验证码 OCR 识别连续失败 3 次，可能是验证码类型不匹配或 API 异常，请稍后重试',
        );
      }
    }

    // 6. 仍停留在登录页 → 失败判断
    if (page.url().includes('cas/login')) {
      const liveContent = await page.content();

      if (liveContent.includes('用户名或密码错误') || liveContent.includes('账号不存在')) {
        throw new Error('账号或密码错误');
      }

      throw new Error('登录失败，仍停留在登录页，未识别到预期的错误或跳转。');
    }

    // 7. 成功判断：等待最终落地教务系统
    if (!page.url().includes('hufe.edu.cn') || page.url().includes('cas/login')) {
      await page
        .waitForURL(url => url.href.includes('hufe.edu.cn') && !url.href.includes('cas/login'), {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        })
        .catch(() => {
          throw new Error('登录系统已放行，但等待跳转至最终教务系统超时');
        });
    }

    // 8. 提取 Cookie
    const cookies = await page.context().cookies();

    const sessionId = cookies.find(
      c =>
        (c.name.toLowerCase() === 'jsessionid' || c.name.toLowerCase().includes('token')) &&
        (c.domain.includes('hufe.edu.cn') || c.domain.includes('vpn')),
    )?.value;

    return {
      cookies,
      sessionId,
      loginAt: Date.now(),
    };
  },
};
