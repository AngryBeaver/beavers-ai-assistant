import { NAMESPACE, MODULE_FOLDER_NAME, LORE_INDEX_JOURNAL_NAME } from '../definitions.js';
import { Settings } from './settings/Settings.js';
import { ContextBuilder } from '../modules/ContextBuilder.js';
import type { GameData } from '../modules/ContextBuilder.js';
import { AiService } from '../services/AiService.js';

interface SituationAssessment {
  currentScene: string;
  confidence: 'high' | 'medium' | 'low';
  recap: string;
  npcCandidates: Array<{ npc: string; topic: string }>;
}

type InteractPhase = 'idle' | 'assessing' | 'confirming' | 'responding' | 'done';

interface AiGmWindowContext {
  voiceTranscriptEnabled: boolean;
  loreIndexExists: boolean;
  availableChapters: string[];
  selectedChapter: string;
  phase: InteractPhase;
  assessment: SituationAssessment | null;
  confirmedScene: string;
  confirmedNpc: string;
  confirmedTopic: string;
  response: string;
  isStreaming: boolean;
}

/**
 * GM-only persistent panel.
 * Task 1.5: chapter selector populated from lore index.
 * Task 1.6: two-call Interact flow (Situation Assessment → Persona Response).
 */
export class AiGmWindow extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-gm-window',
    window: { title: 'AI Assistant', resizable: true },
    position: { width: 440 },
    actions: {
      interact: AiGmWindow._onInteract,
      confirmNpc: AiGmWindow._onConfirmNpc,
      retry: AiGmWindow._onRetry,
      accept: AiGmWindow._onAccept,
      stop: AiGmWindow._onStop,
      openSettings: AiGmWindow._onOpenSettings,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${NAMESPACE}/templates/ai-gm-window.hbs`,
    },
  };

  private static _instance: AiGmWindow | null = null;

  // ---------------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------------

  private _selectedChapter = '';
  private _phase: InteractPhase = 'idle';
  private _assessment: SituationAssessment | null = null;
  private _confirmedScene = '';
  private _confirmedNpc = '';
  private _confirmedTopic = '';
  private _response = '';
  private _isStreaming = false;
  private _abortController: AbortController | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Opens (or re-focuses) the singleton window.
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
    const availableChapters = this._loadChapters();
    if (!this._selectedChapter && availableChapters.length > 0) {
      this._selectedChapter = availableChapters[0];
    }

    return {
      voiceTranscriptEnabled: Settings.isVoiceTranscriptEnabled(),
      loreIndexExists: availableChapters.length > 0,
      availableChapters,
      selectedChapter: this._selectedChapter,
      phase: this._phase,
      assessment: this._assessment,
      confirmedScene: this._confirmedScene,
      confirmedNpc: this._confirmedNpc,
      confirmedTopic: this._confirmedTopic,
      response: this._response,
      isStreaming: this._isStreaming,
    };
  }

  protected _onRender(_context: object, _options: object): void {
    // Chapter select — update state on change without triggering a full re-render
    const chapterSelect = this.element?.querySelector<HTMLSelectElement>('#ai-chapter-select');
    chapterSelect?.addEventListener('change', (e) => {
      this._selectedChapter = (e.target as HTMLSelectElement).value;
    });

    // Scene override input in the confirmation card
    const sceneInput = this.element?.querySelector<HTMLInputElement>('#ai-confirmed-scene');
    sceneInput?.addEventListener('change', (e) => {
      this._confirmedScene = (e.target as HTMLInputElement).value.trim();
    });
  }

  async close(options?: object): Promise<this> {
    AiGmWindow._instance = null;
    return super.close(options);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Call 1 — Situation Assessment.
   * Reads chapter + session context, asks the AI to infer the current scene and
   * propose NPC interaction candidates. Result is shown as a confirmation card.
   */
  static async _onInteract(this: AiGmWindow): Promise<void> {
    if (this._phase !== 'idle') return;
    if (!this._selectedChapter) {
      ui.notifications.warn('Select a chapter first.');
      return;
    }

    this._phase = 'assessing';
    this._assessment = null;
    this._response = '';
    this._abortController = new AbortController();
    await this.render();

    try {
      const context = await new ContextBuilder(game as unknown as GameData).build(
        this._selectedChapter,
      );

      const systemPrompt = `You are a TTRPG GM assistant performing a situation assessment.
Analyse the provided game context and respond with ONLY valid JSON — no prose, no markdown fences:
{
  "currentScene": "Most likely current scene name (use exact name from lore index)",
  "confidence": "high|medium|low",
  "recap": "2-3 sentences: what the party has done so far and where things stand",
  "npcCandidates": [
    { "npc": "NPC name (exact)", "topic": "What the party is likely asking or doing with this NPC" }
  ]
}
Include 1-3 npcCandidates ranked by likelihood. Use names exactly as they appear in the lore index.`;

      const { content } = await AiService.create(game as unknown as GameData).call(
        systemPrompt,
        context,
        { max_tokens: 1024, signal: this._abortController.signal },
      );

      // Strip any markdown fences the model may have added
      const json = content.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      this._assessment = JSON.parse(json) as SituationAssessment;
      this._confirmedScene = this._assessment.currentScene;
      this._phase = 'confirming';
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        ui.notifications.error(`Situation assessment failed: ${(err as Error).message}`);
      }
      this._phase = 'idle';
    } finally {
      this._abortController = null;
    }

    await this.render();
  }

  /**
   * Triggered when the GM selects an NPC candidate from the confirmation card.
   * Stores the confirmed NPC + topic and fires Call 2.
   */
  static async _onConfirmNpc(this: AiGmWindow, _event: Event, target: HTMLElement): Promise<void> {
    const npc = target.dataset.npc ?? '';
    const topic = target.dataset.topic ?? '';
    if (!npc) return;
    this._confirmedNpc = npc;
    this._confirmedTopic = topic;
    await this._runPersonaResponse();
  }

  /** Re-run Call 2 with the same NPC + topic. */
  static async _onRetry(this: AiGmWindow): Promise<void> {
    if (this._isStreaming) return;
    await this._runPersonaResponse();
  }

  /** Abort the current AI call. */
  static _onStop(this: AiGmWindow): void {
    this._abortController?.abort();
  }

  /** Accept the response and return to idle. */
  static async _onAccept(this: AiGmWindow): Promise<void> {
    this._phase = 'idle';
    this._assessment = null;
    this._response = '';
    this._confirmedNpc = '';
    this._confirmedTopic = '';
    this._confirmedScene = '';
    await this.render();
  }

  static async _onOpenSettings(_this: AiGmWindow): Promise<void> {
    const menuKey = `${NAMESPACE}.aiAssistant`;
    const menu = (game.settings.menus as any).get(menuKey);
    if (menu?.settingsApp) {
      menu.settingsApp.render(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Call 2 — Persona Response.
   * Reads chapter + scene context, situation recap from Call 1, and the
   * confirmed NPC + topic. Streams the persona response into the DOM directly.
   */
  private async _runPersonaResponse(): Promise<void> {
    this._phase = 'responding';
    this._response = '';
    this._isStreaming = true;
    this._abortController = new AbortController();
    await this.render();

    try {
      const context = await new ContextBuilder(game as unknown as GameData).build(
        this._selectedChapter,
        this._confirmedScene,
      );

      const systemPrompt = `You are a TTRPG GM assistant voicing an NPC for a live game session.
Voice ${this._confirmedNpc} in response to the party's interaction.
Stay in character. Draw on the scene and chapter context provided.
Keep the response concise — 2-4 sentences unless the scene demands more.
Do not include stage directions or out-of-character notes.`;

      const situationBlock = this._assessment?.recap
        ? `\n\n## Situation\n${this._assessment.recap}\nCurrent scene: ${this._confirmedScene}`
        : `\n\nCurrent scene: ${this._confirmedScene}`;

      const userPrompt = `${context}${situationBlock}\n\n## Interaction\nNPC: ${this._confirmedNpc}\nTopic: ${this._confirmedTopic}`;

      await AiService.create(game as unknown as GameData).stream(
        systemPrompt,
        userPrompt,
        (chunk, type) => {
          if (type !== 'content') return;
          this._response += chunk;
          const el = this.element?.querySelector('.beavers-ai-response');
          if (el) el.textContent = this._response;
        },
        { max_tokens: 1024, signal: this._abortController.signal },
      );

      this._isStreaming = false;
      this._phase = 'done';
    } catch (err) {
      this._isStreaming = false;
      if ((err as DOMException).name === 'AbortError') {
        this._phase = 'confirming';
      } else {
        ui.notifications.error(`Persona response failed: ${(err as Error).message}`);
        this._phase = 'confirming';
      }
    } finally {
      this._abortController = null;
    }

    await this.render();
  }

  /** Load chapter names from the lore index journal. */
  private _loadChapters(): string[] {
    const moduleFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    const indexJournal = moduleFolder
      ? (game.journal as any)?.find(
          (j: any) => j.folder?.id === moduleFolder.id && j.name === LORE_INDEX_JOURNAL_NAME,
        )
      : null;
    if (!indexJournal) return [];
    return (indexJournal.pages.contents as any[])
      .filter((p: any) => (p.name as string)?.startsWith('Chapter: '))
      .map((p: any) => (p.name as string).replace('Chapter: ', ''));
  }
}