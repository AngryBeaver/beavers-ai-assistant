import { DEFAULTS, NAMESPACE, SETTINGS } from '../../definitions.js';
import { AiService } from '../../services/AiService.js';
import { LoreIndexWizard } from '../LoreIndexWizard.js';

interface AiAssistantContext {
  enabled: boolean;
  aiProvider: string;
  isClaudeProvider: boolean;
  isLocalAiProvider: boolean;
  claudeApiKey: string;
  claudeModel: string;
  claudeModels: string[];
  localModel: string;
  localAiUrl: string;
  installedLocalModels: string[];
  localAiReachable: boolean;
  localAiModelsUrl: string;
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
    const savedLocalModel = game.settings.get(NAMESPACE, SETTINGS.LOCAL_MODEL) as string;
    const savedClaudeModel = game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string;

    try {
      installedLocalModels = await AiService.get('local-ai').fetchModels();
      localAiReachable = true;
    } catch {
      // LocalAI not running or unreachable
    }

    // Always keep the saved model in the list so the dropdown preserves the selection
    if (savedLocalModel && !installedLocalModels.includes(savedLocalModel)) {
      installedLocalModels = [savedLocalModel, ...installedLocalModels];
    }

    const claudeModels = await AiService.get('claude').fetchModels();
    if (savedClaudeModel && !claudeModels.includes(savedClaudeModel)) {
      claudeModels.unshift(savedClaudeModel);
    }

    return {
      enabled: game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED) as boolean,
      aiProvider,
      isClaudeProvider: aiProvider === 'claude',
      isLocalAiProvider: aiProvider === 'local-ai',
      claudeApiKey: game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string,
      claudeModel: savedClaudeModel,
      claudeModels,
      localModel: savedLocalModel,
      localAiUrl,
      installedLocalModels,
      localAiReachable,
      localAiModelsUrl: `${localAiUrl}/app/models`,
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
    const claudeModel = (this.element.querySelector('#claude-model') as HTMLSelectElement).value;
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

  static async _onOpenLoreWizard(_this: AiAssistantSettingsApp): Promise<void> {
    LoreIndexWizard.open();
  }
}
