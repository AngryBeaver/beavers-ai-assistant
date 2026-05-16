import {
  NAMESPACE,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
  SESSION_FOLDER_NAME,
  SUMMARY_JOURNAL_NAME,
} from '../definitions.js';
import { Settings } from './settings/Settings.js';
import { SETTINGS } from '../definitions.js';
import { AiService } from '../services/AiService.js';
import { LoreIndexWizard } from './LoreIndexWizard.js';

type SendPhase = 'idle' | 'asking' | 'asked';

interface ContextFlags {
  scene: boolean;
  locationScene: boolean;
  overview: boolean;
  actor: boolean;
  session: boolean;
}

interface AiGmWindowContext {
  loreIndexExists: boolean;
  availableChapters: string[];
  selectedChapter: string;
  availableScenes: string[];
  selectedScene: string;
  phase: SendPhase;
  response: string;
  questionText: string;
  contextFlags: ContextFlags;
}

export class AiGmWindow extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-gm-window',
    window: { title: 'AI Assistant', resizable: true },
    position: { width: 440 },
    actions: {
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
  private _phase: SendPhase = 'idle';
  private _response = '';
  private _abortController: AbortController | null = null;
  private _contextFlags: ContextFlags = {
    scene: true,
    locationScene: false,
    overview: false,
    actor: false,
    session: false,
  };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  static open(): void {
    if (!Settings.isConfigured()) {
      ui.notifications.error(
        'AI Assistant is not configured. Enable it in the AI Assistant settings.',
      );
      return;
    }

    if (!AiGmWindow._instance) {
      AiGmWindow._instance = new AiGmWindow();
      AiGmWindow._instance._loadSelections();
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
      response: this._response,
      questionText: this._questionText,
      contextFlags: { ...this._contextFlags },
    };
  }

  protected _onRender(_context: object, _options: object): void {
    const chapterSelect = this.element?.querySelector<HTMLSelectElement>('#ai-chapter-select');
    chapterSelect?.addEventListener('change', (e) => {
      this._selectedChapter = (e.target as HTMLSelectElement).value;
      this._selectedScene = '';
      this._saveSelections();
      void this.render({ force: true });
    });

    const sceneSelect = this.element?.querySelector<HTMLSelectElement>('#ai-scene-select');
    sceneSelect?.addEventListener('change', (e) => {
      this._selectedScene = (e.target as HTMLSelectElement).value;
      this._saveSelections();
      void this.render();
    });

    const questionArea = this.element?.querySelector<HTMLTextAreaElement>('#ai-question-input');
    questionArea?.addEventListener('input', (e) => {
      this._questionText = (e.target as HTMLTextAreaElement).value;
    });

    const flagKeys = ['scene', 'locationScene', 'overview', 'actor', 'session'] as const;
    for (const flag of flagKeys) {
      const cb = this.element?.querySelector<HTMLInputElement>(`input[name="ctx-${flag}"]`);
      cb?.addEventListener('change', (e) => {
        this._contextFlags[flag] = (e.target as HTMLInputElement).checked;
      });
    }
  }

  async close(options?: object): Promise<this> {
    AiGmWindow._instance = null;
    return super.close(options);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Abort the current AI call. */
  static _onStop(this: AiGmWindow): void {
    this._abortController?.abort();
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
      await AiService.create(game as unknown as any).stream(
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

  private _loadSelections(): void {
    this._selectedChapter = (game.settings.get(NAMESPACE, SETTINGS.AI_GM_CHAPTER) as string) || '';
    this._selectedScene = (game.settings.get(NAMESPACE, SETTINGS.AI_GM_SCENE) as string) || '';
  }

  private _saveSelections(): void {
    void game.settings.set(NAMESPACE, SETTINGS.AI_GM_CHAPTER, this._selectedChapter);
    void game.settings.set(NAMESPACE, SETTINGS.AI_GM_SCENE, this._selectedScene);
  }

  private _buildSceneContext(): string | null {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder || !this._selectedChapter || !this._selectedScene) return null;

    const chapterJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === this._selectedChapter,
    );
    if (!chapterJournal) return null;

    const pages: any[] = chapterJournal.pages.contents as any[];
    const parts: string[] = [];

    if (this._contextFlags.overview) {
      const summaryPage = pages.find((p: any) => p.name === 'Summary');
      if (summaryPage) {
        const text = this._pageText(summaryPage);
        if (text) parts.push(`## Chapter: ${this._selectedChapter}\n${text}`);
      }
    }

    if (this._contextFlags.scene) {
      const scenePage = pages.find((p: any) => p.name === `Scene: ${this._selectedScene}`);
      if (scenePage) {
        const text = this._pageText(scenePage);
        if (text) parts.push(`## Scene: ${this._selectedScene}\n${text}`);
      }
    }

    if (this._contextFlags.locationScene) {
      const locPage = pages.find((p: any) => p.name === `LocationScene: ${this._selectedScene}`);
      if (locPage) {
        const text = this._pageText(locPage);
        if (text) parts.push(`## Location: ${this._selectedScene}\n${text}`);
      }
    }

    if (this._contextFlags.actor) {
      const actorPage = pages.find((p: any) => p.name === `Actor: ${this._selectedScene}`);
      if (actorPage) {
        const text = this._pageText(actorPage);
        if (text) parts.push(`## Actors: ${this._selectedScene}\n${text}`);
      }
    }

    if (this._contextFlags.session) {
      const sessionJournal = this._findLatestSessionJournal();
      if (sessionJournal) {
        const transcriptPage = (sessionJournal.pages.contents as any[])?.find(
          (p: any) => p.name === 'Transcript',
        );
        if (transcriptPage) {
          const text = this._pageText(transcriptPage);
          if (text) parts.push(`## Session Log (${sessionJournal.name as string})\n${text}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  }

  private _findLatestSessionJournal(): any | null {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) return null;
    const sessionFolder = (game.folders as any)?.find(
      (f: any) =>
        f.name === SESSION_FOLDER_NAME &&
        f.type === 'JournalEntry' &&
        f.folder?.id === modFolder.id,
    );
    if (!sessionFolder) return null;
    const journals: any[] = (game.journal as any)?.filter(
      (j: any) => j.folder?.id === sessionFolder.id && j.name !== SUMMARY_JOURNAL_NAME,
    ) ?? [];
    journals.sort((a, b) => (a.name as string).localeCompare(b.name as string));
    return journals.at(-1) ?? null;
  }

  /** Raw text from a journal page (markdown-format preferred, HTML stripped otherwise). */
  private _pageText(page: any): string {
    if (page.text?.format === 2 && page.text.markdown) return page.text.markdown as string;
    return ((page.text?.content as string) ?? '').replace(/<[^>]*>/g, '').trim();
  }

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

  private _loadScenesForChapter(chapterName: string): string[] {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return [];

    const chapterJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === chapterName,
    );
    if (!chapterJournal) return [];

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

    return (chapterJournal.pages.contents as any[])
      .filter((p: any) => (p.name as string)?.startsWith('Scene: '))
      .map((p: any) => (p.name as string).replace('Scene: ', ''));
  }
}