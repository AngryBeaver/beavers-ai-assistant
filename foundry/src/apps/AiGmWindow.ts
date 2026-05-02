import { NAMESPACE, MODULE_FOLDER_NAME, LORE_INDEX_JOURNAL_NAME } from '../definitions.js';
import { Settings } from './settings/Settings.js';
import { ContextBuilder } from '../modules/ContextBuilder.js';
import type { GameData } from '../modules/ContextBuilder.js';
import { AiService } from '../services/AiService.js';
import { LoreIndexWizard } from './LoreIndexWizard.js';

interface SituationAssessment {
  currentScene: string;
  confidence: 'high' | 'medium' | 'low';
  recap: string;
  npcCandidates: Array<{ npc: string; topic: string }>;
}

type InteractPhase =
  | 'idle'
  | 'assessing'
  | 'confirming'
  | 'responding'
  | 'done'
  | 'asking'
  | 'asked';

interface AiGmWindowContext {
  loreIndexExists: boolean;
  availableChapters: string[];
  selectedChapter: string;
  availableScenes: string[];
  selectedScene: string;
  phase: InteractPhase;
  assessment: SituationAssessment | null;
  confirmedScene: string;
  confirmedNpc: string;
  confirmedTopic: string;
  response: string;
  isStreaming: boolean;
  questionText: string;
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
      openAdventureSetup: AiGmWindow._onOpenAdventureSetup,
      send: AiGmWindow._onSend,
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
  private _selectedScene = '';
  private _questionText = '';
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
        'AI Assistant is not configured. Enable it in the AI Assistant settings.',
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
    const availableScenes = this._selectedChapter
      ? this._loadScenesForChapter(this._selectedChapter)
      : [];
    if (this._selectedScene && !availableScenes.includes(this._selectedScene)) {
      this._selectedScene = '';
    }

