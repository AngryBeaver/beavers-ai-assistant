import { DEFAULTS, NAMESPACE, SETTINGS } from '../../definitions.js';

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface AiAssistantContext {
  enabled: boolean;
  voiceTranscriptEnabled: boolean;
  claudeApiKey: string;
  claudeModel: string;
  sessionHistoryMessages: number;
  adventureJournalFolder: string;
  adventureIndexJournalName: string;
}

export class AiAssistantSettingsApp extends foundry.applications.api
  .ApplicationV2<AiAssistantContext> {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-settings',
    window: { title: 'AI Assistant Settings', resizable: false },
    position: { width: 500 },
    actions: {
      save: AiAssistantSettingsApp._onSave,
    },
  };

  async _prepareContext(_options: object): Promise<AiAssistantContext> {
    return {
      enabled: game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED) as boolean,
      voiceTranscriptEnabled: game.settings.get(
        NAMESPACE,
        SETTINGS.VOICE_TRANSCRIPT_ENABLED,
      ) as boolean,
      claudeApiKey: game.settings.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as string,
      claudeModel: game.settings.get(NAMESPACE, SETTINGS.CLAUDE_MODEL) as string,
      sessionHistoryMessages: game.settings.get(
        NAMESPACE,
        SETTINGS.SESSION_HISTORY_MESSAGES,
      ) as number,
      adventureJournalFolder: game.settings.get(
        NAMESPACE,
        SETTINGS.ADVENTURE_JOURNAL_FOLDER,
      ) as string,
      adventureIndexJournalName: game.settings.get(
        NAMESPACE,
        SETTINGS.ADVENTURE_INDEX_JOURNAL_NAME,
      ) as string,
    };
  }

  async _renderHTML(context: AiAssistantContext, _options: object): Promise<HTMLElement> {
    const vtWarning = context.voiceTranscriptEnabled
      ? ''
      : `<div style="padding:.5rem .75rem;background:var(--color-level-warning-bg,#fff3cd);
              border:1px solid var(--color-level-warning,#e6ac00);border-radius:4px;
              font-size:.875em;margin-bottom:.75rem">
           <i class="fas fa-triangle-exclamation"></i>
           <strong>Voice Transcript is not enabled.</strong>
           Session context requires Voice Transcript. The <em>Interact</em> button will not be
           available in the AI GM Window until Voice Transcript is enabled.
         </div>`;

    const el = document.createElement('div');
    el.style.cssText = 'padding:1rem 1rem .75rem';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem;padding:.75rem">
        <input type="checkbox" id="ai-enabled" ${context.enabled ? 'checked' : ''}
          style="width:1.1em;height:1.1em;cursor:pointer">
        <label for="ai-enabled" style="font-weight:bold;margin:0;cursor:pointer">Enable AI Assistant</label>
      </div>

      <h3 style="border-bottom:1px solid var(--color-underline-header,#c9c9b5);padding-bottom:.25rem;margin-bottom:.75rem">
        AI Tool
      </h3>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Claude API Key</label>
      <input type="password" id="ai-api-key" value="${escAttr(context.claudeApiKey)}"
        placeholder="sk-ant-…" style="width:100%;margin-bottom:.25rem;box-sizing:border-box">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:.75rem">
        Anthropic API key. Required for AI GM suggestions.
      </p>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Claude Model</label>
      <input type="text" id="ai-model" value="${escAttr(context.claudeModel)}"
        style="width:100%;margin-bottom:.25rem;box-sizing:border-box">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:1.25rem">
        Model ID to use for AI GM suggestions (e.g. <code>${escAttr(DEFAULTS.CLAUDE_MODEL)}</code>).
      </p>

      <h3 style="border-bottom:1px solid var(--color-underline-header,#c9c9b5);padding-bottom:.25rem;margin-bottom:.75rem">
        Session
      </h3>
      ${vtWarning}
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Context Size</label>
      <input type="number" id="ai-context-size" value="${context.sessionHistoryMessages}" min="1" max="200"
        style="width:6rem;margin-bottom:.25rem">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:.5rem">
        How many recent session messages to include in AI context.
      </p>
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:1.25rem">
        The session summary journal is stored automatically as <code>AI-Summary</code> inside the
        configured Session Folder. It is not configurable.
      </p>

      <h3 style="border-bottom:1px solid var(--color-underline-header,#c9c9b5);padding-bottom:.25rem;margin-bottom:.75rem">
        Adventure
      </h3>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Adventure Journal Folder</label>
      <input type="text" id="ai-adventure-folder" value="${escAttr(context.adventureJournalFolder)}"
        placeholder="(optional)" style="width:100%;margin-bottom:.25rem;box-sizing:border-box">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:.75rem">
        Folder containing adventure/lore journals. Leave blank for emergent campaigns.
      </p>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Adventure Index Journal Name</label>
      <input type="text" id="ai-adventure-index" value="${escAttr(context.adventureIndexJournalName)}"
        style="width:100%;margin-bottom:.25rem;box-sizing:border-box">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:1.25rem">
        Journal where the pre-built adventure index is stored. Only used when Adventure Journal Folder is set.
      </p>

      <div style="display:flex;justify-content:flex-end">
        <button type="button" data-action="save" style="min-width:80px">
          <i class="fas fa-save"></i> Save
        </button>
      </div>
    `;
    return el;
  }

  _replaceHTML(result: HTMLElement, content: HTMLElement, _options: object): void {
    content.replaceChildren(result);
  }

  static async _onSave(this: AiAssistantSettingsApp): Promise<void> {
    const enabled = (this.element.querySelector('#ai-enabled') as HTMLInputElement).checked;
    const claudeApiKey = (
      this.element.querySelector('#ai-api-key') as HTMLInputElement
    ).value.trim();
    const claudeModel = (this.element.querySelector('#ai-model') as HTMLInputElement).value.trim();
    const sessionHistoryMessages = parseInt(
      (this.element.querySelector('#ai-context-size') as HTMLInputElement).value,
      10,
    );
    const adventureJournalFolder = (
      this.element.querySelector('#ai-adventure-folder') as HTMLInputElement
    ).value.trim();
    const adventureIndexJournalName = (
      this.element.querySelector('#ai-adventure-index') as HTMLInputElement
    ).value.trim();

    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_ENABLED, enabled);
    await game.settings.set(NAMESPACE, SETTINGS.CLAUDE_API_KEY, claudeApiKey);
    await game.settings.set(NAMESPACE, SETTINGS.CLAUDE_MODEL, claudeModel || DEFAULTS.CLAUDE_MODEL);
    await game.settings.set(
      NAMESPACE,
      SETTINGS.SESSION_HISTORY_MESSAGES,
      isNaN(sessionHistoryMessages) ? DEFAULTS.SESSION_HISTORY_MESSAGES : sessionHistoryMessages,
    );
    await game.settings.set(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER, adventureJournalFolder);
    await game.settings.set(
      NAMESPACE,
      SETTINGS.ADVENTURE_INDEX_JOURNAL_NAME,
      adventureIndexJournalName || DEFAULTS.ADVENTURE_INDEX_JOURNAL_NAME,
    );

    ui.notifications.info('AI Assistant settings saved.');
    await this.close();
  }
}
