/**
 * OCR 验证码识别工具
 *
 * 基于本地/内网 ddddocr HTTP 服务，接口协议与 edu-sys-spider 的
 * core.aiohttp.recognize_captcha 保持一致。
 *
 * 使用方式：
 *   import { recognizeCaptcha } from '../utils/ocr.ts';
 *
 *   const imgBuffer = await page.locator('img.captcha').screenshot();
 *   const text = await recognizeCaptcha(imgBuffer, {
 *     charsetRange: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
 *   });
 */

/** ddddocr HTTP 服务地址，与 edu-sys-spider 默认配置一致 */
const OCR_API_URL = process.env.OCR_API_URL ?? 'http://103.120.88.218:10466/ocr';
/** OCR 请求超时时间，避免验证码服务拖死登录任务 */
const OCR_TIMEOUT_MS = Number.parseInt(process.env.OCR_TIMEOUT_MS ?? '10000', 10);

/** ddddocr 请求选项 */
export interface CaptchaOptions {
  /** 限制识别字符集，例如数字或英数混合 */
  charsetRange?: string;
  /** 是否启用透明 PNG 修复 */
  pngFix?: boolean;
  /** 是否返回概率信息 */
  probability?: boolean;
  /** 是否把识别文本当作四则运算表达式并返回计算结果 */
  calculateExpression?: boolean;
}

/** ddddocr 响应结构 */
interface DdddOcrResponse {
  code: number;
  msg: string;
  data: { text: string } | null;
}

/** 计算 ddddocr 返回的简单四则表达式 */
function calculateCaptchaExpression(expression: string): string {
  const cleaned = expression.replace(/[=?？]/g, '').trim();
  const match = cleaned.match(/^(\d+)\s*([+\-xX*×÷/])\s*(\d+)$/);
  if (!match) {
    throw new Error(`OCR 数学表达式格式无法解析: "${expression}"`);
  }

  const [, left, operator, right] = match;
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);

  switch (operator) {
    case '+':
      return String(leftNumber + rightNumber);
    case '-':
      return String(leftNumber - rightNumber);
    case 'x':
    case 'X':
    case '*':
    case '×':
      return String(leftNumber * rightNumber);
    case '/':
    case '÷': {
      if (rightNumber === 0) throw new Error('OCR 数学表达式除数不能为 0');
      const result = leftNumber / rightNumber;
      return Number.isInteger(result) ? String(result) : String(result);
    }
    default:
      throw new Error(`OCR 数学表达式运算符无法识别: "${operator}"`);
  }
}

/**
 * 识别图片验证码，返回识别结果字符串
 * @param imgBuffer - 验证码图片数据（Buffer 或 Uint8Array）
 * @param options - ddddocr 请求选项
 * @returns 识别出的文字，识别失败返回空字符串
 */
export async function recognizeCaptcha(
  imgBuffer: Buffer | Uint8Array,
  options: CaptchaOptions = {},
): Promise<string> {
  const base64 = Buffer.from(imgBuffer).toString('base64');
  const payload: {
    image: string;
    charset_range?: string;
    png_fix?: boolean;
    probability?: boolean;
  } = { image: base64 };

  if (options.charsetRange) payload.charset_range = options.charsetRange;
  if (options.pngFix !== undefined) payload.png_fix = options.pngFix;
  if (options.probability !== undefined) payload.probability = options.probability;

  const response = await fetch(OCR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OCR 服务响应异常: ${response.status}`);
  }

  const json = (await response.json()) as DdddOcrResponse;
  if (json.code !== 200 || !json.data) {
    throw new Error(`OCR 服务返回失败: ${json.msg}`);
  }

  const result = json.data.text.trim();

  if (!result) {
    throw new Error('OCR 服务识别结果为空');
  }

  return options.calculateExpression ? calculateCaptchaExpression(result) : result;
}

/**
 * 识别数学运算型验证码，返回计算结果（数字）
 * 表达式格式示例：9+4=?、12-3=?、5*6=?
 *
 * @param imgBuffer - 验证码图片数据
 * @returns 计算结果数字，失败时抛出
 */
export async function recognizeMathCaptcha(imgBuffer: Buffer | Uint8Array): Promise<number> {
  const result = await recognizeCaptcha(imgBuffer, { calculateExpression: true });
  return Number.parseFloat(result);
}
