import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, AiResponse, GameData, CallOptions, ChunkType } from './AiService.js';
import { fetchImageAsBase64 } from '../modules/loreIndexUtils.js';

export class ClaudeService implements AiService {
  constructor(private game: GameData) {}

  private get apiKey(): string {
    const key = this.game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string;
    if (!key) throw new Error('Claude API key is not configured');
    return key;
  }

  private model(options?: CallOptions): string {
    return (
      options?.model ||
      (this.game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string) ||
      DEFAULTS.CLAUDE_MODEL
    );
  }

  private thinkingBody(options?: CallOptions): object {
    return options?.thinking ? { thinking: { type: 'adaptive' } } : {};
  }

  async call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<AiResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        ...this.thinkingBody(options),
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(
        `Claude API error ${response.status}: ${err?.error?.message || response.statusText}`,
      );
    }

    const data = (await response.json()) as any;
    const blocks: any[] = data.content ?? [];
    const content = blocks.find((b) => b.type === 'text')?.text ?? '';
    const reasoning = blocks.find((b) => b.type === 'thinking')?.thinking;
    if (content || reasoning) {
      return { content, ...(reasoning ? { reasoning } : {}) };
    }
    throw new Error('Unexpected Claude response format');
  }

  async callWithImage(
    systemPrompt: string,
    userPrompt: string,
    imageUrl: string,
    options?: CallOptions,
  ): Promise<string> {
    const { base64, mediaType } = await fetchImageAsBase64(imageUrl);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens ?? 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: userPrompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(
        `Claude API error ${response.status}: ${err?.error?.message || response.statusText}`,
      );
    }

    const data = (await response.json()) as any;
    const text = (data.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
    if (!text) throw new Error('Unexpected Claude vision response format');
    return text;
  }

  estimateCost(inputTokens: number, outputTokens: number): string {
    if (inputTokens === 0) return '—';
    const [inputRate, outputRate] = ClaudeService._ratesForModel(this.model());
    const cost = (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
    return cost < 0.01 ? '< $0.01' : `~$${cost.toFixed(2)}`;
  }

  async fetchModels(): Promise<string[]> {
    return ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];
  }

  private static _ratesForModel(model: string): [number, number] {
    if (model.includes('haiku')) return [0.8, 4];
    if (model.includes('opus')) return [15, 75];
    return [3, 15]; // sonnet default
  }

  async stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string, type: ChunkType) => void,
    options?: CallOptions,
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
        ...this.thinkingBody(options),
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(
        `Claude API error ${response.status}: ${err?.error?.message || response.statusText}`,
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const event = JSON.parse(raw) as any;
            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'thinking_delta') {
                onChunk(event.delta.thinking || '', 'reasoning');
              } else if (event.delta?.type === 'text_delta') {
                const text = event.delta.text || '';
                fullText += text;
                onChunk(text, 'content');
              }
            }
          } catch {
            // malformed SSE line, skip
          }
        }
      }
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') throw err;
      throw err;
    } finally {
      reader.releaseLock();
    }

    return fullText;
  }
}
