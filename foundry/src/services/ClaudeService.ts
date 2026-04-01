import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, GameData, CallOptions } from './AiService.js';

export class ClaudeService implements AiService {
  private anthropic: any = null;

  constructor(private game: GameData) {}

  private async getClient() {
    if (!this.anthropic) {
      const { Anthropic } = await import('@anthropic-ai/sdk');
      const apiKey = this.game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string;
      if (!apiKey) throw new Error('Claude API key is not configured');
      this.anthropic = new Anthropic({ apiKey });
    }
    return this.anthropic;
  }

  async call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<string> {
    const client = await this.getClient();
    const model =
      options?.model ||
      (this.game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string) ||
      DEFAULTS.CLAUDE_MODEL;

    const response = await client.messages.create({
      model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (response.content[0]?.type === 'text') {
      return response.content[0].text;
    }
    throw new Error('Unexpected Claude response format');
  }

  async stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void,
    options?: CallOptions,
  ): Promise<string> {
    const client = await this.getClient();
    const model =
      options?.model ||
      (this.game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string) ||
      DEFAULTS.CLAUDE_MODEL;

    let fullText = '';
    const stream = client.messages.stream({
      model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        const text = chunk.delta.text || '';
        fullText += text;
        onChunk(text);
      }
    }

    return fullText;
  }
}
