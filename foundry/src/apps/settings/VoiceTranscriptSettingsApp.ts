import { AI_ASSISTANT_USER_NAME, HOOKS, NAMESPACE, SETTINGS } from '../../definitions.js';

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface VoiceTranscriptContext {
  enabled: boolean;
  userId: string;
  password: string;
  sessionFolder: string;
}

export class VoiceTranscriptSettingsApp extends foundry.applications.api
  .ApplicationV2<VoiceTranscriptContext> {
  static DEFAULT_OPTIONS = {
    id: 'beavers-vt-settings',
    window: { title: 'Voice Transcript Settings', resizable: false },
    position: { width: 500 },
    actions: {
      copyUserId: VoiceTranscriptSettingsApp._onCopyUserId,
      copyPassword: VoiceTranscriptSettingsApp._onCopyPassword,
      regenerate: VoiceTranscriptSettingsApp._onRegenerate,
      save: VoiceTranscriptSettingsApp._onSave,
    },
  };

  async _prepareContext(_options: object): Promise<VoiceTranscriptContext> {
    // @ts-ignore
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    const password = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    const enabled = game.settings.get(NAMESPACE, SETTINGS.VOICE_TRANSCRIPT_ENABLED) as boolean;
    const sessionFolder = game.settings.get(NAMESPACE, SETTINGS.SESSION_JOURNAL_FOLDER) as string;
    return { enabled, userId: user?.id ?? '—', password, sessionFolder };
  }

  async _renderHTML(context: VoiceTranscriptContext, _options: object): Promise<HTMLElement> {
    const el = document.createElement('div');
    el.style.cssText = 'padding:1rem 1rem .75rem';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem;padding:.75rem">
        <input type="checkbox" id="vt-enabled" ${context.enabled ? 'checked' : ''}
          style="width:1.1em;height:1.1em;cursor:pointer">
        <label for="vt-enabled" style="font-weight:bold;margin:0;cursor:pointer">Enable Voice Transcript</label>
      </div>

      <h3 style="border-bottom:1px solid var(--color-underline-header,#c9c9b5);padding-bottom:.25rem;margin-bottom:.75rem">
        AI Assistant Connection
      </h3>
      <p style="margin-bottom:.75rem;font-size:.875em">
        Use these credentials in your external tool's <code>.env</code> file.
      </p>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">FOUNDRY_USER (User ID)</label>
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
        <input type="text" value="${escAttr(context.userId)}" readonly
          style="flex:1;font-family:monospace;font-size:.85em">
        <button type="button" data-action="copyUserId"><i class="fas fa-copy"></i> Copy</button>
      </div>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">FOUNDRY_PASS</label>
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
        <input type="text" value="${escAttr(context.password)}" readonly
          style="flex:1;font-family:monospace;font-size:.85em">
        <button type="button" data-action="copyPassword"><i class="fas fa-copy"></i> Copy</button>
      </div>
      <button type="button" data-action="regenerate" style="width:100%;margin-bottom:1.25rem">
        <i class="fas fa-sync"></i> Regenerate Password
      </button>

      <h3 style="border-bottom:1px solid var(--color-underline-header,#c9c9b5);padding-bottom:.25rem;margin-bottom:.75rem">
        Session
      </h3>
      <label style="display:block;margin-bottom:.25rem;font-weight:bold">Session Folder</label>
      <input type="text" id="vt-session-folder" value="${escAttr(context.sessionFolder)}" placeholder="session"
        style="width:100%;margin-bottom:.25rem;box-sizing:border-box">
      <p style="font-size:.8em;color:var(--color-text-dark-secondary,#666);margin-bottom:1.25rem">
        Folder where session journals are stored. Defaults to <code>session</code> if left empty;
        created automatically if it does not exist.
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

  static async _onCopyUserId(this: VoiceTranscriptSettingsApp): Promise<void> {
    // @ts-ignore
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    if (!user) return;
    await navigator.clipboard.writeText(user.id);
    ui.notifications.info('User ID copied to clipboard.');
  }

  static async _onCopyPassword(this: VoiceTranscriptSettingsApp): Promise<void> {
    const password = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    await navigator.clipboard.writeText(password);
    ui.notifications.info('Password copied to clipboard.');
  }

  static async _onRegenerate(this: VoiceTranscriptSettingsApp): Promise<void> {
    // @ts-ignore
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    if (!user) {
      ui.notifications.warn('AI Assistant user does not exist yet. Enable Voice Transcript first.');
      return;
    }
    const newPassword = foundry.utils.randomID(32);
    await user.update({ password: newPassword });
    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, newPassword);
    await this.render({ force: true });
  }

  static async _onSave(this: VoiceTranscriptSettingsApp): Promise<void> {
    const enabled = (this.element.querySelector('#vt-enabled') as HTMLInputElement).checked;
    const sessionFolder = (
      this.element.querySelector('#vt-session-folder') as HTMLInputElement
    ).value.trim();

    const wasEnabled = game.settings.get(NAMESPACE, SETTINGS.VOICE_TRANSCRIPT_ENABLED) as boolean;

    await game.settings.set(NAMESPACE, SETTINGS.VOICE_TRANSCRIPT_ENABLED, enabled);
    await game.settings.set(NAMESPACE, SETTINGS.SESSION_JOURNAL_FOLDER, sessionFolder);

    if (enabled !== wasEnabled) {
      Hooks.callAll(HOOKS.VOICE_TRANSCRIPT_ENABLED_CHANGED, enabled);
    }

    ui.notifications.info('Voice Transcript settings saved.');
    await this.close();
  }
}
