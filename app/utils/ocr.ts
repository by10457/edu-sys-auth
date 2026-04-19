/**
 * OCR 验证码识别工具
 *
 * 基于 jfbym.com 第三方 OCR API，支持：
 * - type 10113：英数混合字符型验证码（如 a2d3, B5kZ 等）
 * - type 30400：数学运算表达式验证码（如 9+4=?）
 *
 * API 文档：http://api.jfbym.com
 *
 * 使用方式：
 *   import { recognizeCaptcha } from '../utils/ocr.ts';
 *
 *   const imgBuffer = await page.locator('img.captcha').screenshot();
 *   const text = await recognizeCaptcha(imgBuffer, '10113');
 */

/** OCR API 配置 */
const OCR_API_URL = 'http://api.jfbym.com/api/YmServer/customApi';
const OCR_TOKEN = process.env.OCR_TOKEN ?? 'T3OtYU_fxMn7YsJ28GAG21MJpSvu-f-uF2oUHbzjVXM';

/**
 * 识别图片验证码，返回识别结果字符串
 * @param imgBuffer - 验证码图片数据（Buffer 或 Uint8Array）
 * @param type - OCR 类型 ID，不同验证码图案对应不同 type
 *   - '10113'：英数混合（如 a2d3）
 *   - '30400'：数学运算表达式（如 9+4=?）
 * @returns 识别出的文字，识别失败返回空字符串
 */
export async function recognizeCaptcha(
  imgBuffer: Buffer | Uint8Array,
  type: string = '10113',
): Promise<string> {
  const base64 = Buffer.from(imgBuffer).toString('base64');

  const response = await fetch(OCR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: OCR_TOKEN, type, image: base64 }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`OCR API 响应异常: ${response.status}`);
  }

  const json = (await response.json()) as { data?: { data?: string } };
  const result = json?.data?.data ?? '';

  if (!result) {
    throw new Error('OCR API 识别结果为空');
  }

  return result;
}

/**
 * 识别数学运算型验证码，返回计算结果（数字）
 * 表达式格式示例：9+4=?、12-3=?、5*6=?
 *
 * @param imgBuffer - 验证码图片数据
 * @returns 计算结果数字，失败时抛出
 */
export async function recognizeMathCaptcha(imgBuffer: Buffer | Uint8Array): Promise<number> {
  const expression = await recognizeCaptcha(imgBuffer, '30400');

  // 从表达式中提取运算符和数字
  // 支持格式：9+4=?、9+4?、9+4
  const cleaned = expression.replace(/[=?？]/g, '').trim();

  const match = cleaned.match(/^(\d+)\s*([+\-x*×÷/])\s*(\d+)$/);
  if (!match) {
    throw new Error(`OCR 数学表达式格式无法解析: "${expression}"`);
  }

  const [, a, op, b] = match;
  const num1 = parseInt(a, 10);
  const num2 = parseInt(b, 10);

  switch (op) {
    case '+':
      return num1 + num2;
    case '-':
      return num1 - num2;
    case 'x':
    case '*':
    case '×':
      return num1 * num2;
    case '/':
    case '÷':
      return num1 / num2;
    default:
      throw new Error(`OCR 数学表达式运算符无法识别: "${op}"`);
  }
}
