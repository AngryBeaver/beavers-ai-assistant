import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalAiService } from '../services/LocalAiService.js';
import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';

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
    releaseLock: vi.fn(),
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    json: vi.fn(),
  });
}

describe('LocalAiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGame.settings.get.mockImplementation((ns, key) => {
      if (key === SETTINGS.LOCAL_AI_URL) return 'http://localhost:8080';
      if (key === SETTINGS.LOCAL_MODEL) return 'mistral';
      return undefined;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('call()', () => {
    it('returns text from LocalAI response', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          choices: [{ message: { content: 'LocalAI response' } }],
        }),
      );

      const service = new LocalAiService(mockGame as any);
      const result = await service.call('system', 'user', { max_tokens: 512 });

      expect(result).toEqual({ content: 'LocalAI response' });
    });

    it('sends system as a message role', async () => {
      const fetchMock = mockFetch({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', fetchMock);

      const service = new LocalAiService(mockGame as any);
      await service.call('my system', 'my user', { max_tokens: 256, temperature: 0.2 });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/chat/completions');

      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'my system' },
        { role: 'user', content: 'my user' },
      ]);
      expect(body.max_tokens).toBe(256);
      expect(body.temperature).toBe(0.2);
      expect(body.model).toBe('mistral');
    });

    it('defaults to LOCAL_MODEL when not configured', async () => {
      mockGame.settings.get.mockReturnValue(undefined);
      const fetchMock = mockFetch({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', fetchMock);

      const service = new LocalAiService(mockGame as any);
      await service.call('system', 'user');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe(DEFAULTS.LOCAL_MODEL);
    });

    it('returns reasoning when content is empty (thinking model)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          choices: [{ message: { content: '', reasoning: 'some reasoning' } }],
        }),
      );

      const service = new LocalAiService(mockGame as any);
      const result = await service.call('system', 'user');

      expect(result).toEqual({ content: '', reasoning: 'some reasoning' });
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 500));

      const service = new LocalAiService(mockGame as any);
      await expect(service.call('system', 'user')).rejects.toThrow('LocalAI error 500');
    });

    it('throws for unexpected response format', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          choices: [{ message: { content: null } }],
        }),
      );

      const service = new LocalAiService(mockGame as any);
      await expect(service.call('system', 'user')).rejects.toThrow(
        'Unexpected LocalAI response format',
      );
    });
  });

  describe('stream()', () => {
    it('streams text chunks and returns full text', async () => {
      vi.stubGlobal(
        'fetch',
        mockStreamFetch([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}',
          'data: {"choices":[{"delta":{"content":" world"}}]}',
          'data: [DONE]',
        ]),
      );

      const service = new LocalAiService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (c) => chunks.push(c));

      expect(chunks).toEqual(['Hello', ' world']);
      expect(result).toBe('Hello world');
    });

    it('ignores chunks with no content', async () => {
      vi.stubGlobal(
        'fetch',
        mockStreamFetch([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}',
          'data: {"choices":[{"delta":{"content":"actual"}}]}',
        ]),
      );

      const service = new LocalAiService(mockGame as any);
      const chunks: string[] = [];
      await service.stream('system', 'user', (c) => chunks.push(c));

      expect(chunks).toEqual(['actual']);
    });

    it('emits reasoning chunks with type reasoning, content chunks with type content', async () => {
      vi.stubGlobal(
        'fetch',
        mockStreamFetch([
          'data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}',
          'data: {"choices":[{"delta":{"content":"answer"}}]}',
          'data: [DONE]',
        ]),
      );

      const service = new LocalAiService(mockGame as any);
      const received: { chunk: string; type: string }[] = [];
      const result = await service.stream('system', 'user', (chunk, type) =>
        received.push({ chunk, type }),
      );

      expect(received).toEqual([
        { chunk: 'thinking...', type: 'reasoning' },
        { chunk: 'answer', type: 'content' },
      ]);
      expect(result).toBe('answer');
    });

    it('sends stream: true in body', async () => {
      const fetchMock = mockStreamFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      const service = new LocalAiService(mockGame as any);
      await service.stream('system', 'user', () => {});

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });
});
