import {
  NAMESPACE,
  SETTINGS,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
} from '../definitions.js';
import { AiService, CallOptions } from '../services/AiService.js';
import { GameData } from './ContextBuilder.js';
import { JournalApi } from '../api/JournalApi.js';
import { ChapterCandidate, ChapterContentParser } from './JournalParser/index.js';
import { stripHtml, pageText } from './loreIndexUtils.js';
import type { EnrichmentChapter, EnrichmentScene } from './MapEnrichment/index.js';
import { MapImageCollector } from './MapEnrichment/index.js';
import type { LoreIndex, LoreChapter, LoreScene } from '../apps/LoreIndexWizard.types.js';

const LORE_INDEX_RECORD_JOURNAL = '_index';
const LORE_INDEX_RECORD_PAGE = 'index';

/**
 * Builds a hierarchical lore index from adventure journal pages.
 *
 * Two modes of operation:
 * - Per-chapter (Task 1.2): `indexChapter` + `indexOverview` write individual
 *   `Chapter:` / `Scene:` / `Overview` pages to the lore-index journal.
 * - Legacy monolithic (backwards compat): `build` dumps the whole adventure
 *   into a single "Index" page.
 */
export class LoreIndexBuilder {
  readonly #game: GameData;
  readonly #aiService: AiService;

  constructor(gameData: GameData, aiService?: AiService) {
    this.#game = gameData;
    this.#aiService = aiService ?? AiService.create(gameData);
  }

  // ---------------------------------------------------------------------------
  // Per-chapter indexing
  // ---------------------------------------------------------------------------

  /** Check whether a `Chapter: <name>` page already exists in the lore index. */
  isChapterIndexed(chapterName: string): boolean {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return false;
    const journal = (this.#game as any).journal?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === chapterName,
    );
    if (!journal) return false;
    return (journal.pages.contents as any[]).some((p: any) => p.name === 'Summary');
  }

  // ---------------------------------------------------------------------------
  // Structured lore index record (machine-readable JSON page)
  // ---------------------------------------------------------------------------

  async readIndex(): Promise<LoreIndex | null> {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return null;
    const journal = (this.#game as any).journal?.find(
      (j: any) => j.folder?.id === loreFolder.id && j.name === LORE_INDEX_RECORD_JOURNAL,
    );
    if (!journal) return null;
    const page = (journal.pages.contents as any[]).find(
      (p: any) => p.name === LORE_INDEX_RECORD_PAGE,
    );
    if (!page) return null;
    try {
      return JSON.parse(pageText(page)) as LoreIndex;
    } catch {
      return null;
    }
  }

  async writeIndex(index: LoreIndex): Promise<void> {
    const loreFolder = await this._ensureLoreIndexFolder();
    const journal =
      (this.#game as any).journal?.find(
        (j: any) => j.folder?.id === loreFolder.id && j.name === LORE_INDEX_RECORD_JOURNAL,
      ) ??
      (await (JournalEntry as any).create({
        name: LORE_INDEX_RECORD_JOURNAL,
        folder: loreFolder.id,
      }));
    await JournalApi.writeJournalPage(journal.id as string, {
      name: LORE_INDEX_RECORD_PAGE,
      text: '<pre>' + JSON.stringify(index, null, 2) + '</pre>',
      format: 'html',
    });
  }

