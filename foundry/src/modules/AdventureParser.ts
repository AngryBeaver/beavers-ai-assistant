/**
 * Pluggable adventure-content parser interface.
 *
 * A parser knows:
 *  1. What configuration it needs from the user (getSettingInformation).
 *  2. How to discover chapters from that configuration (detectChapters).
 *  3. How to turn a chapter into markdown for the AI indexer (parseContent).
 *
 * Example implementations: JournalParser (Foundry journals/folders),
 * future DndBeyondParser (HTTP + bearer token), etc.
 */

// ---------------------------------------------------------------------------
// Form field descriptor
// ---------------------------------------------------------------------------

export interface ParserFormField {
  /** Form key — used as the field name and to read values back. */
  key: string;
  label: string;
  type: 'select' | 'text' | 'password';
  /** Required for type "select". */
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Chapter
// ---------------------------------------------------------------------------

export type ChapterRole = 'chapter' | 'overview' | 'skip';

/**
 * A detected chapter/section of an adventure.
 *
 * @template TData  Parser-specific data needed by parseContent. Opaque to the
 *                  wizard — only the parser that produced the chapter reads it.
 */
export interface ParsedChapter<TData = unknown> {
  /** Stable identifier used for drag-drop and radio-button names in the UI. */
  id: string;
  name: string;
  tokens: number;
  role: ChapterRole;
  data: TData;
}

// ---------------------------------------------------------------------------
// Parser interface
// ---------------------------------------------------------------------------

export interface AdventureParser<TData = unknown> {
  /**
   * Returns the form fields to display in the wizard's source step.
   * Called once when the wizard opens.
   */
  getSettingInformation(): ParserFormField[];

  /**
   * Given the filled-in form values, detects chapters with name / token
   * estimates. Token count is an approximation used for cost display only.
   */
  detectChapters(formData: Record<string, string>): ParsedChapter<TData>[];

  /**
   * Converts a chapter into markdown content ready for the AI indexer.
   * This is the real content — token count from detectChapters was estimated
   * without parsing the full text.
   */
  parseContent(chapter: ParsedChapter<TData>): string;
}
