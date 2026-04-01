export interface GameData {
  settings: {
    get(namespace: string, key: string): unknown;
  };
}

export interface CallOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface AiService {
  call(systemPrompt: string, userPrompt: string, options?: CallOptions): Promise<string>;
  stream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void,
    options?: CallOptions,
  ): Promise<string>;
}