  /**
   * Get the markdown content of a scene either from the lore index page or
   * by re-parsing from the adventure source (filtered to relevant headings).
   */
  getSceneContent(
    sceneName: string,
    loreScene: LoreScene,
    loreChapter: LoreChapter,
    mode: 'lore' | 'source',
  ): string {
    if (mode === 'lore') {
      const journal = (this.#game as any).journal?.find(
        (j: any) => j.id === loreChapter.loreJournalId,
      );
      if (!journal) return '';
      const page = (journal.pages.contents as any[]).find(
        (p: any) => p.id === loreScene.lorePageId,
      );
      if (!page) return '';
      return pageText(page).trim();
    }

    // Source mode: re-parse the chapter and filter to the scene's headings
    const candidate: ChapterCandidate = {
      id: loreChapter.sourceId,
      name: loreChapter.sourceName,
      sourceType: loreChapter.sourceType,
      role: 'chapter',
      tokens: 0,
    };
    return new ChapterContentParser(this.#game).parseScene(candidate, loreScene.headings);
  }

  /**
   * Index a single chapter: streams AI output, parses sentinel-delimited blocks,
   * and writes `Chapter: <name>` + `Scene: <name>` pages incrementally as each
   * block closes.
   *
   * @param chapterName    Name used for the journal page.
   * @param content        Pre-parsed markdown — produced by AdventureParser.parseContent.
   * @param callOptions    Model / token options passed to the AI service.
   * @param onProgress     Callback invoked for each log line (scene written, etc.).
   * @param includeHints   Optional heading texts to focus on / skip (from scene step).
   * @returns              Number of scenes written.
   */
  async indexChapter(
    chapterName: string,
    content: string,
    callOptions: CallOptions,
    onProgress: (line: string) => void,
    includeHints?: { include: string[]; skip: string[]; overview: string[] },
  ): Promise<{ sceneCount: number; sceneNames: string[]; journalId: string }> {
    if (!content.trim()) {
      throw new Error(`No content found for chapter: "${chapterName}"`);
    }

    const loreFolder = await this._ensureLoreIndexFolder();
    const chapterJournal = await this._ensureChapterJournal(chapterName, loreFolder.id);

    const systemPrompt = `You are a lore indexer for a tabletop RPG adventure.
You will receive the raw content of one adventure chapter and produce a structured index.

IDENTIFYING SCENES vs AREAS:
A scene is a major narrative beat or distinct location a party visits as a whole.
Sub-locations (rooms, shops, buildings) inside a scene are areas within that scene — not separate scenes.

If a section title begins with a number, or a letter followed by a number (e.g. "R1. Cellar",
"A3. Guard Post", "1. Entrance Hall", "2a. Side Chamber"), that section describes an AREA within
the current scene — not a new scene. These are map identifiers used to locate areas on a map.
Preserve them exactly — they are critical for map scanning later.

Even without an explicit identifier, sub-locations within a larger place (individual shops in a
town, rooms in a dungeon, buildings in a settlement) are areas, not scenes. Ask: can the party
travel to this as a standalone destination, or is it a part of somewhere they are already?

Use EXACTLY these sentinel delimiters — each on its own line:
---CHAPTER: <chapter name>---
<chapter content — four sections, see below>
---SCENE: <scene name>---
<scene content — see below>

CHAPTER block must contain exactly these four sections in order:

## Overview
What this chapter is about — arc, theme, central tension. 2–4 sentences.

## Scenes
- **Scene: <name>** — one sentence: what happens and why it matters to the arc.
(one bullet per scene, in play order)

## Narrative Flow
How scenes connect. Which are optional. What gates what. Short prose or brief list.

## NPCs
| NPC | Role in chapter | New information revealed here |
|---|---|---|
| ... | ... | ... |
(only NPCs who appear in this chapter; record what is NEW here, not full biography)

SCENE block format:
Brief summary — what is at stake, who is involved. 2-3 sentences.

#### NPCs
| NPC | Role in scene | Notes |
|---|---|---|
| ... | ... | area <id> if applicable, key info |

#### <id>. <Area Name>
This is an index entry, not a transcription. Include:
- Enemies present and any tactically relevant behaviour (e.g. fleeing to trigger a trap, calling reinforcements)
- Story-relevant items or loot (quest items, named objects, prisoner locations)
- Traps or hazards only if they have narrative or tactical significance (e.g. enemies use them against the party)
- Key lore or interactable elements a GM needs at a glance
Do NOT include: DCs, generic treasure, flavour descriptions, area connections or exits (those are added separately by map scanning).
Use short prose or a brief bullet list.
(one #### header per area, using the exact identifier from the source;
if the source has no explicit identifiers, use a short descriptive heading)

AREA HEADING RULES:
- If the source area name starts with the scene name followed by a separator (—, :, -, /, etc.), strip the scene name prefix. Write only the remainder as the area heading. For example, if the scene is "Cragmaw Hideout" and the source says "Cragmaw Hideout — Cave Mouth", write "#### Cave Mouth" not "#### Cragmaw Hideout — Cave Mouth".
- Only create area entries for actual physical sub-locations (rooms, chambers, buildings, outdoor zones). Skip general feature or rule sections such as "Ceilings", "Lighting", "Doors", "Random Encounters", "Wandering Monsters" — fold any tactically relevant content from those into the scene summary instead.
- Do not create an area entry whose heading is the same as the scene name. If the whole scene has no sub-areas, write the scene summary only.

Rules:
- A scene is a distinct location or narrative beat — not every section heading is a scene.
- Write neutrally — no visited/unvisited framing.
- Preserve all area identifiers exactly as they appear in the source (1., 2a., A., B., R1., etc.) — never renumber or strip them.
- Do not invent scenes, NPCs, or locations not in the source.
- Output exactly one ---CHAPTER: ...--- block followed by one ---SCENE: ...--- block per scene.`;

    const hintLines: string[] = [];
    if (includeHints?.include.length) {
      hintLines.push(
        `Focus on these sections: ${includeHints.include.map((h) => `"${h}"`).join(', ')}.`,
      );
    }
    if (includeHints?.overview.length) {
      hintLines.push(
        `Treat these as overview/background, not standalone scenes: ${includeHints.overview.map((h) => `"${h}"`).join(', ')}.`,
      );
    }
    if (includeHints?.skip.length) {
      hintLines.push(
        `Skip these sections entirely: ${includeHints.skip.map((h) => `"${h}"`).join(', ')}.`,
      );
    }
    const hintBlock = hintLines.length ? `\n\nGuidance:\n${hintLines.join('\n')}` : '';
    const userPrompt = `Index this chapter:\n\n${content}${hintBlock}\n\nBegin with ---CHAPTER: ${chapterName}---`;

    // Write placeholder Summary page first so it appears as the first page in the journal
    await JournalApi.writeJournalPage(chapterJournal.id, {
      name: 'Summary',
      text: '*(indexing…)*',
    });

    onProgress(`→ Sending to AI…`);

    // Stream the response, writing pages incrementally as each block closes.
    // onChunk is synchronous, so page writes are queued as a sequential promise chain.
    let writeChain: Promise<void> = Promise.resolve();
    let buffer = '';
    type Block = { type: 'CHAPTER' | 'SCENE'; name: string };
    let currentBlock: Block | null = null;
    let currentLines: string[] = [];
    let sceneCount = 0;
    const sceneNames: string[] = [];
    let chapterSummary = '';

    const flushBlock = (block: Block, lines: string[]): void => {
      const text = lines.join('\n').trim();
      if (block.type === 'SCENE') {
        const name = block.name;
        writeChain = writeChain.then(async () => {
          await JournalApi.writeJournalPage(chapterJournal.id, {
            name: `Scene: ${name}`,
            text,
          });
          onProgress(`  ✓ Scene: ${name}`);
          sceneCount++;
          sceneNames.push(name);
        });
      } else if (block.type === 'CHAPTER') {
        chapterSummary = text;
      }
    };

    await this.#aiService.stream(
      systemPrompt,
      userPrompt,
      (chunk, type) => {
        if (type !== 'content') return;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const chm = line.match(/^---CHAPTER:\s*([^-]+?)\s*---\s*$/);
          const scm = line.match(/^---SCENE:\s*([^-]+?)\s*---\s*$/);
          if (chm) {
            if (currentBlock) flushBlock(currentBlock, currentLines);
            currentBlock = { type: 'CHAPTER', name: chm[1] };
            currentLines = [];
          } else if (scm) {
            if (currentBlock) flushBlock(currentBlock, currentLines);
            currentBlock = { type: 'SCENE', name: scm[1] };
            currentLines = [];
          } else if (currentBlock) {
            currentLines.push(line);
          }
        }
      },
      callOptions,
    );

