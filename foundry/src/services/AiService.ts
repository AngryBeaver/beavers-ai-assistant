import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import type { AiProvider } from '../definitions.js';
import { ClaudeService } from './ClaudeService.js';
import { LocalAiService } from './LocalAiService.js';

export interface GameData {
  settings: {
    get(namespace: string, key: string): unknown;
  };
}

export interface CallOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  thinking?: boolean;
  /** Controls reasoning depth for thinking models (e.g. qwen3). Values: "none" | "low" | "medium" | "high" */
  reasoning_effort?: string;
  signal?: AbortSignal;
}

export type ChunkType = 'content' | 'reasoning';

export interface AiResponse {
  content: string;
  reasoning?: string;
}

export interface AiService {
  call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<AiResponse>;
  stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string, type: ChunkType) => void,
    options?: CallOptions,
  ): Promise<string>;
  /** Vision call — optional; throws a descriptive error if not supported. */
  callWithImage?(
    systemPrompt: string,
    userPrompt: string,
    imageUrl: string,
    options?: CallOptions,
  ): Promise<string>;
  estimateCost(inputTokens: number, outputTokens: number): string;
  fetchModels(): Promise<string[]>;
}

export namespace AiService {
  /**
   * Create the appropriate AI service for the given game context.
   *
   * @param game     Foundry game object (or compatible mock).
   * @param provider Optional override — when omitted the stored setting is used.
   */
  export function create(game: GameData, provider?: AiProvider): AiService {
    const resolved: string =
      provider ??
      (game.settings.get(NAMESPACE, SETTINGS.AI_PROVIDER) as string) ??
      DEFAULTS.AI_PROVIDER;
    return resolved === 'claude' ? new ClaudeService(game) : new LocalAiService(game);
  }

  const _instances = new Map<string, AiService>();

  /**
   * Return a cached singleton for the given provider, creating it on first use.
   * Uses the global Foundry `game` object — do not call before game is ready.
   */
  export function get(provider: AiProvider): AiService {
    if (!_instances.has(provider)) {
      _instances.set(provider, create(game as unknown as GameData, provider));
    }
    return _instances.get(provider)!;
  }
}
