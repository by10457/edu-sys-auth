/**
 * 中南大学（0001）Playwright 自动化登录
 *
 * 登录入口：统一身份认证 SSO（ca.csu.edu.cn）
 * 加密方式：AES-CBC，密钥和 IV 从登录页面动态获取
 *
 * 对标 Python 版：edu-sys-crawler/app/service/v1_0001/login.py
 */

import { createCipheriv, randomBytes } from 'node:crypto';
import type { Page } from 'playwright';
import type { SchoolLoginService, PlaywrightLoginResult } from './types.ts';

/** 随机字符集（与 Python 版保持完全一致） */
const AES_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

function randomString(n: number): string {
  let result = '';
  const randomBuf = randomBytes(n);
  for (let i = 0; i < n; i++) {
    result += AES_CHARS[randomBuf[i] % AES_CHARS.length];
  }
  return result;
}

/**
 * AES-CBC 加密密码（与 Python 版算法完全一致）
 * @param password - 明文密码
 * @param key - 从登录页面获取的加密 salt
 */
function encryptPassword(password: string, key: string): string {
  const prefix = randomString(64);
  const iv = randomString(16);
  const plaintext = prefix + password;

  const keyBuf = Buffer.from(key, 'utf-8');
  const ivBuf = Buffer.from(iv, 'utf-8');
  const plaintextBuf = Buffer.from(plaintext, 'utf-8');

  // PKCS7 Padding
  const blockSize = 16;
  const padLen = blockSize - (plaintextBuf.length % blockSize);
  const padded = Buffer.concat([plaintextBuf, Buffer.alloc(padLen, padLen)]);

  const cipher = createCipheriv('aes-128-cbc', keyBuf, ivBuf);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  return encrypted.toString('base64');
}

/** SSO 登录入口 URL */
const SSO_URL =
  'https://ca.csu.edu.cn/authserver/login?service=http%3A%2F%2Fcsujwc.its.csu.edu.cn%2Fsso.jsp';

/**
 * 中南大学登录实现
 *
 * 流程：
 * 1. 访问 SSO 登录页，获取 execution token 和 pwdEncryptSalt
 * 2. 用 AES 加密密码
 * 3. 提交登录表单
 * 4. 验证登录结果，提取最终 Cookie
 */
export const school0001Login: SchoolLoginService = {
  async login(page: Page, username: string, password: string): Promise<PlaywrightLoginResult> {
    // 1. 访问 SSO 登录页
    await page.goto(SSO_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // 2. 提取动态参数
    const execution = await page.inputValue('#execution');
    const salt = await page.inputValue('#pwdEncryptSalt');

    if (!execution || !salt) {
      throw new Error('[CSU-0001] 无法获取登录页动态参数（execution / pwdEncryptSalt）');
    }

    // 3. 加密密码
    const encryptedPwd = encryptPassword(password, salt);

    // 4. 填写并提交表单
    await page.fill('#username', username);
    await page.fill('#password', encryptedPwd);

    // 直接通过 JS 设置加密后的密码值（绕过可能的键盘事件检测）
    await page.evaluate(
      ({ encPwd }) => {
        (document.querySelector('#password') as HTMLInputElement).value = encPwd;
      },
      { encPwd: encryptedPwd },
    );

    // 提交表单
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }),
      page.click('#login-button'),
    ]);

    // 5. 验证登录结果
    const currentUrl = page.url();
    const pageContent = await page.content();

    if (pageContent.includes('统一身份认证') || currentUrl.includes('authserver/login')) {
      // 仍在登录页，说明认证失败
      const errorMsg =
        (await page.$eval('.auth_error', (el) => el.textContent).catch(() => null)) ??
        '账号或密码错误';
      throw new Error(`[CSU-0001] 登录失败：${errorMsg.trim()}`);
    }

    // 6. 提取 Cookie
    const cookies = await page.context().cookies();
    const loginAt = Date.now();

    return {
      cookies,
      loginAt,
    };
  },
};
