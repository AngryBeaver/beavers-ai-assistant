// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChapterRole = 'chapter' | 'overview' | 'skip';

export interface ChapterCandidate {
  id: string;
  name: string;
  /** folder: chapter is a Foundry folder (journals→#, pages→##, h1→###)
   *  journal: chapter is a journal (pages→#, h1→##)
   *  page: chapter is a single journal page (h1→# as-is, no heading added)
   *  header: chapter is a h1/h2 section split from page content */
  sourceType: 'folder' | 'journal' | 'page' | 'header';
  role: ChapterRole;
  tokens: number;
}

export interface DetectionResult {
  isMixed: boolean;
  /** Resolved candidates (populated when isMixed is false). */
  candidates: ChapterCandidate[];
  /** Subfolder candidates (populated when isMixed is true). */
  subfolders: ChapterCandidate[];
  /** Journal candidates (populated when isMixed is true). */
  journals: ChapterCandidate[];
}

// ---------------------------------------------------------------------------
// Game accessor — injected so logic is testable without Foundry globals
// ---------------------------------------------------------------------------

export interface FolderLike {
  id: string;
  name: string;
}

export interface PageLike {
  name?: string;
  text?: { content?: string };
}

export interface JournalLike {
  id: string;
  name: string;
  pages: { contents: PageLike[] };
}

