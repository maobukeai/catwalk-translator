import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidTranslation,
  fetchDeepLTranslate,
  fetchBingTranslate,
  fetchBaiduTranslate,
} from '../services/tauri';

describe('Online Translation Guard & Robustness Test Suite', () => {
  const originalFetch = window.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  describe('isValidTranslation Validation Guard', () => {
    it('accepts valid translation candidate text', () => {
      expect(isValidTranslation('Principled BSDF', '原理化 BSDF')).toBe(true);
      expect(isValidTranslation('Roughness', '粗糙度')).toBe(true);
      expect(isValidTranslation('Hello World', '你好世界')).toBe(true);
    });

    it('rejects empty or whitespace candidate strings', () => {
      expect(isValidTranslation('', '')).toBe(false);
      expect(isValidTranslation('test', '')).toBe(false);
      expect(isValidTranslation('test', '   \t\n  ')).toBe(false);
      expect(isValidTranslation('   ', 'test')).toBe(false);
    });

    it('intercepts DeepL / proxy rate-limit risk-control URLs (e.g. linux.do)', () => {
      expect(isValidTranslation('Principled BSDF', 'https://linux.do/t/topic/111737')).toBe(false);
      expect(isValidTranslation('Roughness', 'http://linux.do/t/12345')).toBe(false);
      expect(isValidTranslation('Normal', 'https://t.me/deeplx_channel')).toBe(false);
      expect(isValidTranslation('Camera', 'https://deeplx.vercel.app/error')).toBe(false);
      expect(isValidTranslation('Light', 'www.linux.do')).toBe(false);
      // Valid if original text itself was a URL
      expect(isValidTranslation('https://linux.do/t/topic/111737', 'https://linux.do/t/topic/111737')).toBe(true);
    });

    it('intercepts HTML gateway error pages', () => {
      expect(
        isValidTranslation(
          'Principled BSDF',
          '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>'
        )
      ).toBe(false);
      expect(
        isValidTranslation('Principled BSDF', '<html><body><script>location.href="error"</script></body></html>')
      ).toBe(false);
      expect(isValidTranslation('Roughness', '<div class="error">403 Forbidden</div>')).toBe(false);
    });

    it('intercepts JSON error payloads', () => {
      expect(isValidTranslation('Principled BSDF', '{"code": 429, "message": "Too Many Requests"}')).toBe(false);
      expect(isValidTranslation('Roughness', '{"error": "Rate limit exceeded"}')).toBe(false);
      expect(isValidTranslation('Normal', '{"msg": "IP has been blocked"}')).toBe(false);
    });

    it('intercepts rate-limit and gateway error keywords', () => {
      expect(isValidTranslation('Principled BSDF', 'Too Many Requests')).toBe(false);
      expect(isValidTranslation('Roughness', 'Rate limit exceeded, please try again later')).toBe(false);
      expect(isValidTranslation('Metallic', '请求过于频繁，请稍后再试')).toBe(false);
      expect(isValidTranslation('Normal', 'IP has been blocked')).toBe(false);
      expect(isValidTranslation('Specular', '502 Bad Gateway')).toBe(false);
    });
  });

  describe('fetchDeepLTranslate Robust Multi-node Pool & Guard', () => {
    it('successfully extracts translation on code 200', async () => {
      window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 200, data: '原理化 BSDF', id: 12345 }),
      } as Response);

      const res = await fetchDeepLTranslate('Principled BSDF', 'en', 'zh-CN');
      expect(res).toBe('原理化 BSDF');
    });

    it('rejects poisoned risk control link and tries next node or throws', async () => {
      // First node returns poisoned link
      const node1 = {
        ok: true,
        json: async () => ({ code: 200, data: 'https://linux.do/t/topic/111737' }),
      };
      // Second node returns code 429
      const node2 = {
        ok: true,
        json: async () => ({ code: 429, message: 'Too Many Requests' }),
      };
      // Third node succeeds with clean translation
      const node3 = {
        ok: true,
        json: async () => ({ code: 200, target_text: '粗糙度' }),
      };

      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(node1 as Response)
        .mockResolvedValueOnce(node2 as Response)
        .mockResolvedValueOnce(node3 as Response);

      const res = await fetchDeepLTranslate('Roughness', 'en', 'zh-CN');
      expect(res).toBe('粗糙度');
    });
  });

  describe('fetchBingTranslate Edge Official Endpoint', () => {
    it('fetches auth token and queries api-edge.cognitive.microsofttranslator.com with Bearer token', async () => {
      const authResponse = {
        ok: true,
        text: async () => 'mock-jwt-token-12345',
      };
      const transResponse = {
        ok: true,
        json: async () => [{ translations: [{ text: '原理化 BSDF' }] }],
      };

      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(authResponse as Response)
        .mockResolvedValueOnce(transResponse as Response);

      const res = await fetchBingTranslate('Principled BSDF', 'en', 'zh-CN');
      expect(res).toBe('原理化 BSDF');

      expect(window.fetch).toHaveBeenCalledWith(
        'https://edge.microsoft.com/translate/auth',
        expect.anything()
      );
      expect(window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api-edge.cognitive.microsofttranslator.com/translate'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token-12345',
          }),
        })
      );
    });
  });

  describe('fetchBaiduTranslate Sentence-level transapi endpoint', () => {
    it('uses fanyi.baidu.com/transapi and correctly joins dst fields', async () => {
      const transResponse = {
        ok: true,
        json: async () => ({
          from: 'en',
          to: 'zh',
          data: [
            { src: 'Principled BSDF', dst: '原理化 BSDF' },
            { src: 'Roughness', dst: '粗糙度' },
          ],
        }),
      };

      window.fetch = vi.fn().mockResolvedValueOnce(transResponse as Response);

      const res = await fetchBaiduTranslate('Principled BSDF\nRoughness', 'en', 'zh-CN');
      expect(res).toBe('原理化 BSDF\n粗糙度');
      expect(window.fetch).toHaveBeenCalledWith(
        'https://fanyi.baidu.com/transapi',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('falls back to sug endpoint for single words if transapi fails', async () => {
      const transFail = {
        ok: false,
        status: 500,
      };
      const sugResponse = {
        ok: true,
        json: async () => ({
          data: [{ k: 'roughness', v: 'n. 粗糙度' }],
        }),
      };

      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(transFail as Response)
        .mockResolvedValueOnce(sugResponse as Response);

      const res = await fetchBaiduTranslate('roughness', 'en', 'zh-CN');
      expect(res).toBe('n. 粗糙度');
    });
  });
});
