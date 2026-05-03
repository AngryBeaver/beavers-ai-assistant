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

  private _noThink(options?: CallOptions): boolean {
    return !options?.reasoning_effort || options.reasoning_effort === 'none';
  }

  private _systemPrompt(systemPrompt: string, options?: CallOptions): string {
    return this._noThink(options) ? `/no_think\n${systemPrompt}` : systemPrompt;
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
        ...(options?.reasoning_effort ? { reasoning_effort: options.reasoning_effort } : {}),
        messages: [
          { role: 'system', content: this._systemPrompt(systemPrompt, options) },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LocalAI error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];
    const finishReason = choice?.finish_reason;
    if (finishReason === 'length') {
      throw new Error(
        'LocalAI: context length exceeded — output was truncated. Reduce input size or increase context limit.',
      );
    }
    if (finishReason === 'error') {
      throw new Error('LocalAI: model returned finish_reason=error. Check model logs for details.');
    }
    const msg = choice?.message;
    if (msg?.content || msg?.reasoning) {
      let content: string = msg.content?.trim() ?? '';
      let reasoning: string = msg.reasoning?.trim() ?? '';
      // qwen3 routes both thinking and answer through msg.reasoning.
      // If content is empty, split on </think> to extract the answer.
      if (!content && reasoning) {
        const thinkEnd = reasoning.indexOf('</think>');
        if (thinkEnd >= 0) {
          content = reasoning.slice(thinkEnd + 8).trimStart();
          reasoning = reasoning.slice(0, thinkEnd).trim();
        } else {
          // No </think> — thinking disabled, whole reasoning is the answer.
          content = reasoning;
          reasoning = '';
        }
      }
      return { content, ...(reasoning ? { reasoning } : {}) };
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
    const msg = data.choices?.[0]?.message;
    const text = (msg?.content?.trim() || msg?.reasoning?.trim()) ?? '';
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
        ...(options?.reasoning_effort ? { reasoning_effort: options.reasoning_effort } : {}),
        messages: [
          { role: 'system', content: this._systemPrompt(systemPrompt, options) },
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
    let sseBuffer = '';
    // qwen3 routes both thinking and answer through delta.reasoning.
    // Strategy:
    //   - If reasoning starts with <think>: stream thinking chunks out as
    //     'reasoning' in real-time; switch to 'content' after </think>.
    //   - If reasoning does NOT start with <think>: thinking is disabled,
    //     buffer silently and emit the whole thing as 'content' at stream end.
    let reasoningBuf = '';
    let inThink = false; // currently inside a <think> block
    let pastThink = false; // </think> already seen, now streaming the answer

    const handleReasoning = (chunk: string): void => {
      if (pastThink) {
        fullText += chunk;
        onChunk(chunk, 'content');
        return;
      }

      reasoningBuf += chunk;

      if (!inThink) {
        // Wait until we have enough to detect the opening tag.
        if (reasoningBuf.length < 7 && !reasoningBuf.includes('<think>')) return;

        if (reasoningBuf.startsWith('<think>')) {
          inThink = true;
          // Emit the opening tag itself as reasoning so listeners see it.
          // Fall through to the inThink path below to flush the buffer.
        } else {
          // No <think> — thinking disabled. Keep buffering silently.
          return;
        }
      }

      // Inside <think> block: check for closing tag.
      const thinkEnd = reasoningBuf.indexOf('</think>');
      if (thinkEnd >= 0) {
        pastThink = true;
        inThink = false;
        const thinkPart = reasoningBuf.slice(0, thinkEnd);
        if (thinkPart) onChunk(thinkPart, 'reasoning');
        const answerPart = reasoningBuf.slice(thinkEnd + 8).trimStart();
        reasoningBuf = '';
        if (answerPart) {
          fullText += answerPart;
          onChunk(answerPart, 'content');
        }
      } else {
        // Still inside <think> — stream out all but the last 7 chars
        // (guard against </think> spanning two chunks).
        const safe = reasoningBuf.length > 7 ? reasoningBuf.length - 7 : 0;
        if (safe > 0) {
          onChunk(reasoningBuf.slice(0, safe), 'reasoning');
          reasoningBuf = reasoningBuf.slice(safe);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const event = JSON.parse(raw) as any;

            if (event.error) {
              throw new Error(
                `LocalAI stream error: ${event.error.message ?? JSON.stringify(event.error)}`,
              );
            }

            const choice = event.choices?.[0];
            const finishReason = choice?.finish_reason;
            if (finishReason === 'length') {
              throw new Error(
                'LocalAI: context length exceeded — output was truncated. Reduce input size or increase context limit.',
              );
            }
            if (finishReason === 'error') {
              throw new Error(
                'LocalAI: model returned finish_reason=error. Check model logs for details.',
              );
            }

            const delta = choice?.delta;
            if (delta?.reasoning) handleReasoning(delta.reasoning);
            if (delta?.content) {
              // If reasoning arrived without <think> tags but now content also arrives,
              // it's a dedicated reasoning field (deepseek-style) — flush as reasoning.
              if (reasoningBuf && !inThink && !pastThink) {
                onChunk(reasoningBuf, 'reasoning');
                reasoningBuf = '';
              }
              fullText += delta.content;
              onChunk(delta.content, 'content');
            }
          } catch (chunkErr) {
            if ((chunkErr as Error).message.startsWith('LocalAI')) throw chunkErr;
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

    // Flush remaining buffer.
    if (reasoningBuf) {
      if (!pastThink && !inThink) {
        // Never saw <think> — thinking disabled, whole buffer is the answer.
        fullText = reasoningBuf;
        onChunk(reasoningBuf, 'content');
      } else {
        // Tail of a <think> block (stream ended before </think>, or leftover
        // guard bytes after </think>). Emit as reasoning.
        onChunk(reasoningBuf, 'reasoning');
      }
    }

    return fullText;
  }
}
