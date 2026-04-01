import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAiService } from '../services/LocalAiService.js';
import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';

/**
 * Integration tests against real LocalAI server.
 * Skipped by default unless LOCAL_AI_URL is set in environment and server is running.
 * Run: LOCAL_AI_URL=http://localhost:8000/v1 npm run test
 */

const skipIfNoLocalAi = !process.env.LOCAL_AI_URL;

const realGame = {
  settings: {
    get: (ns: string, key: string) => {
      if (key === SETTINGS.LOCAL_AI_URL) return process.env.LOCAL_AI_URL;
      if (key === SETTINGS.LOCAL_MODEL) return process.env.LOCAL_MODEL || 'mistral';
      return undefined;
    },
  },
};

describe.skipIf(skipIfNoLocalAi)('LocalAiService (integration)', () => {
  let service: LocalAiService;

  beforeEach(() => {
    service = new LocalAiService(realGame as any);
  });

  it('calls real LocalAI server and gets a text response', async () => {
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

  it('streams text from real LocalAI server', async () => {
    const chunks: string[] = [];
    const result = await service.stream(
      'You are a concise assistant.',
      'Count from 1 to 3.',
      (chunk) => chunks.push(chunk),
      { max_tokens: 100 },
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(result).toBeTruthy();
    expect(result).toContain('1');
  });

  it('respects max_tokens constraint', async () => {
    const result = await service.call(
      'You are verbose.',
      'Tell me about artificial intelligence in great detail.',
      { max_tokens: 50 },
    );

    // Very rough heuristic: 50 tokens is roughly 37-50 words
    const wordCount = result.split(/\s+/).length;
    expect(wordCount).toBeLessThan(120);
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