    // Flush remaining buffer + final block
    if (buffer && currentBlock) currentLines.push(buffer);
    if (currentBlock) flushBlock(currentBlock, currentLines);

    // Wait for all scene page writes to complete
    await writeChain;

    // Update the Summary placeholder with the real content
    if (chapterSummary) {
      await JournalApi.writeJournalPage(chapterJournal.id, {
        name: 'Summary',
        text: chapterSummary,
      });
      onProgress(`  ✓ Chapter summary written.`);
    }

    return { sceneCount, sceneNames, journalId: chapterJournal.id as string };
  }

  /**
   * Generate the `Overview` page from existing `Chapter:` pages in the lore
   * index, plus optional background source text from an overview-role chapter.
   */
  async indexOverview(overviewSource?: string, callOptions?: CallOptions): Promise<void> {
    const loreFolder = await this._ensureLoreIndexFolder();
    const overviewJournal = await this._ensureChapterJournal('Overview', loreFolder.id);

    const chapterSummaries = this._readChapterSummaries();

    const systemPrompt = `You are a lore indexer for a tabletop RPG adventure.
Produce the Overview page using EXACTLY this structure:

## World Context
Brief setting introduction — geography, factions at play, the adventure's central conflict. 1–2 paragraphs.

## Factions
| Faction | Goal | Key figure |
|---|---|---|
| ... | ... | ... |

## NPC Index
| NPC | Brief description | Appears in |
|---|---|---|
| ... | ... | Chapter 1, Chapter 3 (use the chapter names exactly as they appear) |

Rules:
- Write neutrally — no visited/unvisited framing.
- The NPC Index is a master index only — do not duplicate detail that lives in chapter pages.
- "Appears in" lists which chapters the NPC features in.
- Keep the whole page under 1000 words.`;

    const parts = [
      overviewSource ? `## Background Source\n${overviewSource}` : '',
      chapterSummaries.length > 0 ? `## Chapter Summaries\n${chapterSummaries.join('\n\n')}` : '',
    ].filter(Boolean);

    const userPrompt = `Produce the Overview page from this adventure content:\n\n${parts.join('\n\n')}`;

    const { content: overview } = await this.#aiService.call(systemPrompt, userPrompt, {
      ...(callOptions ?? {}),
      max_tokens: 4096,
    });

    await JournalApi.writeJournalPage(overviewJournal.id, {
      name: 'Overview',
      text: overview,
    });
  }

  // ---------------------------------------------------------------------------
  // Private — per-chapter helpers
  // ---------------------------------------------------------------------------

  private async _ensureLoreIndexFolder(): Promise<any> {
    let modFolder = (this.#game as any).folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) {
      modFolder = await (Folder as any).create({ name: MODULE_FOLDER_NAME, type: 'JournalEntry' });
    }
    let loreFolder = (this.#game as any).folders?.find(
      (f: any) =>
        f.name === LORE_INDEX_JOURNAL_NAME &&
        f.type === 'JournalEntry' &&
        f.folder?.id === modFolder.id,
    );
    if (!loreFolder) {
      loreFolder = await (Folder as any).create({
        name: LORE_INDEX_JOURNAL_NAME,
        type: 'JournalEntry',
        folder: modFolder.id,
      });
    }
    return loreFolder;
  }

  private async _ensureChapterJournal(chapterName: string, loreFolderId: string): Promise<any> {
    let journal = (this.#game as any).journal?.find(
      (j: any) => j.folder?.id === loreFolderId && j.name === chapterName,
    );
    if (!journal) {
      journal = await (JournalEntry as any).create({ name: chapterName, folder: loreFolderId });
    }
    return journal;
  }

  private _readChapterSummaries(): string[] {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return [];

    const summaries: string[] = [];
    const journals =
      (this.#game as any).journal?.filter(
        (j: any) => j.folder?.id === loreFolder.id && j.name !== 'Overview',
      ) ?? [];
    for (const journal of journals) {
      const summaryPage = (journal.pages.contents as any[]).find((p: any) => p.name === 'Summary');
      if (summaryPage) {
        const text = pageText(summaryPage).trim();
        if (text) summaries.push(`## ${journal.name}\n${text}`);
      }
    }
    return summaries;
  }

  // ---------------------------------------------------------------------------
  // Map enrichment
  // ---------------------------------------------------------------------------

  /**
   * Build the chapter-by-chapter enrichment queue from the stored LoreIndex record.
   *
   * For each chapter in the index (role !== 'skip'), collects candidate map images
   * from the chapter's source content and pairs them with each indexed scene page.
   */
  async collectEnrichmentChapters(): Promise<EnrichmentChapter[]> {
    const index = await this.readIndex();
    if (!index) return [];

    const chapters: EnrichmentChapter[] = [];

    for (const loreChapter of index.chapters) {
      if (loreChapter.role === 'skip') continue;
      const loreScenes = index.scenes[loreChapter.loreJournalId] ?? [];
      if (loreScenes.length === 0) continue;

      const chapterCandidate: ChapterCandidate = {
        id: loreChapter.sourceId,
        name: loreChapter.sourceName,
        sourceType: loreChapter.sourceType,
        role: 'chapter',
        tokens: 0,
      };
      const images = new MapImageCollector(this.#game as any).collectForChapter(chapterCandidate);
      const parser = new ChapterContentParser(this.#game as any);

      const journal = (this.#game as any).journal?.find(
        (j: any) => j.id === loreChapter.loreJournalId,
      );

      const scenes: EnrichmentScene[] = loreScenes
        .filter((s) => s.role !== 'skip')
        .map((s) => {
          let hasConnections = false;
          if (journal) {
            const page = (journal.pages.contents as any[]).find(
              (p: any) => p.name === `Scene: ${s.name}`,
            );
            if (page) {
              hasConnections = pageText(page).includes('#### Connections');
            }
          }
          return {
            sceneName: s.name,
            chapterName: loreChapter.loreJournalName,
            images,
            hasConnections,
            sourceText: parser.parseScene(chapterCandidate, [s.name]),
          };
        });

      if (scenes.length > 0) {
        chapters.push({
          chapterName: loreChapter.loreJournalName,
          loreJournalId: loreChapter.loreJournalId,
          scenes,
        });
      }
    }

    return chapters;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _getLoreIndexFolder(): any | null {
    const modFolder = (this.#game as any).folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) return null;
    return (
      (this.#game as any).folders?.find(
        (f: any) =>
          f.name === LORE_INDEX_JOURNAL_NAME &&
          f.type === 'JournalEntry' &&
          f.folder?.id === modFolder.id,
      ) ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Legacy monolithic build (backwards compatibility)
  // ---------------------------------------------------------------------------

  /**
   * Build or rebuild the entire lore index in one AI call, writing a single
   * "Index" page. Kept for backwards compatibility; prefer `indexChapter` +
   * `indexOverview` for new usage.
   */
  async build(): Promise<string> {
    const adventureFolder =
      (this.#game.settings.get(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER) as string) || '';

    if (!adventureFolder) {
      throw new Error('Adventure journal folder is not configured in AI Assistant settings.');
    }

    const advFolder = this.#game.folders?.find(
      (f) => f.name === adventureFolder && f.type === 'JournalEntry',
    );
    if (!advFolder) {
      throw new Error(`Adventure folder not found: "${adventureFolder}"`);
    }

    const fakeChapter: ChapterCandidate = {
      id: advFolder.id,
      name: advFolder.name,
      sourceType: 'folder',
      role: 'chapter',
      tokens: 0,
    };
    const content = new ChapterContentParser(this.#game).parse(fakeChapter);
    if (!content.trim()) {
      throw new Error(`No journal pages found in adventure folder: "${adventureFolder}"`);
    }

    console.log(`[Lore Index] Sending content to AI service...`);

    const index = await this._generateIndex(content);
    await this._writeIndex(index);

    console.log(`[Lore Index] Successfully built and saved index.`);
    return index;
  }

  private async _generateIndex(contentToIndex: string): Promise<string> {
    const systemPrompt = `You are a lore index builder for a tabletop RPG campaign.
You will receive raw adventure journal content and produce a hierarchical, structured index.

The index should be organized as:
- Adventure Chapters (e.g., "## Chapter 1: The Arrival")
  - Scene summaries under each Chapter (e.g., "### Scene 1: The Road to Millhaven")
    - Summary (what happens in this scene)
    - Parts (Some Scenes are big and have multiple parts e.g. sublocations/rooms short summary of each of those if any)
    - NPCs Present (list with brief descriptions)
    - Locations (list with brief descriptions)
    - Factions (list with brief descriptions)
- Global World section (## World (Global Context))
  - All NPCs (consolidated list)
  - All Locations (consolidated list)
  - All Factions (consolidated list)

Structure the index ONLY from the provided content. Do NOT invent new scenes, NPCs, or locations.
Keep descriptions concise (1-3 line per entry in lists).`;

    const userPrompt = `Build a hierarchical lore index from this adventure content:

${contentToIndex}

Produce the index as markdown. Start directly with ## Part 1 or ## World if there are no explicit parts.`;

    try {
      const { content: index } = await this.#aiService.call(systemPrompt, userPrompt, {
        max_tokens: 8192,
      });
      return index;
    } catch (err) {
      console.error('AI service error:', err);
      throw new Error(`Failed to generate lore index: ${(err as Error).message}`);
    }
  }

  private async _writeIndex(indexContent: string): Promise<void> {
    try {
      const modFolder = this.#game.folders?.find(
        (f) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
      );
      if (!modFolder) {
        throw new Error(
          `Module folder "${MODULE_FOLDER_NAME}" not found. It should be created automatically.`,
        );
      }

      const indexJournal = this.#game.journal?.find(
        (j) => j.folder?.id === modFolder.id && j.name === LORE_INDEX_JOURNAL_NAME,
      );

      const pageData = { name: 'Index', text: indexContent };

      if (!indexJournal) {
        await JournalApi.writeJournal({
          name: LORE_INDEX_JOURNAL_NAME,
          folder: MODULE_FOLDER_NAME,
          pages: [pageData],
        });
      } else {
        await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, pageData);
      }
    } catch (err) {
      console.error('Failed to write lore index journal:', err);
      throw new Error(`Failed to save lore index: ${(err as Error).message}`);
    }
  }
}
