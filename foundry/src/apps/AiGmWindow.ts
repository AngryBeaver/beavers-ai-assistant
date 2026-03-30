import { NAMESPACE } from '../definitions.js';
import { Settings } from './settings/Settings.js';

interface AiGmWindowContext {
  voiceTranscriptEnabled: boolean;
}

/**
 * GM-only persistent panel.
 * Step 2: layout and wiring only — no AI logic yet.
 */
export class AiGmWindow extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-gm-window',
    window: { title: 'AI Assistant', resizable: true },
    position: { width: 440 },
    actions: {
      sessionSummary: AiGmWindow._onSessionSummary,
      interact: AiGmWindow._onInteract,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${NAMESPACE}/templates/ai-gm-window.hbs`,
    },
  };

  private static _instance: AiGmWindow | null = null;

  /**
   * Opens (or re-focuses) the singleton window.
   * Shows an error notification if the module is not configured.
   */
  static open(): void {
    if (!Settings.isConfigured()) {
      ui.notifications.error(
        'AI Assistant is not configured. Enable it and enter your Claude API key in the AI Assistant settings.',
      );
      return;
    }

    if (!AiGmWindow._instance) {
      AiGmWindow._instance = new AiGmWindow();
    }
    AiGmWindow._instance.render({ force: true });
  }

  async _prepareContext(_options: object): Promise<AiGmWindowContext> {
    return {
      voiceTranscriptEnabled: Settings.isVoiceTranscriptEnabled(),
    };
  }

  async close(options?: object): Promise<this> {
    AiGmWindow._instance = null;
    return super.close(options);
  }

  /** Placeholder — implemented in Step 8. */
  static async _onSessionSummary(_this: AiGmWindow): Promise<void> {
    ui.notifications.info('Session Summary — coming in a later step.');
  }

  /** Placeholder — implemented in Step 4. */
  static async _onInteract(_this: AiGmWindow): Promise<void> {
    ui.notifications.info('Interact — coming in a later step.');
  }
}
