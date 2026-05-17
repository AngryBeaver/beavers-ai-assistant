import {
  NAMESPACE,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
  SESSION_FOLDER_NAME,
  SUMMARY_JOURNAL_NAME,
  ACTORS_FOLDER_NAME,
} from '../definitions.js';
import { Settings } from './settings/Settings.js';
import { SETTINGS } from '../definitions.js';
import { LoreIndexWizard } from './LoreIndexWizard.js';
import { pageText } from '../modules/loreIndexUtils.js';
import type { AiGmExtension, ContextFlags, SharedContext } from './AiGmExtension.js';
import { ChatExtension } from './extensions/ChatExtension.js';
import { ActorExtension } from './extensions/ActorExtension.js';

export class AiGmWindow extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-ai-gm-window',
    window: { title: 'AI Assistant', resizable: true },
    position: { width: 440 },
    actions: {
      openSettings: AiGmWindow._onOpenSettings,
      openAdventureSetup: AiGmWindow._onOpenAdventureSetup,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${NAMESPACE}/templates/ai-gm-window.hbs`,
    },
  };

  private static _instance: AiGmWindow | null = null;

  // ---------------------------------------------------------------------------
  // Shared header state
  // ---------------------------------------------------------------------------

  private _selectedChapter = '';
  private _selectedScene = '';
  private _contextFlags: ContextFlags = {
    scene: true,
    locationScene: false,
    overview: false,
    actor: false,
    session: false,
  };

  // ---------------------------------------------------------------------------
  // Tab management
  // ---------------------------------------------------------------------------

  private _activeTabId = 'chat';
  private readonly _extensions: AiGmExtension[] = [new ChatExtension(), new ActorExtension()];

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

  async _prepareContext(_options: object): Promise<object> {
    const availableChapters = this._loadChapters();
    const loreIndexExists = availableChapters.length > 0;
    if (!this._selectedChapter && loreIndexExists) {
      this._selectedChapter = availableChapters[0];
    }
    const availableScenes = this._selectedChapter
      ? this._loadScenesForChapter(this._selectedChapter)
      : [];
    if (this._selectedScene && !availableScenes.includes(this._selectedScene)) {
      this._selectedScene = '';
    }

    const shared = this._buildSharedContext(loreIndexExists);
    const tabs = this._extensions.map((ext) => ({
      id: ext.id,
      label: ext.tabLabel,
      isActive: ext.id === this._activeTabId,
      context: ext.prepareContext(shared),
    }));

    return {
      loreIndexExists,
      availableChapters,
      selectedChapter: this._selectedChapter,
      availableScenes,
      selectedScene: this._selectedScene,
      contextFlags: { ...this._contextFlags },
      tabs,
    };
  }

  protected _onRender(_context: object, _options: object): void {
    // Chapter select
    this.element
      ?.querySelector<HTMLSelectElement>('#ai-chapter-select')
      ?.addEventListener('change', (e) => {
        this._selectedChapter = (e.target as HTMLSelectElement).value;
        this._selectedScene = '';
        this._saveSelections();
        void this.render({ force: true });
      });

    // Scene select
    this.element
      ?.querySelector<HTMLSelectElement>('#ai-scene-select')
      ?.addEventListener('change', (e) => {
        this._selectedScene = (e.target as HTMLSelectElement).value;
        this._saveSelections();
        void this.render({ force: true });
      });

    // Context flags
    const flagKeys = ['scene', 'locationScene', 'overview', 'actor', 'session'] as const;
    for (const flag of flagKeys) {
      this.element
        ?.querySelector<HTMLInputElement>(`input[name="ctx-${flag}"]`)
        ?.addEventListener('change', (e) => {
          this._contextFlags[flag] = (e.target as HTMLInputElement).checked;
        });
    }

    // Tab navigation
    this.element?.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._activeTabId = btn.dataset.tabId!;
        void this.render({ force: true });
      });
    });

    // Per-extension panel wiring
    for (const ext of this._extensions) {
      const panel = this.element?.querySelector<HTMLElement>(`[data-tab-panel="${ext.id}"]`);
      if (!panel) continue;

      const getShared = (): SharedContext =>
        this._buildSharedContext(this._loadChapters().length > 0);
      const requestRender = async (): Promise<void> => {
        await this.render({ force: true });
      };

      ext.onRender(panel, requestRender);

      panel.querySelectorAll<HTMLButtonElement>('[data-ext-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          void ext.onButton(btn.dataset.extBtn!, getShared(), requestRender);
        });
      });

      panel.querySelectorAll<HTMLButtonElement>('[data-use-section]').forEach((btn) => {
        btn.addEventListener('click', () => {
          void ext.onUse(btn.dataset.useSection!, getShared(), requestRender);
        });
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

  static async _onOpenSettings(_this: AiGmWindow): Promise<void> {
    const menuKey = `${NAMESPACE}.aiAssistant`;
    const menu = (game.settings.menus as any).get(menuKey);
    if (menu?.settingsApp) menu.settingsApp.render(true);
  }

  static _onOpenAdventureSetup(): void {
    LoreIndexWizard.open();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _buildSharedContext(loreIndexExists: boolean): SharedContext {
    const loreFolder = this._getLoreIndexFolder();
    const chapterJournal =
      loreFolder && this._selectedChapter
        ? ((game.journal as any)?.find(
            (j: any) => j.folder?.id === loreFolder.id && j.name === this._selectedChapter,
          ) ?? null)
        : null;
    return {
      loreIndexExists,
      selectedChapter: this._selectedChapter,
      selectedScene: this._selectedScene,
      chapterJournalId: (chapterJournal?.id as string | undefined) ?? null,
      contextFlags: { ...this._contextFlags },
      sceneContext: this._buildSceneContext(loreFolder, chapterJournal),
    };
  }

  private _buildSceneContext(loreFolder: any | null, chapterJournal: any | null): string | null {
    const parts: string[] = [];

    if (loreFolder && chapterJournal && this._selectedScene) {
      const pages: any[] = chapterJournal.pages.contents as any[];

      if (this._contextFlags.overview) {
        const p = pages.find((pg: any) => pg.name === 'Summary');
        const text = p ? pageText(p) : '';
        if (text) parts.push(`## Chapter: ${this._selectedChapter}\n${text}`);
      }
      if (this._contextFlags.scene) {
        const p = pages.find((pg: any) => pg.name === `Scene: ${this._selectedScene}`);
        const text = p ? pageText(p) : '';
        if (text) parts.push(`## Scene: ${this._selectedScene}\n${text}`);
      }
      if (this._contextFlags.locationScene) {
        const p = pages.find((pg: any) => pg.name === `LocationScene: ${this._selectedScene}`);
        const text = p ? pageText(p) : '';
        if (text) parts.push(`## Location: ${this._selectedScene}\n${text}`);
      }
    }

    if (this._contextFlags.actor) {
      const actorsText = this._loadActorsContext();
      if (actorsText) parts.push(`## Actors\n${actorsText}`);
    }

    if (this._contextFlags.session) {
      const sessionJournal = this._findLatestSessionJournal();
      if (sessionJournal) {
        const transcriptPage = (sessionJournal.pages.contents as any[])?.find(
          (p: any) => p.name === 'Transcript',
        );
        if (transcriptPage) {
          const text = pageText(transcriptPage);
          if (text) parts.push(`## Session Log (${sessionJournal.name as string})\n${text}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  }

  private _loadActorsContext(): string | null {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) return null;
    const actorsFolder = (game.folders as any)?.find(
      (f: any) =>
        f.name === ACTORS_FOLDER_NAME && f.type === 'JournalEntry' && f.folder?.id === modFolder.id,
    );
    if (!actorsFolder) return null;

    const journals: any[] =
      (game.journal as any)?.filter((j: any) => j.folder?.id === actorsFolder.id) ?? [];
    const parts: string[] = [];
    for (const journal of journals) {
      for (const page of journal.pages.contents as any[]) {
        const text = pageText(page);
        if (text) parts.push(text);
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
    const journals: any[] =
      (game.journal as any)?.filter(
        (j: any) => j.folder?.id === sessionFolder.id && j.name !== SUMMARY_JOURNAL_NAME,
      ) ?? [];
    journals.sort((a, b) => (a.name as string).localeCompare(b.name as string));
    return journals.at(-1) ?? null;
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

  private _loadSelections(): void {
    this._selectedChapter = (game.settings.get(NAMESPACE, SETTINGS.AI_GM_CHAPTER) as string) || '';
    this._selectedScene = (game.settings.get(NAMESPACE, SETTINGS.AI_GM_SCENE) as string) || '';
  }

  private _saveSelections(): void {
    void game.settings.set(NAMESPACE, SETTINGS.AI_GM_CHAPTER, this._selectedChapter);
    void game.settings.set(NAMESPACE, SETTINGS.AI_GM_SCENE, this._selectedScene);
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
          const raw = pageText(indexPage).trim();
          const loreIndex = JSON.parse(raw) as {
            scenes?: Record<string, Array<{ name: string; role: string }>>;
          };
          const sceneList = loreIndex.scenes?.[chapterJournal.id as string];
          if (sceneList) return sceneList.filter((s) => s.role === 'include').map((s) => s.name);
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
