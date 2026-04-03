import { describe, it, expect, beforeEach } from 'vitest';
import * as http from 'node:http';
import { LocalAiService } from '../services/LocalAiService.js';
import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';

/**
 * Integration tests against real LocalAI server.
 * Skipped by default unless LOCAL_AI_URL is set in environment and server is running.
 * Run: LOCAL_AI_URL=http://localhost:8080 npm run test
 */

//process.env.LOCAL_AI_URL = 'http://localhost:8080'

const skipIfNoLocalAi = !process.env.LOCAL_AI_URL;

const realGame = {
  settings: {
    get: (ns: string, key: string) => {
      if (key === SETTINGS.LOCAL_AI_URL) return process.env.LOCAL_AI_URL;
      if (key === SETTINGS.LOCAL_MODEL) return process.env.LOCAL_MODEL || 'qwen3-8b';
      return undefined;
    },
  },
};

describe.skipIf(skipIfNoLocalAi)('LocalAiService - models endpoint (integration)', { timeout: 15_000 }, () => {
  it('lists available models and includes qwen3.5-9b', async () => {
    const response = await fetch(`${process.env.LOCAL_AI_URL}/v1/models`);
    expect(response.ok).toBe(true);
    const data = await response.json() as { data: { id: string }[] };
    const ids = data.data.map((m) => m.id);
    expect(ids).toContain('qwen3.5-9b');
  });

  it('http.request POST works (undici bypass)', async () => {
    const url = new URL(`${process.env.LOCAL_AI_URL}/v1/chat/completions`);
    const body = JSON.stringify({
      model: process.env.LOCAL_MODEL || 'qwen3.5-9b',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say hi.' }],
    });
    const text = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: url.port, path: url.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          console.log('response headers received, status:', res.statusCode);
          let data = '';
          res.on('data', (chunk) => { console.log('data chunk received, bytes:', chunk.length); data += chunk; });
          res.on('end', () => { console.log('response ended'); resolve(data); });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(text).toBeTruthy();
  });
});

describe.skipIf(skipIfNoLocalAi)('LocalAiService (integration)', { timeout: 50_000 }, () => {
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
