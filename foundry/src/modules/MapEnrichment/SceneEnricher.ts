import { MODULE_FOLDER_NAME, LORE_INDEX_JOURNAL_NAME } from '../../definitions.js';
import type { AiService, CallOptions } from '../../services/AiService.js';
import { JournalApi } from '../../api/JournalApi.js';
import { pageText } from '../loreIndexUtils.js';

/**
 * Runs the vision AI call for a single scene and writes the resulting
 * `#### Connections` section back to the scene's lore-index journal page.
 */
export class SceneEnricher {
  readonly #game: any;
  readonly #aiService: AiService;

  constructor(game: any, aiService: AiService) {
    this.#game = game;
    this.#aiService = aiService;
  }

  /**
   * Analyse a map image for the given scene and write (or replace) the
   * `#### Connections` block in the `Scene: <sceneName>` journal page.
   *
   * @param sourceText  Raw source text from the original adventure journal.
   * @param mode        'replace' removes any existing Connections block first;
   *                    'add' appends after any existing block.
   */
  async enrichSceneWithMap(
    sceneName: string,
    sourceText: string,
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

    const existingLocationText = this._readScenePageText(
      sceneJournalId,
      `LocationScene: ${sceneName}`,
    );
    let locationText: string;
    if (existingLocationText) {
      locationText = existingLocationText;
      onProgress(`  → Reusing existing location description.`);
    } else {
      onProgress(`  → Extracting location description…`);
      locationText = await this._stripToLocationText(sourceText, callOptions);
      await JournalApi.writeJournalPage(sceneJournalId, {
        name: `LocationScene: ${sceneName}`,
        text: locationText,
      });
    }

    const systemPrompt = `You are analysing a top-down tabletop RPG map image to extract how areas connect to each other.

The image shows a map with distinct areas — rooms, outdoor sections, caverns, or similar — each with a visible boundary. Most areas carry a label (a number, letter, or short code). Every labeled area on the map MUST appear in at least one connection entry — do not omit any.

**Step 1 — read the legend.**
If the map has a legend or key section, read it first. It defines what symbols mean: secret doors, trapped floors, one-way passages, etc. Apply those definitions throughout.

**Step 2 — for each labeled area, look at its boundary.**
Examine every wall, edge, and border of the area. Identify what is directly adjacent — another labeled area, an unlabeled space (hallway, corridor, antechamber), or a physical feature (door, bridge, stream, shaft). Only write a connection if the two nodes share a direct physical boundary or feature. Do not skip intermediate spaces.

**Step 3 — name unnamed intermediate spaces.**
If a hallway, corridor, passage, antechamber, cave entrance, or similar unlabeled space exists on the map, it is its own node with a bracketed slug describing what it physically is: \`[cave-entrance]\`, \`[antechamber]\`, \`[bridge]\`, \`[main-corridor]\`. Name it by what it is — NOT by which two areas it connects. Do NOT use pairwise names like \`[corridor-H1H2]\`.
A single unnamed space can connect to many labeled areas. Write one entry per connection it has — e.g. a cave entrance that opens to H3, H4, H5 and H7 gets four entries. Do not split it into separate nodes just because it touches multiple areas.

**Step 4 — cross-reference each connection with the area description.**
For every connection you identified visually, read the description of both areas it connects. The description often names what connects them: a secret door, a trapdoor, a specific gate, a stream ford. If the description mentions something that matches the visual, use that as the connection type and add the descriptive detail as a note. If the description does not mention a secret door but the map shows one, treat it as a regular door — descriptions are the authoritative source for special connection types.

**Step 5 — identify the connection type precisely.**
Look at what sits on the boundary: a door symbol, a double door, a secret door marking (from the legend), a gap in the wall, a stream or water feature, a bridge, a ladder, a chimney or shaft, a hole. Use that as the connection type. Never default to "passage" when a more specific type is visible. Invent a descriptive type if none of the standard ones fit.

Standard types (use or extend): open, door, double-door, hidden-door, secret-door, ford, stream-crossing, rope-bridge, ladder, stairs, climb, tunnel, chimney, hole, archway.

Output ONLY a markdown Connections block in this exact format:

#### Connections

- \`A -> [cave-entrance]\` : open  *(east, stream alongside)*
- \`[cave-entrance] -> B\` : open  *(north)*
- \`[cave-entrance] -> C\` : open  *(east)*
- \`[cave-entrance] -> D\` : stairs  *(up)*
- \`B -> E\` : door  *(west)*
- \`C -> [bridge]\` : rope-bridge  *(north, requires climb to reach bridge level)*
- \`[bridge] -> F\` : open  *(east)*
- \`[bridge] -> G\` : open  *(west)*
- \`F -> [exit: underdark]\` : hidden-door  *(south)*
- \`C -> H\` : chimney  *(one-way up)*

Additional rules:
- Off-map exits use \`[exit: destination]\` — e.g. \`[exit: underdark]\`, \`[exit: surface]\`.
- Add a cardinal direction hint *(north)*, *(east)*, etc. whenever determinable.
- When multiple connections leave the same node in the same direction, add an ordinal qualifier: *(east, 1st from north)*, *(east, 2nd from north)*.
- Add italics notes when meaningful: *(one-way down)*, *(locked)*, *(key in area 4)*, *(shallow stream)*, *(requires light source)*.
- Symmetric (two-way) connections are written once. Mark one-way connections explicitly with *(one-way)* or *(one-way up/down)*.
- Write nothing else — no prose, no headings other than #### Connections.`;

    const userPrompt = `Here is the location description — use it to confirm and enrich the connections you identify from the map image above.\n\nLocation description:\n\n${locationText}`;

    onProgress(`  → Calling vision AI…`);

    const result = await this.#aiService.callWithImage(systemPrompt, userPrompt, imageUrl, {
      ...callOptions,
      max_tokens: 8192,
    });

    onProgress(`  → Writing connections…`);

    const existingText = this._readScenePageText(sceneJournalId, sceneName);
    let updatedText = existingText ?? '';
    if (mode === 'replace') {
      updatedText = updatedText.replace(
        /\n?#### Connections\n[\s\S]*?(?=\n#### |\n---|\n##|$)/,
        '',
      );
    }

    const connections = result.trim().startsWith('#### Connections')
      ? result.trim()
      : `#### Connections\n\n${result.trim()}`;
    updatedText = updatedText.trimEnd() + '\n\n' + connections;

    await JournalApi.writeJournalPage(sceneJournalId, {
      name: `Scene: ${sceneName}`,
      text: updatedText,
    });

    onProgress(`  ✓ Connections written.`);
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
