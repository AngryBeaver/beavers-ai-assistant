import {
  NAMESPACE,
  SETTINGS,
  DEFAULTS,
  MODULE_FOLDER_NAME,
  LORE_INDEX_JOURNAL_NAME,
} from '../definitions.js';
import { AiService, createAiService } from '../services/index.js';
import { GameData, FolderData } from './ContextBuilder.js';
import { JournalApi } from './JournalApi.js';

/**
 * Builds a hierarchical lore index from adventure journal pages.
 * Claude produces a structured index organized by adventure parts → scenes,
 * with a global World section containing all NPCs, locations, and factions.
 */
export class LoreIndexBuilder {
  readonly #game: GameData;
  readonly #aiService: AiService;

  constructor(gameData: GameData) {
    this.#game = gameData;
    this.#aiService = createAiService(gameData);
  }

  /**
   * Build or rebuild the lore index.
   * Reads all pages from adventureJournalFolder, sends to Claude,
   * and writes result as a page in adventureIndexJournalName.
   * @throws Error if adventure folder is not configured, not found, or has no pages
   */
  async build(): Promise<string> {
    const adventureFolder =
      (this.#game.settings.get(NAMESPACE, SETTINGS.ADVENTURE_JOURNAL_FOLDER) as string) || '';

    if (!adventureFolder) {
      throw new Error('Adventure journal folder is not configured in AI Assistant settings.');
    }

    // Find the adventure folder
    const advFolder = this.#game.folders?.find(
      (f) => f.name === adventureFolder && f.type === 'JournalEntry',
    );

    if (!advFolder) {
      throw new Error(`Adventure folder not found: "${adventureFolder}"`);
    }

    // Collect all pages from all journals in the adventure folder
    const pages = this._collectPages(advFolder.id);

    if (!pages.length) {
      throw new Error(`No journal pages found in adventure folder: "${adventureFolder}"`);
    }

    console.log(`[Lore Index] Found ${pages.length} pages. Sending to Claude...`);

    // Build the content to send to Claude
    const contentToIndex = this._formatPagesForClaude(pages);

    // Call Claude to generate the hierarchical index
    const index = await this._generateIndex(contentToIndex);

    // Write the index to a journal page
    await this._writeIndex(index);

    console.log(`[Lore Index] Successfully built and saved index.`);
    return index;
  }

  /**
   * Collect all pages from the adventure folder and its subfolders.
   */
  private _collectPages(
    folderId: string,
  ): Array<{ journalName: string; pageName: string; content: string }> {
    const pages: Array<{ journalName: string; pageName: string; content: string }> = [];

    // Find all journals directly in this folder
    const journals = this.#game.journal?.filter((j) => j.folder?.id === folderId) ?? [];

    for (const journal of journals) {
      for (const page of journal.pages.contents) {
        const content = stripHtml(page.text?.content ?? '').trim();
        if (content) {
          pages.push({
            journalName: journal.name,
            pageName: page.name,
            content,
          });
        }
      }
    }

    return pages;
  }

  /**
   * Format collected pages into a structure Claude can process.
   */
  private _formatPagesForClaude(
    pages: Array<{ journalName: string; pageName: string; content: string }>,
  ): string {
    const lines: string[] = [];

    for (const page of pages) {
      lines.push(`## ${page.journalName} — ${page.pageName}`);
      lines.push(page.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Call Claude to generate a hierarchical lore index.
   */
  private async _generateIndex(contentToIndex: string): Promise<string> {
    const systemPrompt = `You are a lore index builder for a tabletop RPG campaign.
You will receive raw adventure journal content and produce a hierarchical, structured index.

The index should be organized as:
- Adventure parts (e.g., "## Part 1: The Arrival")
  - Scene summaries under each part (e.g., "### Scene 1: The Road to Millhaven")
    - Summary (what happens in this scene)
    - Parts (Some Scenes are big and half multiple parts e.g. sublocations/rooms short summary of each of those if any)
    - NPCs Present (list with brief descriptions)
    - Locations (list with brief descriptions)
    - Factions (list with brief descriptions)
- Global World section (## World (Global Context))
  - All NPCs (consolidated list)
  - All Locations (consolidated list)
  - All Factions (consolidated list)

Structure the index ONLY from the provided content. Do NOT invent new scenes, NPCs, or locations.
If the journals are sparse, the index may be sparse. If they mention scenes, NPCs, locations explicitly, include them.
Keep descriptions concise (1 line per entry in lists).`;

    const userPrompt = `Build a hierarchical lore index from this adventure content:

${contentToIndex}

Produce the index as markdown. Start directly with ## Part 1 or ## World if there are no explicit parts.`;

    try {
      const index = await this.#aiService.call(systemPrompt, userPrompt, {
        max_tokens: 4096,
      });

      return index;
    } catch (err) {
      console.error('AI service error:', err);
      throw new Error(`Failed to generate lore index: ${(err as Error).message}`);
    }
  }

  /**
   * Write the lore index as a page in the lore index journal.
   */
  private async _writeIndex(indexContent: string): Promise<void> {
    try {
      // Ensure the module folder exists
      let modFolder = this.#game.folders?.find(
        (f) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
      );

      if (!modFolder) {
        throw new Error(
          `Module folder "${MODULE_FOLDER_NAME}" not found. It should be created automatically.`,
        );
      }

      // Find or create the lore index journal
      let indexJournal = this.#game.journal?.find(
        (j) => j.folder?.id === modFolder!.id && j.name === LORE_INDEX_JOURNAL_NAME,
      );

      if (!indexJournal) {
        // Create the journal using JournalApi
        await JournalApi.writeJournal({
          name: LORE_INDEX_JOURNAL_NAME,
          folder: MODULE_FOLDER_NAME,
          pages: [
            {
              name: 'Index',
              type: 'text',
              text: {
                content: `<div>${escapeHtml(indexContent)}</div>`,
                format: 1,
              },
            },
          ],
        });
      } else {
        // Update the existing journal's "Index" page
        await JournalApi.writeJournalPage(LORE_INDEX_JOURNAL_NAME, {
          name: 'Index',
          type: 'text',
          text: {
            content: `<div>${escapeHtml(indexContent)}</div>`,
            format: 1,
          },
        });
      }
    } catch (err) {
      console.error('Failed to write lore index journal:', err);
      throw new Error(`Failed to save lore index: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
