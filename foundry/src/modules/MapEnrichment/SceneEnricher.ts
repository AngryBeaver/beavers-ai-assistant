import { MODULE_FOLDER_NAME, LORE_INDEX_JOURNAL_NAME } from '../../definitions.js';
import type { AiService, CallOptions } from '../../services/AiService.js';
import { JournalApi } from '../../api/JournalApi.js';
import { pageText } from '../loreIndexUtils.js';
import { ChapterContentParser } from '../JournalParser/ChapterContentParser.js';
import type { ChapterCandidate } from '../JournalParser/ChapterDetector.js';

export class SceneEnricher {
  readonly #game: any;
  readonly #aiService: AiService;

  constructor(game: any, aiService: AiService) {
    this.#game = game;
    this.#aiService = aiService;
  }

  /**
   * Enrich a scene's LocationScene page using a map image.
   *
   * Calls `_stripToLocationText` to build a text-only location base, then
   * passes it to the vision AI to extend with visual details from the map.
   * Result is written to the `LocationScene: <sceneName>` journal page.
   *
   * @param mode  'replace' always regenerates even if a LocationScene exists;
   *              'add' skips scenes that already have a LocationScene page.
   */
  async enrichSceneWithMap(
    sceneName: string,
    chapterCandidate: ChapterCandidate,
    imageUrl: string,
    mode: 'replace' | 'add',
    callOptions: CallOptions,
    onProgress: (line: string) => void,
  ): Promise<void> {
    if (!this.#aiService.callWithImage) {
      throw new Error('The selected AI provider does not support vision calls.');
    }

    const sceneJournalId = this._findJournalForScene(sceneName);
    if (!sceneJournalId) throw new Error(`Scene journal not found for: "Scene: ${sceneName}"`);

    const existingLocationText = this._readLocationPageText(sceneJournalId, sceneName);
    if (existingLocationText && mode === 'add') {
      onProgress(`  → Location scene already exists, skipping.`);
      return;
    }

    onProgress(`  → Extracting location description…`);
    const sourceText = new ChapterContentParser(this.#game).parseScene(chapterCandidate, [sceneName]);
    const locationText = await this._stripToLocationText(sourceText, callOptions);

    const systemPrompt = `You are enriching a text-based location description for a tabletop RPG scene using a top-down map image.

The text was extracted from the adventure source. The map is a visual source. Together they produce the enriched description — the text provides understanding and game properties, the map provides visual facts.

**What the map can contribute:**
- Area shapes, approximate sizes, and relative positions
- Connection types visible as actual openings or symbols: door, double door, secret door, open gap, archway, stairs, ladder, chimney, bridge, stream, ford
- Cardinal directions of connections
- Unlabeled intermediate spaces physically present on the map (corridors, antechambers, cave entrances) — name them by what they are

**Adjacency rule — read connections strictly from openings, never from proximity:**
Two areas are connected ONLY if there is a visible opening or symbol between them (a door icon, an open gap in a wall, an archway, a passage). Shared walls, closeness, or visual grouping do NOT create a connection. If no opening exists between two areas, they are NOT connected — do not add one.

**What only the text can contribute — never invent these from the image:**
- Skill checks or DC values of any kind
- Whether something is locked, trapped, or requires a key
- One-way restrictions or movement rules
- Any game mechanic or encounter detail

**How to write the output:**
Use both the text and the map together. You may rephrase or restructure entries to integrate visual and textual information naturally — the goal is a clear, unified description, not a verbatim copy with additions bolted on. Do not contradict the text. Do not omit connections or areas present in either source.

Output the COMPLETE enriched location description in the EXACT same format as the input — one section per labeled area with a "Physical layout:" paragraph and a "Connections:" section of prose entries. Do not add markdown headings like #### or ---. Output only the enriched description, nothing else.`;

    const userPrompt = `Here is the current location description. Enrich it using the map image.\n\n${locationText}`;

    onProgress(`  → Calling vision AI…`);

    const enriched = await this.#aiService.callWithImage(systemPrompt, userPrompt, imageUrl, {
      ...callOptions,
      max_tokens: 8192,
    });

    onProgress(`  → Writing location scene…`);

    await JournalApi.writeJournalPage(sceneJournalId, {
      name: `LocationScene: ${sceneName}`,
      text: enriched.trim(),
    });

    onProgress(`  ✓ Location scene written.`);
  }

  private async _stripToLocationText(
    sourceText: string,
    callOptions: CallOptions,
  ): Promise<string> {
    const systemPrompt = `You extract physical location and spatial connection information from tabletop RPG scene text.

Output a clean markdown document with one section per labeled area (use its exact label as the heading). For each area include only:
- Physical layout relevant to movement (size, shape, notable features a player would navigate around)
- Every connection to other areas: doors, passages, openings, bridges, streams, ladders, stairs, chimneys, holes — include what type and what it leads to
- Special connection properties: locked, secret, one-way, requires a key

Exclude entirely: enemies, NPCs, loot, treasure, story context, dialogue, traps that do not block movement, read-aloud text, game mechanics.

Preserve all area labels exactly as written (e.g. H1, H2, Area 3, Room 4).`;

    const userPrompt = `Extract location and connection information from this scene:\n\n${sourceText}`;
    const response = await this.#aiService.call(systemPrompt, userPrompt, callOptions);
    return response.content || response.reasoning || sourceText;
  }

  private _findJournalForScene(sceneName: string): string | null {
    const loreFolder = this._getLoreIndexFolder();
    if (!loreFolder) return null;
    const journals: any[] =
      this.#game.journal?.filter((j: any) => j.folder?.id === loreFolder.id) ?? [];
    for (const journal of journals) {
      const page = (journal.pages.contents as any[]).find(
        (p: any) => p.name === `Scene: ${sceneName}`,
      );
      if (page) return journal.id as string;
    }
    return null;
  }

  private _readScenePageText(journalId: string, sceneName: string): string | null {
    const journal = this.#game.journal?.get(journalId);
    if (!journal) return null;
    const page = (journal.pages.contents as any[]).find(
      (p: any) => p.name === `Scene: ${sceneName}`,
    );
    return page ? pageText(page) : null;
  }

  private _readLocationPageText(journalId: string, sceneName: string): string | null {
    const journal = this.#game.journal?.get(journalId);
    if (!journal) return null;
    const page = (journal.pages.contents as any[]).find(
      (p: any) => p.name === `LocationScene: ${sceneName}`,
    );
    return page ? pageText(page) : null;
  }

  private _getLoreIndexFolder(): any | null {
    const modFolder = this.#game.folders?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry' && !f.folder,
    );
    if (!modFolder) return null;
    return (
      this.#game.folders?.find(
        (f: any) =>
          f.name === LORE_INDEX_JOURNAL_NAME &&
          f.type === 'JournalEntry' &&
          f.folder?.id === modFolder.id,
      ) ?? null
    );
  }
}
