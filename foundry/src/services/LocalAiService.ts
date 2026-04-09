import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, AiResponse, GameData, CallOptions, ChunkType } from './AiService.js';
import { fetchImageAsBase64 } from '../modules/loreIndexUtils.js';

export class LocalAiService implements AiService {
  constructor(private game: GameData) {}

  private get baseURL(): string {
    return (
      (this.game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string) || DEFAULTS.LOCAL_AI_URL
    );
  }

  private model(options?: CallOptions): string {
    return (
      options?.model ||
      (this.game.settings.get(NAMESPACE, SETTINGS.LOCAL_MODEL) as string) ||
      DEFAULTS.LOCAL_MODEL
    );
  }

  async call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<AiResponse> {
    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LocalAI error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const msg = data.choices[0]?.message;
    if (msg?.content || msg?.reasoning) {
      return {
        content: msg.content?.trim() ?? '',
        ...(msg.reasoning ? { reasoning: msg.reasoning.trim() } : {}),
      };
    }
    throw new Error('Unexpected LocalAI response format');
  }

  async callWithImage(
    systemPrompt: string,
    userPrompt: string,
    imageUrl: string,
    options?: CallOptions,
  ): Promise<string> {
    const model = options?.model;
    if (!model) throw new Error('LocalAI vision call requires a model — select one in the wizard.');
    const { base64, mediaType } = await fetchImageAsBase64(imageUrl);
    const dataUrl = `data:${mediaType};base64,${base64}`;
    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        model,
        max_tokens: options?.max_tokens ?? 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: userPrompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LocalAI vision error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('Unexpected LocalAI vision response format');
    return text;
  }

  estimateCost(_inputTokens: number, _outputTokens: number): string {
    return 'free';
  }

  async fetchModels(): Promise<string[]> {
    const res = await fetch(`${this.baseURL}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data: { id: string }[] };
    return data.data.map((m) => m.id).sort();
  }

  async stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string, type: ChunkType) => void,
    options?: CallOptions,
  ): Promise<string> {
    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model(options),
        max_tokens: options?.max_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LocalAI error ${response.status}: ${response.statusText}`);
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
            const reasoning = event.choices[0]?.delta?.reasoning;
            const content = event.choices[0]?.delta?.content;
            if (reasoning) {
              onChunk(reasoning, 'reasoning');
            }
            if (content) {
              fullText += content;
              onChunk(content, 'content');
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