    return {
      loreIndexExists: availableChapters.length > 0,
      availableChapters,
      selectedChapter: this._selectedChapter,
      availableScenes,
      selectedScene: this._selectedScene,
      phase: this._phase,
      assessment: this._assessment,
      confirmedScene: this._confirmedScene,
      confirmedNpc: this._confirmedNpc,
      confirmedTopic: this._confirmedTopic,
      response: this._response,
      isStreaming: this._isStreaming,
      questionText: this._questionText,
    };
  }

  protected _onRender(_context: object, _options: object): void {
    // Chapter select — re-render to refresh scene list when chapter changes
    const chapterSelect = this.element?.querySelector<HTMLSelectElement>('#ai-chapter-select');
    chapterSelect?.addEventListener('change', (e) => {
      this._selectedChapter = (e.target as HTMLSelectElement).value;
      this._selectedScene = '';
      void this.render({ force: true });
    });

    // Scene select — update state and re-render so Send button enables/disables
    const sceneSelect = this.element?.querySelector<HTMLSelectElement>('#ai-scene-select');
    sceneSelect?.addEventListener('change', (e) => {
      this._selectedScene = (e.target as HTMLSelectElement).value;
      void this.render();
    });

    // Scene override input in the confirmation card
    const sceneInput = this.element?.querySelector<HTMLInputElement>('#ai-confirmed-scene');
    sceneInput?.addEventListener('change', (e) => {
      this._confirmedScene = (e.target as HTMLInputElement).value.trim();
    });

    // Question textarea — keep state in sync (no re-render needed)
    const questionArea = this.element?.querySelector<HTMLTextAreaElement>('#ai-question-input');
    questionArea?.addEventListener('input', (e) => {
      this._questionText = (e.target as HTMLTextAreaElement).value;
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
      const json = content
        .trim()
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
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

  static _onOpenAdventureSetup(): void {
    LoreIndexWizard.open();
  }

  /** Send a typed question using the selected chapter + scene as lore context. */
  static async _onSend(this: AiGmWindow): Promise<void> {
    if (!this._selectedScene || !this._questionText.trim()) return;

    const context = this._buildSceneContext();
    if (!context) {
      ui.notifications.warn('Could not load scene context.');
      return;
    }

    this._phase = 'asking';
    this._response = '';
    this._abortController = new AbortController();
    await this.render();

    const systemPrompt = `You are a TTRPG GM assistant. Answer the GM's question concisely and accurately using only the provided adventure lore context.`;
    const userPrompt = `${context}\n\n---\n\n${this._questionText.trim()}`;

    try {
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
      this._phase = 'asked';
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        ui.notifications.error(`Question failed: ${(err as Error).message}`);
      }
      this._phase = 'idle';
    } finally {
      this._abortController = null;
    }

    await this.render();
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
        this._confirmedScene || this._selectedScene,
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

  /** Raw text from a journal page (markdown-format preferred, HTML stripped otherwise). */
  private _pageText(page: any): string {
    if (page.text?.format === 2 && page.text.markdown) return page.text.markdown as string;
    return ((page.text?.content as string) ?? '').replace(/<[^>]*>/g, '').trim();
  }

  /**
   * Build a focused lore context string from the selected chapter's Summary page
   * and the selected scene's lore page — used by the Send (direct-question) flow.
   */
  private _buildSceneContext(): string | null {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder || !this._selectedChapter || !this._selectedScene) return null;

    const chapterJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === this._selectedChapter,
    );
    if (!chapterJournal) return null;

    const parts: string[] = [];

    const summaryPage = (chapterJournal.pages.contents as any[]).find(
      (p: any) => p.name === 'Summary',
    );
    if (summaryPage) {
      const text = this._pageText(summaryPage);
      if (text) parts.push(`## Chapter: ${this._selectedChapter}\n${text}`);
    }

    const scenePage = (chapterJournal.pages.contents as any[]).find(
      (p: any) => p.name === `Scene: ${this._selectedScene}`,
    );
    if (scenePage) {
      const text = this._pageText(scenePage);
      if (text) parts.push(`## Scene: ${this._selectedScene}\n${text}`);
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  }

  /** Find the lore-index subfolder inside the beavers-ai-assistant module folder. */
  private _getLoreIndexFolder(): any | null {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) return null;
    return (
      (game.folders as any)?.find(
        (f: any) =>
          f.name === LORE_INDEX_JOURNAL_NAME &&
          f.type === 'JournalEntry' &&
          f.folder?.id === modFolder.id,
      ) ?? null
    );
  }

  /** Load chapter names from the per-chapter journals in the lore-index subfolder. */
  private _loadChapters(): string[] {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return [];
    const excluded = new Set(['Overview', '_index']);
    return (
      (game.journal as any)
        ?.filter((j: any) => j.folder?.id === loreFolder.id && !excluded.has(j.name as string))
        .map((j: any) => j.name as string)
        .sort() ?? []
    );
  }

  /**
   * Load scene names for a chapter — only scenes with role "include"
   * (overview/skip headings are folded into the chapter Summary by the AI).
   *
   * Reads from the structured _index JSON record when available;
   * falls back to "Scene: X" journal pages otherwise.
   */
  private _loadScenesForChapter(chapterName: string): string[] {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return [];

    const chapterJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === chapterName,
    );
    if (!chapterJournal) return [];

    // Prefer the _index JSON record — it has explicit per-scene role fields
    const indexJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === '_index',
    );
    if (indexJournal) {
      const indexPage = (indexJournal.pages.contents as any[])?.find(
        (p: any) => p.name === 'index',
      );
      if (indexPage) {
        try {
          const raw = ((indexPage.text?.content as string) ?? '').replace(/<[^>]*>/g, '').trim();
          const loreIndex = JSON.parse(raw) as {
            scenes?: Record<string, Array<{ name: string; role: string }>>;
          };
          const sceneList = loreIndex.scenes?.[chapterJournal.id as string];
          if (sceneList) {
            return sceneList.filter((s) => s.role === 'include').map((s) => s.name);
          }
        } catch {
          /* fall through to journal page scan */
        }
      }
    }

    // Fallback: "Scene: X" journal pages (only written for include-role scenes)
    return (chapterJournal.pages.contents as any[])
      .filter((p: any) => (p.name as string)?.startsWith('Scene: '))
      .map((p: any) => (p.name as string).replace('Scene: ', ''));
  }
}
