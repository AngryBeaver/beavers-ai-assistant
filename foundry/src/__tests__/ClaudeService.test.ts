import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../services/ClaudeService.js';
import { NAMESPACE, SETTINGS } from '../definitions.js';

const mockGame = {
  settings: {
    get: vi.fn(),
  },
};

function mockFetch(body: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    body: null,
  });
}

function mockStreamFetch(lines: string[]) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let i = 0;
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
      return Promise.resolve({ done: true, value: undefined });
    }),
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    json: vi.fn(),
  });
}

describe('ClaudeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGame.settings.get.mockImplementation((ns, key) => {
      if (key === SETTINGS.CLAUDE_API_KEY) return 'sk-ant-test-key';
      if (key === SETTINGS.CLAUDE_MODEL) return 'claude-3-sonnet-20240229';
      return undefined;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('call()', () => {
    it('returns text from Claude response', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          content: [{ type: 'text', text: 'Claude response' }],
        }),
      );

      const service = new ClaudeService(mockGame as any);
      const result = await service.call('system', 'user', { max_tokens: 1000 });

      expect(result).toBe('Claude response');
    });

    it('sends correct headers and body', async () => {
      const fetchMock = mockFetch({ content: [{ type: 'text', text: 'ok' }] });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ClaudeService(mockGame as any);
      await service.call('my system', 'my user', { max_tokens: 500, temperature: 0.3 });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers['x-api-key']).toBe('sk-ant-test-key');
      expect(init.headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(init.body);
      expect(body.system).toBe('my system');
      expect(body.messages[0]).toEqual({ role: 'user', content: 'my user' });
      expect(body.max_tokens).toBe(500);
      expect(body.temperature).toBe(0.3);
      expect(body.model).toBe('claude-3-sonnet-20240229');
    });

    it('throws when API key is missing', async () => {
      mockGame.settings.get.mockReturnValue(undefined);

      const service = new ClaudeService(mockGame as any);
      await expect(service.call('system', 'user')).rejects.toThrow(
        'Claude API key is not configured',
      );
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: { message: 'Unauthorized' } }, 401));

      const service = new ClaudeService(mockGame as any);
      await expect(service.call('system', 'user')).rejects.toThrow('Claude API error 401');
    });

    it('throws for unexpected response format', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          content: [{ type: 'image' }],
        }),
      );

      const service = new ClaudeService(mockGame as any);
      await expect(service.call('system', 'user')).rejects.toThrow(
        'Unexpected Claude response format',
      );
    });
  });

  describe('stream()', () => {
    it('streams text chunks and returns full text', async () => {
      vi.stubGlobal(
        'fetch',
        mockStreamFetch([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
          'data: [DONE]',
        ]),
      );

      const service = new ClaudeService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (c) => chunks.push(c));

      expect(chunks).toEqual(['Hello', ' world']);
      expect(result).toBe('Hello world');
    });

    it('ignores non-text-delta events', async () => {
      vi.stubGlobal(
        'fetch',
        mockStreamFetch([
          'data: {"type":"message_start"}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Only this"}}',
          'data: {"type":"message_stop"}',
        ]),
      );

      const service = new ClaudeService(mockGame as any);
      const chunks: string[] = [];
      await service.stream('system', 'user', (c) => chunks.push(c));

      expect(chunks).toEqual(['Only this']);
    });

    it('sends stream: true in body', async () => {
      const fetchMock = mockStreamFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      const service = new ClaudeService(mockGame as any);
      await service.stream('system', 'user', () => {});

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });
});