export interface GameAccessor {
  getFolder(id: string): FolderLike | null;
  getSubfolders(parentId: string): FolderLike[];
  getJournal(id: string): JournalLike | null;
  getJournalsInFolder(folderId: string): JournalLike[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INTRO_KEYWORDS: readonly string[] = [
  'intro',
  'introduction',
  'preface',
  'background',
  'foreword',
  'credits',
  'appendix',
  'prologue',
  'about',
  'overview',
  'welcome',
  'how to use',
  'read first',
  'getting started',
];

// ---------------------------------------------------------------------------
// ChapterDetector
// ---------------------------------------------------------------------------

/**
 * Analyses adventure content (folders / journals) and produces chapter
 * candidates for the Lore Index Wizard.
 *
 * Pure logic — all Foundry data access goes through the injected GameAccessor
 * so the class is fully testable without a running Foundry instance.
 */
export class ChapterDetector {
  constructor(private readonly accessor: GameAccessor) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Estimate the total number of AI input tokens for a location.
   * Uses the common `chars / 4` heuristic after stripping HTML tags.
   */
  estimateTokens(locationId: string, locationType: 'folder' | 'journal'): number {
    const chars =
      locationType === 'folder'
        ? this._charsFromFolder(locationId)
        : this._charsFromJournal(locationId);
    return Math.ceil(chars / 4);
  }

  /**
   * Detect chapter candidates for the given location.
   *
   * - Journal: one candidate per page (sourceType 'page').
   * - Folder (subfolders only): one candidate per subfolder (sourceType 'folder').
   * - Folder (journals only): one candidate per journal (sourceType 'journal').
   * - Folder (mixed): returns isMixed=true with separate subfolders/journals lists.
   * - Folder (empty): the entire folder becomes a single candidate (sourceType 'folder').
   *
   * The first candidate is automatically flagged as 'overview' if its name
   * matches an intro keyword (see {@link flagIntroCandidate}).
   */
  detect(locationId: string, locationType: 'folder' | 'journal'): DetectionResult {
    if (locationType === 'journal') {
      const candidates = this._candidatesFromPages(locationId);
      flagIntroCandidate(candidates);
      return { isMixed: false, candidates, subfolders: [], journals: [] };
    }

    const subfolders = this._candidatesFromSubfolders(locationId);
    const journals = this._candidatesFromJournalsInFolder(locationId);

    if (subfolders.length > 0 && journals.length > 0) {
      return { isMixed: true, candidates: [], subfolders, journals };
    }

    let candidates: ChapterCandidate[];
    if (subfolders.length > 0) {
      candidates = subfolders;
    } else if (journals.length > 0) {
      candidates = journals;
    } else {
      const folder = this.accessor.getFolder(locationId);
      candidates = [
        {
          id: locationId,
          name: folder?.name ?? locationId,
          sourceType: 'folder',
          role: 'chapter',
          tokens: Math.ceil(this._charsFromFolder(locationId) / 4),
        },
      ];
    }

    flagIntroCandidate(candidates);
    return { isMixed: false, candidates, subfolders: [], journals: [] };
  }

  // ---------------------------------------------------------------------------
  // Private — candidate builders
  // ---------------------------------------------------------------------------

  private _candidatesFromSubfolders(folderId: string): ChapterCandidate[] {
    return this.accessor.getSubfolders(folderId).map((f) => ({
      id: f.id,
      name: f.name,
      sourceType: 'folder' as const,
      role: 'chapter' as ChapterRole,
      tokens: Math.ceil(this._charsFromFolder(f.id) / 4),
    }));
  }

  private _candidatesFromJournalsInFolder(folderId: string): ChapterCandidate[] {
    return this.accessor.getJournalsInFolder(folderId).map((j) => ({
      id: j.id,
      name: j.name,
      sourceType: 'journal' as const,
      role: 'chapter' as ChapterRole,
      tokens: Math.ceil(this._charsFromJournal(j.id) / 4),
    }));
  }

  /** Split journal pages on h1/h2 headings into header candidates.
   *  Falls back to a single journal-level candidate when no headings exist. */
  private _candidatesFromPages(journalId: string): ChapterCandidate[] {
    const journal = this.accessor.getJournal(journalId);
    if (!journal) return [];

    const fullHtml = journal.pages.contents.map((p) => p.text?.content ?? '').join('');

    // Split at each h1/h2 boundary, discarding preamble before the first heading
    const sections = fullHtml.split(/(?=<h[12][^>]*>)/i).filter((s) => /^<h[12]/i.test(s));

    if (sections.length === 0) {
      return [
        {
          id: journalId,
          name: journal.name,
          sourceType: 'journal',
          role: 'chapter',
          tokens: Math.ceil(fullHtml.replace(/<[^>]*>/g, '').length / 4),
        },
      ];
    }

    return sections.map((section, i) => {
      const headingInner = section.match(/^<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? '';
      const name = headingInner.replace(/<[^>]*>/g, '').trim() || `Section ${i + 1}`;
      return {
        id: `${journalId}::h::${i}`,
        name,
        sourceType: 'header' as const,
        role: 'chapter' as ChapterRole,
        tokens: Math.ceil(section.replace(/<[^>]*>/g, '').length / 4),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private — char counting
  // ---------------------------------------------------------------------------

  private _charsFromFolder(folderId: string): number {
    const journalChars = this.accessor
      .getJournalsInFolder(folderId)
      .reduce((sum, j) => sum + this._charsFromJournal(j.id), 0);

    const subfolderChars = this.accessor
      .getSubfolders(folderId)
      .reduce((sum, sf) => sum + this._charsFromFolder(sf.id), 0);

    return journalChars + subfolderChars;
  }

  private _charsFromJournal(journalId: string): number {
    const journal = this.accessor.getJournal(journalId);
    if (!journal) return 0;
    return journal.pages.contents.reduce(
      (sum, p) => sum + (p.text?.content ?? '').replace(/<[^>]*>/g, '').length,
      0,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan all candidates and pre-flag any whose name contains an intro keyword
 * as 'overview'. Mutates in place. The GM can correct wrong suggestions in
 * the chapters confirmation step.
 */
export function flagIntroCandidate(candidates: ChapterCandidate[]): void {
  for (const candidate of candidates) {
    const lower = candidate.name.toLowerCase();
    if (INTRO_KEYWORDS.some((kw) => lower.includes(kw))) {
      candidate.role = 'overview';
    }
  }
}
