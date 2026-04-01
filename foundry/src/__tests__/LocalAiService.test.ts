import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalAiService } from '../services/LocalAiService.js';
import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';

// Mock the OpenAI SDK
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('openai', () => ({
  OpenAI: vi.fn(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

const mockGame = {
  settings: {
    get: vi.fn(),
  },
};

describe('LocalAiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGame.settings.get.mockImplementation((ns, key) => {
      if (key === SETTINGS.LOCAL_AI_URL) return 'http://localhost:8000/v1';
      if (key === SETTINGS.LOCAL_MODEL) return 'mistral';
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('call()', () => {
    it('returns text from LocalAI response', async () => {
      // Actual documented response structure from OpenAI SDK
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-8eydK7znQBjvhqT7J6xnx0KT9ABCD',
        object: 'text_completion',
        created: 1699564200,
        model: 'mistral',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'This is the LocalAI response',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      });

      const service = new LocalAiService(mockGame as any);
      const result = await service.call('You are helpful.', 'What is 2+2?', {
        max_tokens: 512,
      });

      expect(result).toBe('This is the LocalAI response');
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'mistral',
        max_tokens: 512,
        temperature: 0.7,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('uses settings to get model and base URL', async () => {
      mockGame.settings.get.mockImplementation((ns, key) => {
        if (key === SETTINGS.LOCAL_AI_URL) return 'http://192.168.1.100:8000/v1';
        if (key === SETTINGS.LOCAL_MODEL) return 'neural-chat';
        return undefined;
      });

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'text_completion',
        created: 1699564200,
        model: 'neural-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      });

      const service = new LocalAiService(mockGame as any);
      await service.call('system', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'neural-chat',
        }),
      );
    });

    it('defaults to mistral model when not configured', async () => {
      mockGame.settings.get.mockReturnValue(undefined);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'text_completion',
        created: 1699564200,
        model: 'mistral',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      });

      const service = new LocalAiService(mockGame as any);
      await service.call('system', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'mistral',
        }),
      );
    });

    it('throws error for unexpected response format', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'text_completion',
        created: 1699564200,
        model: 'mistral',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          },
        ],
      });

      const service = new LocalAiService(mockGame as any);

      await expect(service.call('system', 'user')).rejects.toThrow(
        'Unexpected LocalAI response format',
      );
    });

    it('respects custom temperature and max_tokens', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'text_completion',
        created: 1699564200,
        model: 'mistral',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      });

      const service = new LocalAiService(mockGame as any);
      await service.call('system', 'user', { temperature: 0.2, max_tokens: 256 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
          max_tokens: 256,
        }),
      );
    });
  });

  describe('stream()', () => {
    it('streams text chunks and returns full text', async () => {
      // Mock async generator for streaming
      const mockAsyncGen = async function* () {
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Hello' },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { content: ' world' },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { content: null },
              finish_reason: 'stop',
            },
          ],
        };
      };

      mockCreate.mockReturnValue(mockAsyncGen());

      const service = new LocalAiService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual(['Hello', ' world']);
      expect(result).toBe('Hello world');
    });

    it('ignores chunks with no content', async () => {
      const mockAsyncGen = async function* () {
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { content: 'actual content' },
              finish_reason: null,
            },
          ],
        };
      };

      mockCreate.mockReturnValue(mockAsyncGen());

      const service = new LocalAiService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual(['actual content']);
      expect(result).toBe('actual content');
    });

    it('calls onChunk callback for each chunk', async () => {
      const mockAsyncGen = async function* () {
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { content: 'chunk1' },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: 'chatcmpl-test',
          object: 'text_completion.chunk',
          created: 1699564200,
          model: 'mistral',
          choices: [
            {
              index: 0,
              delta: { content: 'chunk2' },
              finish_reason: null,
            },
          ],
        };
      };

      mockCreate.mockReturnValue(mockAsyncGen());

      const service = new LocalAiService(mockGame as any);
      const onChunk = vi.fn();
      await service.stream('system', 'user', onChunk);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'chunk1');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'chunk2');
    });

    it('passes stream parameters to SDK', async () => {
      mockCreate.mockReturnValue(
        (async function* () {
          yield {
            id: 'chatcmpl-test',
            object: 'text_completion.chunk',
            created: 1699564200,
            model: 'mistral',
            choices: [
              {
                index: 0,
                delta: { content: 'response' },
                finish_reason: null,
              },
            ],
          };
        })(),
      );

      const service = new LocalAiService(mockGame as any);
      await service.stream('system', 'user', () => {}, { temperature: 0.4, max_tokens: 1024 });

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'mistral',
        max_tokens: 1024,
        temperature: 0.4,
        stream: true,
        system: 'system',
        messages: [{ role: 'user', content: 'user' }],
      });
    });
  });
});
