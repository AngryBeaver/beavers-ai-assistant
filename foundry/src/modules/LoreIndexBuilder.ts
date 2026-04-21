import {
  NAMESPACE,
  SETTINGS,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
} from '../definitions.js';
import { AiService, CallOptions } from '../services/AiService.js';
import { GameData } from './ContextBuilder.js';
import { JournalApi } from './JournalApi.js';
import { ChapterCandidate, ChapterContentParser } from './JournalParser/index.js';
import { stripHtml, escapeHtml, unescapeHtml } from './loreIndexUtils.js';
import type { EnrichmentScene, NamedImage } from './EnrichmentPassRunner.js';

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

  /**
   * Index a single chapter: streams AI output, parses sentinel-delimited blocks,
   * and writes `Chapter: <name>` + `Scene: <name>` pages incrementally as each
   * block closes.
   *
   * @param chapterName  Name used for the journal page.
   * @param content      Pre-parsed markdown — produced by AdventureParser.parseContent.
   * @param callOptions  Model / token options passed to the AI service.
   * @param onProgress   Callback invoked for each log line (scene written, etc.).
   * @returns            Number of scenes written.
   */
  async indexChapter(
    chapterName: string,
    content: string,
    callOptions: CallOptions,
    onProgress: (line: string) => void,
  ): Promise<number> {
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

    const userPrompt = `Index this chapter:\n\n${content}\n\nBegin with ---CHAPTER: ${chapterName}---`;

    // Write placeholder Summary page first so it appears as the first page in the journal
    await JournalApi.writeJournalPage(chapterJournal.id, {
      name: 'Summary',
      type: 'text',
      text: { markdown: '*(indexing…)*', format: 2 },
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
    let chapterSummary = '';

    const flushBlock = (block: Block, lines: string[]): void => {
      const text = lines.join('\n').trim();
      if (block.type === 'SCENE') {
        const name = block.name;
        writeChain = writeChain.then(async () => {
          await JournalApi.writeJournalPage(chapterJournal.id, {
            name: `Scene: ${name}`,
            type: 'text',
            text: { markdown: text, format: 2 },
          });
          onProgress(`  ✓ Scene: ${name}`);
          sceneCount++;
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
        type: 'text',
        text: { markdown: chapterSummary, format: 2 },
      });
      onProgress(`  ✓ Chapter summary written.`);
    }

    return sceneCount;
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
      type: 'text',
      text: { content: `<div>${escapeHtml(overview)}</div>`, format: 1 },
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
        const text = stripHtml(summaryPage.text?.content ?? '').trim();
        if (text) summaries.push(`## ${journal.name}\n${text}`);
      }
    }
    return summaries;
  }

  // ---------------------------------------------------------------------------
  // Map enrichment
  // ---------------------------------------------------------------------------

  /**
   * Collect all indexed scenes and their candidate map images.
   *
   * Images are filtered to the same chapter as each scene — only images from
   * the chapter's source journals/folders are offered as candidates.
   *
   * @param chapters  Confirmed chapter candidates (from the wizard). When empty
   *                  (e.g. launched directly from location step) falls back to
   *                  scanning all images from the fallback location.
   * @param fallbackLocationId   Adventure location used when chapters is empty.
   * @param fallbackLocationType Adventure location type used when chapters is empty.
   */
  collectEnrichmentScenes(
    chapters: ChapterCandidate[],
    fallbackLocationId: string,
    fallbackLocationType: 'folder' | 'journal',
  ): EnrichmentScene[] {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return [];

    const chapterJournals: any[] =
      (this.#game as any).journal?.filter(
        (j: any) => j.folder?.id === loreFolder.id && j.name !== 'Overview',
      ) ?? [];

    // Collect images per chapter from source
    const chapterImagesMap = new Map<string, NamedImage[]>();
    for (const chapter of chapters) {
      chapterImagesMap.set(chapter.name, this._collectImagesForChapter(chapter));
    }

    // Fallback images when no chapter candidates available
    const fallbackImages: NamedImage[] =
      chapters.length === 0
        ? this._collectAdventureImages(fallbackLocationId, fallbackLocationType).map((url) => ({
            url,
            name: url.split('/').pop()?.split('?')[0] ?? url,
          }))
        : [];

    // Build one entry per Scene page across all chapter journals
    const scenes: EnrichmentScene[] = [];
    for (const journal of chapterJournals) {
      const chapterName = journal.name as string;
      const images = chapterImagesMap.get(chapterName) ?? fallbackImages;
      for (const p of journal.pages.contents as any[]) {
        if (!p.name?.startsWith('Scene: ')) continue;
        const sceneName = (p.name as string).replace('Scene: ', '');
        const pageText = stripHtml(p.text?.content ?? '');
        const hasConnections = pageText.includes('#### Connections');
        scenes.push({ sceneName, chapterName, images, hasConnections });
      }
    }

    return scenes;
  }

  /**
   * Run the vision AI call for one scene and write the `#### Connections` section.
   *
   * @param sceneName   Name of the `Scene: <name>` page to update.
   * @param imageUrl    URL of the map image to analyse.
   * @param mode        'replace' removes any existing Connections block first;
   *                    'add' appends after any existing block.
   * @param callOptions Model / token options (model required for LocalAI).
   * @param onProgress  Callback for log lines shown in the wizard.
   */
  async enrichSceneWithMap(
    sceneName: string,
    imageUrl: string,
    mode: 'replace' | 'add',
    callOptions: CallOptions,
    onProgress: (line: string) => void,
  ): Promise<void> {
    if (!this.#aiService.callWithImage) {
      throw new Error('The selected AI provider does not support vision calls.');
    }

    // Read current scene page
    const currentText = this._readScenePageText(sceneName);
    if (currentText === null) {
      throw new Error(`Scene page not found: "Scene: ${sceneName}"`);
    }

    const systemPrompt = `You are analysing a tabletop RPG map image to extract spatial connections between numbered or lettered areas.

Output ONLY a markdown Connections block in this exact format:

#### Connections

- \`A -> B\` : door
- \`B -> C\` : open
- \`C -> lower-level\` : ladder  *(one-way down)*

Connection types: open, door, hidden-door, ladder, stairs, secret-passage.
Add a note in italics only when meaningful (e.g. one-way, locked, DC value, key location).
Symmetric connections are written once. Write nothing else — no prose, no headings other than #### Connections.`;

    const userPrompt = `Here is the complete description of the scene from the lore index:\n\n${currentText}\n\nUsing the scene description above and the map image, output ONLY the Connections block.`;

    onProgress(`  → Calling vision AI…`);

    const result = await this.#aiService.callWithImage(systemPrompt, userPrompt, imageUrl, {
      ...callOptions,
      max_tokens: 8192,
    });

    onProgress(`  → Writing connections…`);

    // Build updated page text
    let updatedText = currentText;
    if (mode === 'replace') {
      // Remove existing Connections block
      updatedText = updatedText.replace(
        /\n?#### Connections\n[\s\S]*?(?=\n#### |\n---|\n##|$)/,
        '',
      );
    }

    // Ensure the connections block starts on a new line
    const connections = result.trim().startsWith('#### Connections')
      ? result.trim()
      : `#### Connections\n\n${result.trim()}`;
    updatedText = updatedText.trimEnd() + '\n\n' + connections;

    const sceneJournalId = this._findJournalForScene(sceneName);
    if (!sceneJournalId) throw new Error(`Scene journal not found for: "Scene: ${sceneName}"`);
    await JournalApi.writeJournalPage(sceneJournalId, {
      name: `Scene: ${sceneName}`,
      type: 'text',
      text: { content: `<div>${escapeHtml(updatedText)}</div>`, format: 1 },
    });

    onProgress(`  ✓ Connections written.`);
  }

  // ---------------------------------------------------------------------------
  // Private — enrichment helpers
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

  private _findJournalForScene(sceneName: string): string | null {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return null;
    const journals: any[] =
      (this.#game as any).journal?.filter((j: any) => j.folder?.id === loreFolder.id) ?? [];
    for (const journal of journals) {
      const page = (journal.pages.contents as any[]).find(
        (p: any) => p.name === `Scene: ${sceneName}`,
      );
      if (page) return journal.id as string;
    }
    return null;
  }

  private _readScenePageText(sceneName: string): string | null {
    const journalId = this._findJournalForScene(sceneName);
    if (!journalId) return null;
    const journal = (this.#game as any).journal?.get(journalId);
    if (!journal) return null;
    const page = (journal.pages.contents as any[]).find(
      (p: any) => p.name === `Scene: ${sceneName}`,
    );
    if (!page) return null;
    const html: string = page.text?.content ?? '';
    const inner = html.replace(/^<div>([\s\S]*)<\/div>$/, '$1');
    return unescapeHtml(inner);
  }

  /**
   * Extract all images from a chapter's source content, with names derived from:
   * alt text → figcaption → nearest heading before the image → page name.
   */
  private _collectImagesForChapter(chapter: ChapterCandidate): NamedImage[] {
    const images: NamedImage[] = [];
    const journals: any[] = [];

    if (chapter.sourceType === 'folder') {
      this._collectJournalsInFolder(chapter.id, journals);
    } else if (chapter.sourceType === 'journal') {
      const j = (this.#game as any).journal?.find((j: any) => j.id === chapter.id);
      if (j) journals.push(j);
    } else if (chapter.sourceType === 'page') {
      const journalId = chapter.id.split('::page::')[0];
      const j = (this.#game as any).journal?.find((j: any) => j.id === journalId);
      if (j) journals.push(j);
    }

    for (const journal of journals) {
      for (const page of journal.pages.contents as any[]) {
        if (page.type === 'image' && page.src) {
          images.push({ url: page.src as string, name: (page.name as string) || journal.name });
        }
        const html: string = page.text?.content ?? '';
        images.push(...this._extractImagesWithNames(html, (page.name as string) || journal.name));
      }
    }

    // Deduplicate by URL, preserving first occurrence
    const seen = new Set<string>();
    return images.filter((img) => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });
  }

  /**
   * Scan HTML content for <img> tags and return each with a derived name.
   * Priority: alt attribute → <figcaption> immediately after → nearest preceding
   * heading → fallback (page/journal name passed in).
   */
  private _extractImagesWithNames(html: string, fallback: string): NamedImage[] {
    const results: NamedImage[] = [];
    let lastHeading = fallback;

    const tokenRe =
      /<(h[1-6])[^>]*>[\s\S]*?<\/\1>|<img\s[^>]*\/?>|<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi;

    let lastImgIdx = -1;

    for (const match of html.matchAll(tokenRe)) {
      const tag = match[0];

      if (/^<h[1-6]/i.test(tag)) {
        lastHeading = stripHtml(tag).trim() || lastHeading;
        lastImgIdx = -1;
      } else if (/^<img/i.test(tag)) {
        const srcMatch = tag.match(/src=["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const url = srcMatch[1];
        const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
        const alt = altMatch?.[1]?.trim() ?? '';
        results.push({ url, name: alt || lastHeading });
        lastImgIdx = results.length - 1;
      } else if (/^<figcaption/i.test(tag) && lastImgIdx >= 0) {
        // Upgrade the immediately preceding image's name with the caption if its
        // name is still just the heading fallback (alt was empty)
        const caption = stripHtml(tag).trim();
        if (caption && results[lastImgIdx].name === lastHeading) {
          results[lastImgIdx] = { ...results[lastImgIdx], name: caption };
        }
        lastImgIdx = -1;
      }
    }

    return results;
  }

  private _collectAdventureImages(
    locationId: string,
    locationType: 'folder' | 'journal',
  ): string[] {
    const urls: string[] = [];
    const journals: any[] = [];

    if (locationType === 'folder') {
      this._collectJournalsInFolder(locationId, journals);
    } else {
      const j = (this.#game as any).journal?.find((j: any) => j.id === locationId);
      if (j) journals.push(j);
    }

    for (const journal of journals) {
      for (const page of journal.pages.contents as any[]) {
        if (page.type === 'image' && page.src) {
          urls.push(page.src as string);
        }
        const html: string = page.text?.content ?? '';
        for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
          urls.push(match[1]);
        }
      }
    }

    return [...new Set(urls)];
  }

  private _collectJournalsInFolder(folderId: string, out: any[]): void {
    const journals =
      (this.#game as any).journal?.filter((j: any) => j.folder?.id === folderId) ?? [];
    out.push(...journals);
    const subfolders =
      (this.#game as any).folders?.filter(
        (f: any) => f.folder?.id === folderId && f.type === 'JournalEntry',
      ) ?? [];
    for (const sf of subfolders) {
      this._collectJournalsInFolder(sf.id, out);
    }
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

      const pageData = {
        name: 'Index',
        type: 'text' as const,
        text: { content: `<div>${escapeHtml(indexContent)}</div>`, format: 1 as const },
      };

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
