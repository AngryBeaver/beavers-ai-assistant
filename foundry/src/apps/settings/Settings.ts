import { DEFAULTS, NAMESPACE, SETTINGS } from '../../definitions.js';
import { AiAssistantSettingsApp } from './AiAssistantSettingsApp.js';
import { VoiceTranscriptSettingsApp } from './VoiceTranscriptSettingsApp.js';

/**
 * Registers all module settings (all `config: false`) and the two settings-menu buttons.
 * Settings are managed through VoiceTranscriptSettingsApp and AiAssistantSettingsApp.
 */
export class Settings {
  constructor() {
    this.registerSettings();
    this.registerMenus();
  }

  /** True only when the AI Assistant is enabled and a Claude API key is configured. */
  static isConfigured(): boolean {
    const enabled = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED) as boolean;
    const apiKey = game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string;
    return enabled && !!apiKey;
  }

  /** True when Voice Transcript is enabled. */
  static isVoiceTranscriptEnabled(): boolean {
    return game.settings.get(NAMESPACE, SETTINGS.VOICE_TRANSCRIPT_ENABLED) as boolean;
  }

  private registerSettings(): void {
    // hidden bookkeeping
    game.settings.register(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // voice transcript
    game.settings.register(NAMESPACE, SETTINGS.VOICE_TRANSCRIPT_ENABLED, {
      scope: 'world',
      config: false,
      type: Boolean,
      default: false,
    });
    game.settings.register(NAMESPACE, SETTINGS.SESSION_JOURNAL_FOLDER, {
      scope: 'world',
      config: false,
      type: String,
      default: DEFAULTS.SESSION_JOURNAL_FOLDER,
    });

    // ai assistant
    game.settings.register(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED, {
      scope: 'world',
      config: false,
      type: Boolean,
      default: false,
    });
    game.settings.register(NAMESPACE, SETTINGS.CLAUDE_API_KEY, {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });
    game.settings.register(NAMESPACE, SETTINGS.CLAUDE_MODEL, {
      scope: 'world',
      config: false,
      type: String,
      default: DEFAULTS.CLAUDE_MODEL,
    });
    game.settings.register(NAMESPACE, SETTINGS.SESSION_HISTORY_MESSAGES, {
      scope: 'world',
      config: false,
      type: Number,
      default: DEFAULTS.SESSION_HISTORY_MESSAGES,
    });
    game.settings.register(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER, {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });
    game.settings.register(NAMESPACE, SETTINGS.ADVENTURE_INDEX_JOURNAL_NAME, {
      scope: 'world',
      config: false,
      type: String,
      default: DEFAULTS.ADVENTURE_INDEX_JOURNAL_NAME,
    });
  }

  private registerMenus(): void {
    game.settings.registerMenu(NAMESPACE, 'voiceTranscript', {
      name: 'Voice Transcript',
      label: 'Configure',
      hint: 'Connect the Discord bot, set the session folder, and enable voice transcription.',
      icon: 'fas fa-microphone',
      type: VoiceTranscriptSettingsApp,
      restricted: true,
    });

    game.settings.registerMenu(NAMESPACE, 'aiAssistant', {
      name: 'AI Assistant',
      label: 'Configure',
      hint: 'Set up the Claude API key, context size, and adventure journals for the AI GM Window.',
      icon: 'fas fa-robot',
      type: AiAssistantSettingsApp,
      restricted: true,
    });
  }
}
