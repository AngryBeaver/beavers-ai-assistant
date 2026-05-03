/**
 * API type contracts for the Foundry module socket API.
 *
 * These interfaces mirror client/src/types.ts — keep them in sync when the
 * API changes.
 */

export interface JournalPageData {
  /** Page name — matched to update an existing page; required when creating. */
  name: string;
  /** Text content. Markdown unless format is 'html'. */
  text: string;
  /** Content format. Defaults to 'markdown'. */
  format?: 'markdown' | 'html';
}

export interface JournalData {
  /** Foundry internal document ID (returned by write operations). */
  _id?: string;
  /** Journal entry ID — if provided, the existing entry is updated; otherwise matched by name. */
  id?: string;
  /** Journal entry name. Required when creating a new entry. */
  name?: string;
  /**
   * Folder name or ID. If a name is given, an existing folder with that name is
   * resolved automatically. If no folder with that name exists it is created.
   */
  folder?: string;
  /** Pages to create atomically with the journal entry. Only used on creation. */
  pages?: JournalPageData[];
  /** Per-user ownership levels, e.g. `{ default: 0 }`. */
  ownership?: Record<string, number>;
  /** Arbitrary flags for module or system data. */
  flags?: Record<string, unknown>;
}
