import { DEFAULTS, NAMESPACE, SETTINGS } from '../../definitions.js';
import { LoreIndexWizard } from '../LoreIndexWizard.js';

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
  installedLocalModels: string[];
  localAiReachable: boolean;
  sessionHistoryMessages: number;
  defaultClaudeModel: string;
  defaultLocalAiUrl: string;
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
      openLoreWizard: AiAssistantSettingsApp._onOpenLoreWizard,
      refreshModels: AiAssistantSettingsApp._onRefreshModels,
      installModel: AiAssistantSettingsApp._onInstallModel,
    },
  };

  static PARTS = {
    form: { template: 'modules/beavers-ai-assistant/templates/ai-assistant-settings.hbs' },
  };

  async _onRender(_context: object, options: object): Promise<void> {
    await super._onRender(_context, options);
    const providerSelect = this.element.querySelector('#ai-provider') as HTMLSelectElement;
    if (providerSelect) {
      providerSelect.addEventListener('change', this._onProviderChange.bind(this));
    }
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
    if (claudeSection) claudeSection.style.display = provider === 'claude' ? 'block' : 'none';
    if (localAiSection) localAiSection.style.display = provider === 'local-ai' ? 'block' : 'none';
  }

  async _prepareContext(_options: object): Promise<AiAssistantContext> {
    const aiProvider = game.settings.get(NAMESPACE, SETTINGS.AI_PROVIDER) as string;
    const localAiUrl =
      (game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string) || DEFAULTS.LOCAL_AI_URL;

    let installedLocalModels: string[] = [];
    let localAiReachable = false;

    if (aiProvider === 'local-ai') {
      try {
        const response = await fetch(`${localAiUrl}/v1/models`);
        if (response.ok) {
          const data = (await response.json()) as any;
          installedLocalModels = (data.data ?? []).map((m: any) => m.id as string);
          localAiReachable = true;
        }
      } catch {
        // LocalAI not running or unreachable
      }
    }

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
      localAiUrl,
      installedLocalModels,
      localAiReachable,
      sessionHistoryMessages: game.settings.get(
        NAMESPACE,
        SETTINGS.SESSION_HISTORY_MESSAGES,
      ) as number,
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
    ui.notifications.info('✓ Settings saved.');
  }

  static async _onRefreshModels(this: AiAssistantSettingsApp): Promise<void> {
    await this.render();
  }

  static async _onInstallModel(this: AiAssistantSettingsApp): Promise<void> {
    const modelName = (
      this.element.querySelector('#install-model-name') as HTMLInputElement
    ).value.trim();

    if (!modelName) {
      ui.notifications.warn('Enter a model name to install.');
      return;
    }

    const localAiUrl =
      (game.settings.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string) || DEFAULTS.LOCAL_AI_URL;

    try {
      const response = await fetch(`${localAiUrl}/models/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: modelName }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as any;
        throw new Error(err?.error || response.statusText);
      }

      ui.notifications.info(
        `Installing "${modelName}" — this may take several minutes. Click Refresh when done.`,
      );
    } catch (err) {
      ui.notifications.error(`Install failed: ${(err as Error).message}`);
    }
  }

  static async _onOpenLoreWizard(_this: AiAssistantSettingsApp): Promise<void> {
    LoreIndexWizard.open();
  }
}
