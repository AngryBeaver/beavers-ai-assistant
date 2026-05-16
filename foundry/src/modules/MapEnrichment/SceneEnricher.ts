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

    onProgress(`  → Observing map openings…`);
    const mapObservations = await this._observeMapOpenings(imageUrl, callOptions);

    onProgress(`  → Synthesising enriched description…`);
    const enriched = await this._synthesiseLocationText(locationText, mapObservations, callOptions);

    onProgress(`  → Writing location scene…`);

    await JournalApi.writeJournalPage(sceneJournalId, {
      name: `LocationScene: ${sceneName}`,
      text: enriched.trim(),
    });

    onProgress(`  ✓ Location scene written.`);
  }

  private async _observeMapOpenings(
    imageUrl: string,
    callOptions: CallOptions,
  ): Promise<string> {
    const systemPrompt = `You are a cartographic observer analysing a top-down tabletop RPG map image.

**Step 1 — Read the legend**
If the image contains a legend, key, or symbol reference, list every symbol it defines and what it means before doing anything else. If there is no legend, state that and fall back to standard dungeon cartography conventions (filled rectangle across a gap = door, double lines = double door, dotted line = secret door, open gap in wall = passage, etc.).

**Step 2 — Locate and describe every area**
List every labeled and unlabeled area visible on the map. For each report a single line:
"<Area label or description> | <shape: rectangle/L-shape/irregular/corridor/etc.> | <approximate size or grid dimensions> | <notable physical features visible on the map: pillars, raised platform, water, rubble, etc.>"

Include unlabeled spaces (corridors, alcoves, antechambers) if they are distinct enclosed areas.

**Step 3 — Enumerate every opening**
Using the areas identified in Step 2 and the legend from Step 1, list every visible opening, gap, door symbol, archway, or passage in the map. For each opening report a single line:
"<Area label> | <side: north/south/east/west/floor/ceiling> | <type> | connects to: <target area label or description>"

Rules for Step 3:
- Report ONLY what you can directly see as a physical opening or a cartographic symbol for one.
- Do NOT infer connections from shared walls, proximity, or visual grouping — a connection only exists where there is an actual gap or symbol.
- Be exhaustive — list every opening, even small or partial ones.`;

    const userPrompt = `Step 1: identify the legend. Step 2: locate and describe every area. Step 3: list every visible opening.`;
    return this.#aiService.callWithImage!(systemPrompt, userPrompt, imageUrl, {
      ...callOptions,
      max_tokens: 2048,
    });
  }

  private async _synthesiseLocationText(
    locationText: string,
    mapObservations: string,
    callOptions: CallOptions,
  ): Promise<string> {
    const systemPrompt = `You are extending a text-based location description for a tabletop RPG scene using observed map data.

Source A is the location description extracted from the adventure text. It is the base — preserve all of its content. Do not remove, replace, or contradict anything in Source A.
Source B is a list of openings observed directly from the map image.

**What to do with Source B:**
- If Source B lists an opening that is not mentioned in Source A at all, add it to the relevant area's Connections section.
- If Source A mentions a connection but lacks a cardinal direction, and Source B provides one, add the direction.
- If Source B identifies an unlabeled intermediate space (corridor, alcove) not in Source A, add it as its own section with what it connects to.
- If Source B confirms or clarifies the shape or size of an area that Source A describes vaguely, extend the layout paragraph.

**What not to do:**
- Do not remove any connections or content already in Source A.
- Do not add game mechanics, DC values, lock/trap status, or encounter details — those belong to Source A only.
- Do not add connections from Source B that duplicate ones already in Source A.

Output the COMPLETE enriched location description preserving the EXACT markdown structure of Source A — ## headings for areas, #### subheadings for description / layout / connections, bullet points for connections. Do not change, flatten, or remove any heading markers. Output only the enriched description, nothing else.`;

    const userPrompt = `## Source A — Text location description\n\n${locationText}\n\n---\n\n## Source B — Map openings observed\n\n${mapObservations}`;
    const response = await this.#aiService.call(systemPrompt, userPrompt, {
      ...callOptions,
      max_tokens: 8192,
    });
    return response.content || response.reasoning || locationText;
  }

  private async _stripToLocationText(
    sourceText: string,
    callOptions: CallOptions,
  ): Promise<string> {
    const systemPrompt = `You extract physical location and spatial connection information from tabletop RPG scene text.

Output ONLY a markdown document using EXACTLY this structure for every area — no other format is acceptable:

## <area code> <area name>
#### description
<a few sentences: what this area is and what it contains>
#### layout
<prose: size, shape, elevation changes, features a player would navigate around>
#### connections
- <target area code> <connection type>: <direction if known>. <properties: locked / secret / one-way / requires key / sloped / must be climbed if applicable>

Rules:
- Every area gets its own ## section. Use the exact area code and name as written in the source (e.g. G1 Cave Mouth, Area 3 Throne Room).
- Every connection gets its own bullet under ### connections.
- Exclude entirely: enemies, NPCs, loot, treasure, story context, dialogue, traps that do not block movement, game mechanics.
- Output nothing outside the markdown document — no introduction, no summary.`;

    const userPrompt = `Extract layout, location and connection information from this scene:\n\n${sourceText}`;
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
