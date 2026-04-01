import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../services/ClaudeService.js';
import { NAMESPACE, SETTINGS } from '../definitions.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: vi.fn(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  })),
}));

const mockGame = {
  settings: {
    get: vi.fn(),
  },
};

describe('ClaudeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGame.settings.get.mockImplementation((ns, key) => {
      if (key === SETTINGS.CLAUDE_API_KEY) return 'sk-ant-test-key-abc123';
      if (key === SETTINGS.CLAUDE_MODEL) return 'claude-3-sonnet-20240229';
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('call()', () => {
    it('returns text from Claude response', async () => {
      // Actual documented response structure from Anthropic SDK
      mockCreate.mockResolvedValue({
        id: 'msg_1234567890abcdef',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'This is the Claude response',
          },
        ],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 25,
        },
      });

      const service = new ClaudeService(mockGame as any);
      const result = await service.call('You are a helpful assistant.', 'What is 2+2?', {
        max_tokens: 1000,
      });

      expect(result).toBe('This is the Claude response');
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        temperature: 0.7,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('uses settings to get model and API key', async () => {
      mockGame.settings.get.mockImplementation((ns, key) => {
        if (key === SETTINGS.CLAUDE_API_KEY) return 'sk-ant-custom-key';
        if (key === SETTINGS.CLAUDE_MODEL) return 'claude-3-opus-20240229';
        return undefined;
      });

      mockCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 10 },
      });

      const service = new ClaudeService(mockGame as any);
      await service.call('system', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus-20240229',
        }),
      );
    });

    it('throws error when API key is not configured', async () => {
      mockGame.settings.get.mockReturnValue(undefined);

      const service = new ClaudeService(mockGame as any);

      await expect(service.call('system', 'user')).rejects.toThrow(
        'Claude API key is not configured',
      );
    });

    it('throws error for unexpected response format', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } },
        ],
      });

      const service = new ClaudeService(mockGame as any);

      await expect(service.call('system', 'user')).rejects.toThrow(
        'Unexpected Claude response format',
      );
    });

    it('respects custom temperature and max_tokens', async () => {
      mockCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 10 },
      });

      const service = new ClaudeService(mockGame as any);
      await service.call('system', 'user', { temperature: 0.3, max_tokens: 500 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          max_tokens: 500,
        }),
      );
    });
  });

  describe('stream()', () => {
    it('streams text chunks and returns full text', async () => {
      // Mock async generator for streaming
      const mockAsyncGen = async function* () {
        yield {
          type: 'content_block_start',
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        };
        yield {
          type: 'message_stop',
        };
      };

      mockStream.mockReturnValue(mockAsyncGen());

      const service = new ClaudeService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual(['Hello', ' world']);
      expect(result).toBe('Hello world');
    });

    it('ignores non-text-delta chunks', async () => {
      const mockAsyncGen = async function* () {
        yield {
          type: 'content_block_start',
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Part 1' },
        };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' Part 2' },
        };
      };

      mockStream.mockReturnValue(mockAsyncGen());

      const service = new ClaudeService(mockGame as any);
      const chunks: string[] = [];
      const result = await service.stream('system', 'user', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual(['Part 1', ' Part 2']);
      expect(result).toBe('Part 1 Part 2');
    });

    it('calls onChunk callback for each chunk', async () => {
      const mockAsyncGen = async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'chunk1' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'chunk2' },
        };
      };

      mockStream.mockReturnValue(mockAsyncGen());

      const service = new ClaudeService(mockGame as any);
      const onChunk = vi.fn();
      await service.stream('system', 'user', onChunk);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'chunk1');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'chunk2');
    });

    it('passes stream parameters to SDK', async () => {
      mockStream.mockReturnValue(
        (async function* () {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'response' },
          };
        })(),
      );

      const service = new ClaudeService(mockGame as any);
      await service.stream('system', 'user', () => {}, { temperature: 0.5, max_tokens: 2000 });

      expect(mockStream).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        temperature: 0.5,
        system: 'system',
        messages: [{ role: 'user', content: 'user' }],
      });
    });
  });
});
