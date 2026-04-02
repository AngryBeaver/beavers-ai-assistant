import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, GameData, CallOptions } from './AiService.js';

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

  async call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(
        `Claude API error ${response.status}: ${err?.error?.message || response.statusText}`,
      );
    }

    const data = (await response.json()) as any;
    if (data.content[0]?.type === 'text') {
      return data.content[0].text;
    }
    throw new Error('Unexpected Claude response format');
  }

  async stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void,
    options?: CallOptions,
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
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
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text || '';
            fullText += text;
            onChunk(text);
          }
        } catch {
          // malformed SSE line, skip
        }
      }
    }

    return fullText;
  }
}
