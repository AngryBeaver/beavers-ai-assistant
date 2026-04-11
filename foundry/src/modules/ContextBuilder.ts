import {
  DEFAULTS,
  LORE_INDEX_JOURNAL_NAME,
  MODULE_FOLDER_NAME,
  NAMESPACE,
  SETTINGS,
  SESSION_FOLDER_NAME,
  SUMMARY_JOURNAL_NAME,
} from '../definitions.js';
import { stripHtml } from './loreIndexUtils.js';

const LORE_CHAR_BUDGET = 4000 * 4; // ~4 000 tokens

export interface SceneData {
  name: string;
  description?: string;
  notes?: Array<{ journalEntryId?: string }>;
}

export interface ActorData {
  name: string;
  type: string;
  system?: {
    details?: { biography?: { value?: string } };
    description?: { value?: string };
  };
}

export interface JournalPageData {
  name: string;
  text?: { content?: string; markdown?: string; format?: number };
}

export interface JournalData {
  id: string;
  name: string;
  folder?: { id: string };
  pages: { contents: JournalPageData[] };
}

export interface FolderData {
  id: string;
  name: string;
  type: string;
  folder?: { id: string } | null;
}

export interface GameData {
  settings: {
    get(namespace: string, key: string): unknown;
  };
  scenes?: { active?: SceneData | null };
  actors?: { contents: ActorData[] };
  folders?: {
    find(fn: (f: FolderData) => boolean): FolderData | undefined;
    filter(fn: (f: FolderData) => boolean): FolderData[];
  };
  journal?: {
    find(fn: (j: JournalData) => boolean): JournalData | undefined;
    filter(fn: (j: JournalData) => boolean): JournalData[];
  };
}

function pageText(page: JournalPageData): string {
  if (page.text?.format === 2 && page.text.markdown) return page.text.markdown;
  return stripHtml(page.text?.content ?? '');
}

export class ContextBuilder {
  readonly #game: GameData;

  constructor(gameData: GameData) {
    this.#game = gameData;
  }

  async build(selectedChapter?: string, selectedScene?: string): Promise<string> {
    const historyLimit =
      (this.#game.settings.get(NAMESPACE, SETTINGS.SESSION_HISTORY_MESSAGES) as number) ||
      DEFAULTS.SESSION_HISTORY_MESSAGES;
    const adventureFolder =
      (this.#game.settings.get(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER) as string) || '';

    const [chatEntries, summaryContent, loreContent] = await Promise.all([
      this._readSessionChat(MODULE_FOLDER_NAME, SESSION_FOLDER_NAME),
      this._readSessionSummary(MODULE_FOLDER_NAME, SESSION_FOLDER_NAME),
      this._readLore(
        adventureFolder,
        MODULE_FOLDER_NAME,
        LORE_INDEX_JOURNAL_NAME,
        selectedChapter,
        selectedScene,
      ),
    ]);

    const scene = this.#game.scenes?.active ?? null;
    const actors = this.#game.actors?.contents ?? [];

    const sections: string[] = [];

    const sceneSection = this._buildSceneSection(scene);
    if (sceneSection) sections.push(sceneSection);

    const summarySection = this._buildSummarySection(summaryContent);
    if (summarySection) sections.push(summarySection);

    const chatSection = this._buildSessionChatSection(chatEntries, historyLimit);
    if (chatSection) sections.push(chatSection);

    const actorSection = this._buildActorSection(actors);
    if (actorSection) sections.push(actorSection);

    const loreSection = this._buildLoreSection(loreContent);
    if (loreSection) sections.push(loreSection);

    return sections.join('\n\n---\n\n');
  }

  // ---------------------------------------------------------------------------
  // Section builders
  // ---------------------------------------------------------------------------

  private _buildSceneSection(scene: SceneData | null | undefined): string {
    if (!scene) return '';
    const parts: string[] = [scene.name];

    // Try to get first journal from scene notes
    if (scene.notes && scene.notes.length > 0) {
      const firstNote = scene.notes[0];
      if (firstNote.journalEntryId) {
        const journal = this.#game.journal?.find((j) => j.id === firstNote.journalEntryId);
        if (journal && journal.pages.contents.length > 0) {
          const noteContent = pageText(journal.pages.contents[0]).trim();
          if (noteContent) parts.push(`**Notes:** ${noteContent}`);
        }
      }
    }

    return `## Current Scene\n${parts.join('\n')}`;
  }

  private _buildActorSection(actors: ActorData[]): string {
    if (!actors.length) return '';
    const lines = actors.map((a) => {
      const desc = a.system?.details?.biography?.value ?? a.system?.description?.value ?? '';
      const snippet = desc ? `: ${stripHtml(desc).slice(0, 200)}` : '';
      return `- ${a.name} (${a.type})${snippet}`;
    });
    return `## Known Actors\n${lines.join('\n')}`;
  }

  private _buildSessionChatSection(entries: string[], limit: number): string {
    if (!entries.length) return '';
    return `## Recent Session\n${entries.slice(-limit).join('\n')}`;
  }

  private _buildSummarySection(content: string | null): string {
    if (!content) return '';
    return `## Previously\n${content}`;
  }

  private _buildLoreSection(content: string | null): string {
    if (!content) return '';
    return `## Adventure Lore\n${content}`;
  }

  // ---------------------------------------------------------------------------
  // Lore helpers
  // ---------------------------------------------------------------------------

  extractKeywords(sceneName: string, chatEntries: string[], actorNames: string[]): string[] {
    const raw = [sceneName, ...chatEntries.slice(-10), ...actorNames].join(' ');
    return [
      ...new Set(
        raw
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3),
      ),
    ];
  }

  scoreLorePages(
    pages: Array<{ name: string; content: string }>,
    keywords: string[],
  ): Array<{ name: string; content: string; score: number }> {
    return pages
      .map((page) => {
        const lower = page.content.toLowerCase();
        const score = keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
        return { ...page, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------------------
  // Async readers
  // ---------------------------------------------------------------------------

  private async _readSessionChat(moduleFolder: string, sessionFolder: string): Promise<string[]> {
    const modFolder = this.#game.folders?.find(
      (f) => f.name === moduleFolder && f.type === 'JournalEntry',
    );
    if (!modFolder) return [];

    const folder = this.#game.folders?.find(
      (f) => f.name === sessionFolder && f.type === 'JournalEntry' && f.folder?.id === modFolder.id,
    );
    if (!folder) return [];

    const today = new Date().toISOString().slice(0, 10);
    const journal = this.#game.journal?.find(
      (j) => j.folder?.id === folder.id && j.name.startsWith(today),
    );
    if (!journal) return [];

    const entries: string[] = [];
    for (const page of journal.pages.contents) {
      const lines = pageText(page)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      entries.push(...lines);
    }
    return entries;
  }

  private async _readSessionSummary(
    moduleFolder: string,
    sessionFolder: string,
  ): Promise<string | null> {
    const modFolder = this.#game.folders?.find(
      (f) => f.name === moduleFolder && f.type === 'JournalEntry',
    );
    if (!modFolder) return null;

    const folder = this.#game.folders?.find(
      (f) => f.name === sessionFolder && f.type === 'JournalEntry' && f.folder?.id === modFolder.id,
    );
    if (!folder) return null;

    const journal = this.#game.journal?.find(
      (j) => j.folder?.id === folder.id && j.name === SUMMARY_JOURNAL_NAME,
    );
    if (!journal) return null;

