import { AI_ASSISTANT_USER_NAME, NAMESPACE, SETTINGS } from '../../definitions.js';

interface VoiceTranscriptContext {
  userId: string;
  password: string;
}

export class VoiceTranscriptSettingsApp extends (foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) as any)<VoiceTranscriptContext> {
  static DEFAULT_OPTIONS = {
    id: 'beavers-vt-settings',
    classes: ['standard-form'],
    window: { title: 'Voice Transcript Settings', resizable: false },
    position: { width: 500 },
    actions: {
      copyUserId: VoiceTranscriptSettingsApp._onCopyUserId,
      copyPassword: VoiceTranscriptSettingsApp._onCopyPassword,
      regenerate: VoiceTranscriptSettingsApp._onRegenerate,
      save: VoiceTranscriptSettingsApp._onSave,
    },
  };

  static PARTS = {
    form: { template: 'modules/beavers-ai-assistant/templates/voice-transcript-settings.hbs' },
  };

  async _prepareContext(_options: object): Promise<VoiceTranscriptContext> {
    // @ts-ignore
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    const password = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    return { userId: user?.id ?? '—', password };
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
      ui.notifications.warn('AI Assistant user does not exist yet.');
      return;
    }
    const newPassword = foundry.utils.randomID(32);
    await user.update({ password: newPassword });
    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, newPassword);
    await this.render({ force: true });
  }

  static async _onSave(this: VoiceTranscriptSettingsApp): Promise<void> {
    ui.notifications.info('Voice Transcript settings saved.');
    await this.close();
  }
}
