import {
  NAMESPACE,
  SETTINGS,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
} from '../definitions.js';
import { AiService, CallOptions } from '../services/AiService.js';
import { GameData } from './ContextBuilder.js';
import { JournalApi } from './JournalApi.js';
import { ChapterCandidate } from './ChapterDetector.js';
import { stripHtml, escapeHtml, unescapeHtml, parseIndexOutput } from './loreIndexUtils.js';
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
    const modFolder = (this.#game as any).folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    if (!modFolder) return false;
    const indexJournal = (this.#game as any).journal?.find(
      (j: any) => j.folder?.id === modFolder.id && j.name === LORE_INDEX_JOURNAL_NAME,
    );
    if (!indexJournal) return false;
    return (indexJournal.pages.contents as any[]).some(
      (p: any) => p.name === `Chapter: ${chapterName}`,
    );
  }

  /**
   * Collect and format the source text for a single chapter candidate.
   * Public so callers (e.g. LoreIndexWizard) can pass content to `indexOverview`.
   */
  collectChapterContent(chapter: ChapterCandidate): string {
    if (chapter.sourceType === 'folder') {
      return this._formatPagesForContext(this._collectPages(chapter.id));
    }
    if (chapter.sourceType === 'journal') {
      const journal = (this.#game as any).journal?.find((j: any) => j.id === chapter.id);
      if (!journal) return '';
      const pages = (journal.pages.contents as any[])
        .map((p: any) => ({
          journalName: journal.name as string,
          pageName: p.name as string,
          content: stripHtml(p.text?.content ?? '').trim(),
        }))
        .filter((p) => p.content);
      return this._formatPagesForContext(pages);
    }
    if (chapter.sourceType === 'header') {
      // id format: "${journalId}::h::${index}"
      const parts = chapter.id.split('::h::');
      if (parts.length !== 2) return '';
      return this._collectHeaderContent(parts[0], parseInt(parts[1], 10));
    }
    return '';
  }

  /**
   * Index a single chapter: calls AI, parses sentinel-delimited output, and
   * writes `Chapter: <name>` + `Scene: <name>` pages to the lore-index journal.
   *
   * @param chapter     The chapter candidate to index.
   * @param callOptions Model / token options passed to the AI service.
   * @param onProgress  Callback invoked for each log line (scene written, etc.).
   * @returns           Number of scenes written.
   */
  async indexChapter(
    chapter: ChapterCandidate,
    callOptions: CallOptions,
    onProgress: (line: string) => void,
  ): Promise<number> {
    await this._ensureLoreIndexJournal();

    const content = this.collectChapterContent(chapter);
    if (!content.trim()) {
      throw new Error(`No content found for chapter: "${chapter.name}"`);
    }

    const systemPrompt = `You are a lore indexer for a tabletop RPG adventure.
You will receive the raw content of one adventure chapter and produce a structured index.

Use EXACTLY these sentinel delimiters — each on its own line — to separate sections:
---CHAPTER: <chapter name>---
<neutral arc summary: what this chapter covers, all scenes listed, stakes, themes — ~200 words>
---SCENE: <scene name>---
<full scene detail: sublocations as a flat list, NPCs present with brief descriptions, what happens — ~300 words>

Rules:
- Include ALL scenes you can identify.
- Write neutrally — no visited/unvisited framing.
- Do not invent scenes, NPCs, or locations not present in the source.
- Output exactly one ---CHAPTER: ...--- block, then one ---SCENE: ...--- block per scene.`;

    const userPrompt = `Index this chapter:\n\n${content}\n\nBegin with ---CHAPTER: ${chapter.name}---`;

    onProgress(`→ Sending to AI…`);

    const { content: raw } = await this.#aiService.call(systemPrompt, userPrompt, {
      ...callOptions,
      max_tokens: 32768,
    });

    return this._writeChapterPages(chapter.name, raw, onProgress);
  }

  /**
   * Generate the `Overview` page from existing `Chapter:` pages in the lore
   * index, plus optional background source text from an overview-role chapter.
   */
  async indexOverview(overviewSource?: string, callOptions?: CallOptions): Promise<void> {
    await this._ensureLoreIndexJournal();

    const chapterSummaries = this._readChapterSummaries();

    const systemPrompt = `You are a lore indexer for a tabletop RPG adventure.
Produce a concise Overview page containing:
- Global NPCs (name + one-line description, no chapter-level duplicates)
- Factions (name + one-line description)
- World context (1–2 paragraphs: setting, tone, background)
Write neutrally — no visited/unvisited framing. Keep it under 500 words.`;

    const parts = [
      overviewSource ? `## Background Source\n${overviewSource}` : '',
      chapterSummaries.length > 0 ? `## Chapter Summaries\n${chapterSummaries.join('\n\n')}` : '',
    ].filter(Boolean);

    const userPrompt = `Produce the Overview page from this adventure content:\n\n${parts.join('\n\n')}`;

    const { content: overview } = await this.#aiService.call(systemPrompt, userPrompt, {
      ...(callOptions ?? {}),
      max_tokens: 4096,
    });

    await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, {
      name: 'Overview',
      type: 'text',
      text: { content: `<div>${escapeHtml(overview)}</div>`, format: 1 },
    });
  }

  // ---------------------------------------------------------------------------
  // Private — per-chapter helpers
  // ---------------------------------------------------------------------------

  private async _ensureLoreIndexJournal(): Promise<void> {
    const existing = (this.#game as any).journal?.find(
      (j: any) => j.name === LORE_INDEX_JOURNAL_NAME,
    );
    if (!existing) {
      await JournalApi.writeJournal({
        name: LORE_INDEX_JOURNAL_NAME,
        folder: MODULE_FOLDER_NAME,
        pages: [],
      });
    }
  }

  private async _writeChapterPages(
    chapterName: string,
    raw: string,
    onProgress: (line: string) => void,
  ): Promise<number> {
    const { chapterSummary, scenes } = parseIndexOutput(raw);

    // Write scenes first (matches expected log order)
    let sceneCount = 0;
    for (const [sceneName, sceneContent] of scenes) {
      await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, {
        name: `Scene: ${sceneName}`,
        type: 'text',
        text: { content: `<div>${escapeHtml(sceneContent)}</div>`, format: 1 },
      });
      onProgress(`  ✓ Scene: ${sceneName}`);
      sceneCount++;
    }

    await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, {
      name: `Chapter: ${chapterName}`,
      type: 'text',
      text: { content: `<div>${escapeHtml(chapterSummary)}</div>`, format: 1 },
    });
    onProgress(`  ✓ Chapter summary written.`);

    return sceneCount;
  }

  private _readChapterSummaries(): string[] {
    const modFolder = (this.#game as any).folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    const indexJournal = (this.#game as any).journal?.find(
      (j: any) => j.folder?.id === modFolder?.id && j.name === LORE_INDEX_JOURNAL_NAME,
    );
    if (!indexJournal) return [];

    const summaries: string[] = [];
    for (const page of indexJournal.pages.contents as any[]) {
      if (page.name?.startsWith('Chapter: ')) {
        const text = stripHtml(page.text?.content ?? '').trim();
        if (text) summaries.push(`## ${page.name}\n${text}`);
      }
    }
    return summaries;
  }

  private _collectHeaderContent(journalId: string, headerIndex: number): string {
    const journal = (this.#game as any).journal?.find((j: any) => j.id === journalId);
    if (!journal) return '';

    const allHtml = (journal.pages.contents as any[])
      .map((p: any) => p.text?.content ?? '')
      .join('\n');

    const sections: string[] = [];
    let current: string | null = null;
    for (const part of allHtml.split(/(<h[12][^>]*>[\s\S]*?<\/h[12]>)/gi)) {
      if (/^<h[12]/i.test(part)) {
        if (current !== null) sections.push(current);
        current = part;
      } else if (current !== null) {
        current += part;
      }
    }
    if (current !== null) sections.push(current);

    return sections[headerIndex] ? stripHtml(sections[headerIndex]) : '';
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
    const indexJournal = this._getLoreIndexJournal();
    if (!indexJournal) return [];

    const pages: any[] = indexJournal.pages.contents as any[];

    // Build chapter name → lore text (for scene association) and → images maps
    const chapterTextMap = new Map<string, string>();
    for (const p of pages) {
      if (p.name?.startsWith('Chapter: ')) {
        const name = (p.name as string).replace('Chapter: ', '');
        chapterTextMap.set(name, stripHtml(p.text?.content ?? '').toLowerCase());
      }
    }

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

    // Build one entry per Scene page
    const scenes: EnrichmentScene[] = [];
    for (const p of pages) {
      if (!p.name?.startsWith('Scene: ')) continue;
      const sceneName = (p.name as string).replace('Scene: ', '');
      const pageText = stripHtml(p.text?.content ?? '');
      const hasConnections = pageText.includes('#### Connections');

      const lowerScene = sceneName.toLowerCase();
      let chapterName = '';
      let images: NamedImage[] = fallbackImages;

      for (const [name, text] of chapterTextMap) {
        if (text.includes(lowerScene)) {
          chapterName = name;
          images = chapterImagesMap.get(name) ?? fallbackImages;
          break;
        }
      }

      scenes.push({ sceneName, chapterName, images, hasConnections });
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
      max_tokens: 1024,
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

    await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, {
      name: `Scene: ${sceneName}`,
      type: 'text',
      text: { content: `<div>${escapeHtml(updatedText)}</div>`, format: 1 },
    });

    onProgress(`  ✓ Connections written.`);
  }

  // ---------------------------------------------------------------------------
  // Private — enrichment helpers
  // ---------------------------------------------------------------------------

  private _getLoreIndexJournal(): any | null {
    const modFolder = (this.#game as any).folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    if (!modFolder) return null;
    return (
      (this.#game as any).journal?.find(
        (j: any) => j.folder?.id === modFolder.id && j.name === LORE_INDEX_JOURNAL_NAME,
      ) ?? null
    );
  }

  private _readScenePageText(sceneName: string): string | null {
    const journal = this._getLoreIndexJournal();
    if (!journal) return null;
    const page = (journal.pages.contents as any[]).find(
      (p: any) => p.name === `Scene: ${sceneName}`,
    );
    if (!page) return null;
    const html: string = page.text?.content ?? '';
    // Strip the outer <div> wrapper added by _writeChapterPages, then unescape
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
    } else if (chapter.sourceType === 'header') {
      const journalId = chapter.id.split('::h::')[0];
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

    const pages = this._collectPages(advFolder.id);
    if (!pages.length) {
      throw new Error(`No journal pages found in adventure folder: "${adventureFolder}"`);
    }

    console.log(`[Lore Index] Found ${pages.length} pages. Sending to AI service...`);

    const index = await this._generateIndex(this._formatPagesForContext(pages));
    await this._writeIndex(index);

    console.log(`[Lore Index] Successfully built and saved index.`);
    return index;
  }

  private _collectPages(
    folderId: string,
  ): Array<{ journalName: string; pageName: string; content: string }> {
    const pages: Array<{ journalName: string; pageName: string; content: string }> = [];

    const journals = this.#game.journal?.filter((j) => j.folder?.id === folderId) ?? [];
    for (const journal of journals) {
      for (const page of journal.pages.contents) {
        const content = stripHtml(page.text?.content ?? '').trim();
        if (content) pages.push({ journalName: journal.name, pageName: page.name, content });
      }
    }

    const subfolders =
      this.#game.folders?.filter((f) => f.folder?.id === folderId && f.type === 'JournalEntry') ??
      [];
    for (const subfolder of subfolders) {
      pages.push(...this._collectPages(subfolder.id));
    }

    return pages;
  }

  private _formatPagesForContext(
    pages: Array<{ journalName: string; pageName: string; content: string }>,
  ): string {
    return pages.map((p) => `## ${p.journalName} — ${p.pageName}\n${p.content}`).join('\n\n');
  }

  private async _generateIndex(contentToIndex: string): Promise<string> {
    const systemPrompt = `You are a lore index builder for a tabletop RPG campaign.
You will receive raw adventure journal content and produce a hierarchical, structured index.

The index should be organized as:
- Adventure parts (e.g., "## Part 1: The Arrival")
  - Scene summaries under each part (e.g., "### Scene 1: The Road to Millhaven")
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
Keep descriptions concise (1 line per entry in lists).`;

    const userPrompt = `Build a hierarchical lore index from this adventure content:

${contentToIndex}

Produce the index as markdown. Start directly with ## Part 1 or ## World if there are no explicit parts.`;

    try {
      const { content: index } = await this.#aiService.call(systemPrompt, userPrompt, {
        max_tokens: 32768,
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