    const pages = journal.pages.contents;
    if (!pages.length) return null;

    const content = pageText(pages[pages.length - 1]).trim();
    return content || null;
  }

  private async _readLore(
    adventureFolder: string,
    moduleFolder: string,
    indexJournalName: string,
    selectedChapter?: string,
    selectedScene?: string,
  ): Promise<string | null> {
    // Try three-tier index first
    const modFolder = this.#game.folders?.find(
      (f) => f.name === moduleFolder && f.type === 'JournalEntry',
    );
    const indexJournal = modFolder
      ? this.#game.journal?.find(
          (j) => j.folder?.id === modFolder.id && j.name === indexJournalName,
        )
      : undefined;

    if (indexJournal) {
      const indexed = this._readThreeTierIndex(indexJournal, selectedChapter, selectedScene);
      if (indexed) return indexed;
    }

    // Fallback: keyword-scored raw pages from adventure folder
    if (!adventureFolder) return null;

    const advFolder = this.#game.folders?.find(
      (f) => f.name === adventureFolder && f.type === 'JournalEntry',
    );
    if (!advFolder) return null;

    const journals = this.#game.journal?.filter((j) => j.folder?.id === advFolder.id) ?? [];
    const allPages: Array<{ name: string; content: string }> = [];
    for (const j of journals) {
      for (const page of j.pages.contents) {
        const content = pageText(page).trim();
        if (content) allPages.push({ name: `${j.name} / ${page.name}`, content });
      }
    }
    if (!allPages.length) return null;

    const sceneName = this.#game.scenes?.active?.name ?? '';
    const actorNames = (this.#game.actors?.contents ?? []).map((a) => a.name);
    const keywords = this.extractKeywords(sceneName, [], actorNames);
    const scored = this.scoreLorePages(allPages, keywords).filter((p) => p.score > 0);
    if (!scored.length) return null;

    let result = '';
    for (const page of scored) {
      if (result.length + page.content.length > LORE_CHAR_BUDGET) break;
      result += `### ${page.name}\n${page.content}\n\n`;
    }
    return result.trim() || null;
  }

  /**
   * Load lore pages from the three-tier index based on GM selection state:
   * - Chapter + Scene → Overview + Chapter:<name> + Scene:<name>
   * - Chapter only   → Overview + Chapter:<name>
   * - Nothing        → Overview only
   * - No Overview    → null (index not built yet, use fallback)
   */
  private _readThreeTierIndex(
    journal: JournalData,
    selectedChapter?: string,
    selectedScene?: string,
  ): string | null {
    const pages = journal.pages.contents;

    const overviewPage = pages.find((p) => p.name === 'Overview');
    if (!overviewPage) return null;

    const overviewText = pageText(overviewPage).trim();
    if (!overviewText) return null;

    const parts: string[] = [`## Overview\n${overviewText}`];

    if (selectedChapter) {
      const chapterPage = pages.find((p) => p.name === `Chapter: ${selectedChapter}`);
      if (chapterPage) {
        const text = pageText(chapterPage).trim();
        if (text) parts.push(`## Chapter: ${selectedChapter}\n${text}`);
      }

      if (selectedScene) {
        const scenePage = pages.find((p) => p.name === `Scene: ${selectedScene}`);
        if (scenePage) {
          const text = pageText(scenePage).trim();
          if (text) parts.push(`## Scene: ${selectedScene}\n${text}`);
        }
      }
    }

    return parts.join('\n\n---\n\n');
  }
}
