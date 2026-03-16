/**
 * API type contracts for the beavers-voice-transcript client.
 *
 * These interfaces mirror foundry/src/types.ts — keep them in sync when the
 * Foundry module API changes.
 */

export interface JournalPageData {
  /** Page ID — if provided, the existing page is updated; otherwise matched by name. */
  id?: string;
  /** Page name/title. Required when creating a new page. */
  name?: string;
  /** Page type. Defaults to "text". */
  type?: 'text' | 'image' | 'pdf' | 'video';
  /** Text page content. Only relevant when type is "text". */
  text?: {
    /** Raw HTML content. */
    content?: string;
    /** Original markdown source (only when format is MARKDOWN). */
    markdown?: string;
    /** Content format: 1 = HTML (default), 2 = Markdown. */
    format?: 1 | 2;
  };
  /** URI of the media source. Used for image, pdf and video pages. */
  src?: string;
  /** Controls page title rendering. */
  title?: {
    /** Whether to show the page title. Defaults to true. */
    show?: boolean;
    /** Heading level 1–6 for the title. Defaults to 1. */
    level?: 1 | 2 | 3 | 4 | 5 | 6;
  };
  /** Arbitrary flags for module or system data. */
  flags?: Record<string, unknown>;
}

export interface JournalData {
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