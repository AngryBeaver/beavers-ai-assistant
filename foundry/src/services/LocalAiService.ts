import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, GameData, CallOptions } from './AiService.js';

export class LocalAiService implements AiService {
  private openai: any = null;

  constructor(private game: GameData) {}

  private async getClient() {
    if (!this.openai) {
      const { OpenAI } = await import('openai');
      const baseURL =
        (this.game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string) ||
        DEFAULTS.LOCAL_AI_URL;
      this.openai = new OpenAI({
        apiKey: 'sk-local',
        baseURL,
      });
    }
    return this.openai;
  }

  async call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<string> {
    const client = await this.getClient();
    const model =
      options?.model ||
      (this.game.settings.get(NAMESPACE, SETTINGS.LOCAL_MODEL) as string) ||
      'mistral';

    const response = await client.chat.completions.create({
      model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (response.choices[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    throw new Error('Unexpected LocalAI response format');
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
      (this.game.settings.get(NAMESPACE, SETTINGS.LOCAL_MODEL) as string) ||
      'mistral';

    let fullText = '';
    const stream = await client.chat.completions.create({
      model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature ?? 0.7,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const text = chunk.choices[0].delta.content;
        fullText += text;
        onChunk(text);
      }
    }

    return fullText;
  }
}
