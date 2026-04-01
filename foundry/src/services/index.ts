import { NAMESPACE, SETTINGS, DEFAULTS } from '../definitions.js';
import { AiService, GameData, CallOptions } from './AiService.js';
import { ClaudeService } from './ClaudeService.js';
import { LocalAiService } from './LocalAiService.js';

export { AiService, GameData, CallOptions } from './AiService.js';
export { ClaudeService } from './ClaudeService.js';
export { LocalAiService } from './LocalAiService.js';

export function createAiService(game: GameData): AiService {
  const provider =
    (game.settings.get(NAMESPACE, SETTINGS.AI_PROVIDER) as string) || DEFAULTS.AI_PROVIDER;
  return provider === 'claude' ? new ClaudeService(game) : new LocalAiService(game);
}
