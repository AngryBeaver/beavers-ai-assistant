import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeService } from '../services/ClaudeService.js';
import { NAMESPACE, SETTINGS } from '../definitions.js';

/**
 * Integration tests against real Claude API.
 * Skipped by default unless CLAUDE_API_KEY is set in environment.
 * Run: CLAUDE_API_KEY=sk-ant-... npm run test
 */

const skipIfNoApiKey = !process.env.CLAUDE_API_KEY;

const realGame = {
  settings: {
    get: (ns: string, key: string) => {
      if (key === SETTINGS.CLAUDE_API_KEY) return process.env.CLAUDE_API_KEY;
      if (key === SETTINGS.CLAUDE_MODEL) return 'claude-3-5-haiku-20241022';
      return undefined;
    },
  },
};

describe.skipIf(skipIfNoApiKey)('ClaudeService (integration)', () => {
  let service: ClaudeService;

  beforeEach(() => {
    service = new ClaudeService(realGame as any);
  });

  it('calls real Claude API and gets a text response', async () => {
    const result = await service.call(
      'You are a helpful assistant.',
      'Say "Hello, World!" and nothing else.',
      {
        max_tokens: 100,
      },
    );

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Hello');
  });

  it('streams text from real Claude API', async () => {
    const chunks: string[] = [];
    const result = await service.stream(
      'You are a concise assistant.',
      'Count from 1 to 3.',
      (chunk) => chunks.push(chunk),
      { max_tokens: 50 },
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(result).toBeTruthy();
    expect(result).toContain('1');
  });

  it('respects max_tokens constraint', async () => {
    const result = await service.call(
      'You are verbose.',
      'Tell me about Claude AI in great detail.',
      { max_tokens: 50 },
    );

    // Very rough heuristic: 50 tokens is roughly 37-50 words
    const wordCount = result.split(/\s+/).length;
    expect(wordCount).toBeLessThan(100);
  });

  it('handles different temperatures', async () => {
    const creative = await service.call(
      'You are creative and random.',
      'Give a made-up animal name.',
      { temperature: 0.9, max_tokens: 20 },
    );

    const conservative = await service.call('You are factual and conservative.', 'What is 2+2?', {
      temperature: 0.1,
      max_tokens: 20,
    });

    expect(creative).toBeTruthy();
    expect(conservative).toContain('4');
  });
});
