import { describe, it, expect, vi } from 'vitest';
import * as services from '../services/index.js';

describe('services/index exports', () => {
  it('exports ClaudeService class', () => {
    expect(services.ClaudeService).toBeDefined();
  });

  it('exports LocalAiService class', () => {
    expect(services.LocalAiService).toBeDefined();
  });

  it('exports createAiService factory function', () => {
    expect(services.createAiService).toBeDefined();
    expect(typeof services.createAiService).toBe('function');
  });

  it('createAiService returns ClaudeService when provider is claude', () => {
    const mockGame = {
      settings: {
        get: vi.fn((ns, key) => 'claude'),
      },
    };

    const service = services.createAiService(mockGame as any);
    expect(service).toBeInstanceOf(services.ClaudeService);
  });

  it('createAiService returns LocalAiService when provider is local-ai', () => {
    const mockGame = {
      settings: {
        get: vi.fn((ns, key) => 'local-ai'),
      },
    };

    const service = services.createAiService(mockGame as any);
    expect(service).toBeInstanceOf(services.LocalAiService);
  });

  it('createAiService defaults to claude when provider setting is missing', () => {
    const mockGame = {
      settings: {
        get: vi.fn(() => undefined),
      },
    };

    const service = services.createAiService(mockGame as any);
    expect(service).toBeInstanceOf(services.ClaudeService);
  });
});
