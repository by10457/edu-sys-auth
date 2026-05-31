import { afterEach, describe, expect, it, vi } from 'vitest';
import { recognizeCaptcha, recognizeMathCaptcha } from '../app/utils/ocr.ts';

describe('ocr utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls ddddocr service with spider compatible payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'ok', data: { text: 'A1b2' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await recognizeCaptcha(Buffer.from('image'), {
      charsetRange: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      pngFix: true,
    });

    expect(result).toBe('A1b2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('OCR 请求体应该是 JSON 字符串');
    expect(JSON.parse(body)).toMatchObject({
      image: Buffer.from('image').toString('base64'),
      charset_range: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      png_fix: true,
    });
  });

  it('calculates math captcha result locally', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'ok', data: { text: '9+4=?' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(recognizeMathCaptcha(Buffer.from('image'))).resolves.toBe(13);
  });
});
