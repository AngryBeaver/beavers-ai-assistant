import { DEFAULTS, NAMESPACE, SETTINGS } from '../../definitions.js';
import { LoreIndexBuilder } from '../../modules/LoreIndexBuilder.js';

interface AiAssistantContext {
  enabled: boolean;
  voiceTranscriptEnabled: boolean;
  aiProvider: string;
  isClaudeProvider: boolean;
  isLocalAiProvider: boolean;
  claudeApiKey: string;
  claudeModel: string;
  localModel: string;
  localAiUrl: string;
  sessionHistoryMessages: number;
  adventureJournalFolder: string;
  defaultClaudeModel: string;
  defaultLocalAiUrl: string;
  isBuilding?: boolean;
}

export class AiAssistantSettingsApp extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any)<AiAssistantContext> {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-settings',
    classes: ['standard-form'],
    window: { title: 'AI Assistant Settings', resizable: false },
    position: { width: 500 },
    actions: {
      save: AiAssistantSettingsApp._onSave,
      buildLoreIndex: AiAssistantSettingsApp._onBuildLoreIndex,
    },
  };

  static PARTS = {
    form: { template: 'modules/beavers-ai-assistant/templates/ai-assistant-settings.hbs' },
  };

  async _onRender(_context: object, options: object): Promise<void> {
    await super._onRender(_context, options);

    // Attach change listener to AI provider dropdown
    const providerSelect = this.element.querySelector('#ai-provider') as HTMLSelectElement;
    if (providerSelect) {
      providerSelect.addEventListener('change', this._onProviderChange.bind(this));
    }

    // Initial show/hide based on current value
    this._updateProviderUI();
  }

  private _onProviderChange(): void {
    this._updateProviderUI();
  }

  private _updateProviderUI(): void {
    const providerSelect = this.element.querySelector('#ai-provider') as HTMLSelectElement;
    const provider = providerSelect?.value || 'claude';

    const claudeSection = this.element.querySelector('#claude-section') as HTMLElement;
    const localAiSection = this.element.querySelector('#local-ai-section') as HTMLElement;

    if (claudeSection) {
      claudeSection.style.display = provider === 'claude' ? 'block' : 'none';
    }
    if (localAiSection) {
      localAiSection.style.display = provider === 'local-ai' ? 'block' : 'none';
    }
  }

  async _prepareContext(_options: object): Promise<AiAssistantContext> {
    const aiProvider = game.settings.get(NAMESPACE, SETTINGS.AI_PROVIDER) as string;
    return {
      enabled: game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED) as boolean,
      voiceTranscriptEnabled: game.settings.get(
        NAMESPACE,
        SETTINGS.VOICE_TRANSCRIPT_ENABLED,
      ) as boolean,
      aiProvider,
      isClaudeProvider: aiProvider === 'claude',
      isLocalAiProvider: aiProvider === 'local-ai',
      claudeApiKey: game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string,
      claudeModel: game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string,
      localModel: game.settings.get(NAMESPACE, SETTINGS.LOCAL_MODEL) as string,
      localAiUrl: game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string,
      sessionHistoryMessages: game.settings.get(
        NAMESPACE,
        SETTINGS.SESSION_HISTORY_MESSAGES,
      ) as number,
      adventureJournalFolder: game.settings.get(
        NAMESPACE,
        SETTINGS.ADVENTURE_JOURNAL_FOLDER,
      ) as string,
      defaultClaudeModel: DEFAULTS.CLAUDE_MODEL,
      defaultLocalAiUrl: DEFAULTS.LOCAL_AI_URL,
    };
  }

  static async _onSave(this: AiAssistantSettingsApp): Promise<void> {
    const enabled = (this.element.querySelector('#ai-enabled') as HTMLInputElement).checked;
    const aiProvider =
      (this.element.querySelector('#ai-provider') as HTMLSelectElement).value ||
      DEFAULTS.AI_PROVIDER;
    const claudeApiKey = (
      this.element.querySelector('#ai-api-key') as HTMLInputElement
    ).value.trim();
    const claudeModel = (
      this.element.querySelector('#claude-model') as HTMLInputElement
    ).value.trim();
    const localModel =
      (this.element.querySelector('#local-model') as HTMLSelectElement).value ||
      DEFAULTS.LOCAL_MODEL;
    const localAiUrl = (
      this.element.querySelector('#ai-local-url') as HTMLInputElement
    ).value.trim();
    const sessionHistoryMessages = parseInt(
      (this.element.querySelector('#ai-context-size') as HTMLInputElement).value,
      10,
    );
    const adventureJournalFolder = (
      this.element.querySelector('#ai-adventure-folder') as HTMLInputElement
    ).value.trim();

    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED, enabled);
    await game.settings.set(NAMESPACE, SETTINGS.AI_PROVIDER, aiProvider);
    await game.settings.set(NAMESPACE, SETTINGS.CLAUDE_API_KEY, claudeApiKey);
    await game.settings.set(NAMESPACE, SETTINGS.CLAUDE_MODEL, claudeModel || DEFAULTS.CLAUDE_MODEL);
    await game.settings.set(NAMESPACE, SETTINGS.LOCAL_MODEL, localModel || DEFAULTS.LOCAL_MODEL);
    await game.settings.set(NAMESPACE, SETTINGS.LOCAL_AI_URL, localAiUrl || DEFAULTS.LOCAL_AI_URL);
    await game.settings.set(
      NAMESPACE,
      SETTINGS.SESSION_HISTORY_MESSAGES,
      isNaN(sessionHistoryMessages) ? DEFAULTS.SESSION_HISTORY_MESSAGES : sessionHistoryMessages,
    );
    await game.settings.set(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER, adventureJournalFolder);

    ui.notifications.info('✓ Settings saved.');
    // Stay open so user can continue configuring without reopening the window
  }

  static async _onBuildLoreIndex(this: AiAssistantSettingsApp): Promise<void> {
    try {
      const builder = new LoreIndexBuilder(game as any);
      ui.notifications.info('Building lore index — please wait...');
      await builder.build();
      ui.notifications.info('✓ Lore index built successfully.');
      await this.render();
    } catch (err) {
      console.error('Lore index build failed:', err);
      ui.notifications.error(`Lore index build failed: ${(err as Error).message}`);
    }
  }
}
