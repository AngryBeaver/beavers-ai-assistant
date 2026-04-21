import type { GameData } from '../ContextBuilder.js';
import type {
  AdventureParser,
  ParsedChapter,
  ParserFormField,
  ChapterRole,
} from '../AdventureParser.js';
import {
  ChapterDetector,
  ChapterCandidate,
  flagIntroCandidate,
  type GameAccessor,
} from './ChapterDetector.js';
import { ChapterContentParser } from './ChapterContentParser.js';

/**
 * Parser-specific data carried inside ParsedChapter.
 * Opaque to the wizard — only JournalParser.parseContent reads it.
 */
export type JournalChapterData = ChapterCandidate;

function makeGameAccessor(game: GameData): GameAccessor {
  return {
    getFolder: (id) => (game as any).folders?.get(id) ?? null,
    getSubfolders: (parentId) =>
      (
        ((game as any).folders?.filter(
          (f: any) => f.folder?.id === parentId && f.type === 'JournalEntry',
        ) as any[]) ?? []
      ).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0)),
    getJournal: (id) => (game as any).journal?.get(id) ?? null,
    getJournalsInFolder: (folderId) =>
      (((game as any).journal?.filter((j: any) => j.folder?.id === folderId) as any[]) ?? []).sort(
        (a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0),
      ),
  };
}

/**
 * AdventureParser implementation for Foundry VTT journal entries / folders.
 *
 * Form field: a single "Adventure Source" select listing all top-level
 * JournalEntry folders and unfoldered journal entries.
 *
 * Mixed folders (containing both subfolders and journals) are resolved by
 * merging all candidates — the GM can assign roles manually in the chapters step.
 */
export class JournalParser implements AdventureParser<JournalChapterData> {
  private readonly _detector: ChapterDetector;

  constructor(private readonly game: GameData) {
    this._detector = new ChapterDetector(makeGameAccessor(game));
  }

  // ---------------------------------------------------------------------------
  // AdventureParser implementation
  // ---------------------------------------------------------------------------

  getSettingInformation(): ParserFormField[] {
    const folders: Array<{ value: string; label: string }> = (
      ((this.game as any).folders?.filter(
        (f: any) => f.type === 'JournalEntry' && !f.folder,
      ) as any[]) ?? []
    ).map((f: any) => ({
      value: `${f.id as string}:folder`,
      label: `[Folder] ${f.name as string}`,
    }));

    const journals: Array<{ value: string; label: string }> = (
      ((this.game as any).journal?.filter((j: any) => !j.folder) as any[]) ?? []
    ).map((j: any) => ({
      value: `${j.id as string}:journal`,
      label: `[Journal] ${j.name as string}`,
    }));

    return [
      {
        key: 'location',
        label: 'Adventure Source',
        type: 'select',
        options: [...folders, ...journals],
        required: true,
        placeholder: '(select…)',
      },
    ];
  }

  detectChapters(formData: Record<string, string>): ParsedChapter<JournalChapterData>[] {
    const location = formData['location'] ?? '';
    if (!location) return [];

    const colonIdx = location.lastIndexOf(':');
    if (colonIdx === -1) return [];
    const id = location.slice(0, colonIdx);
    const type = location.slice(colonIdx + 1) as 'folder' | 'journal';

    const result = this._detector.detect(id, type);

    let candidates: ChapterCandidate[];
    if (result.isMixed) {
      // Merge — user assigns chapter/overview/skip roles in the next step.
      candidates = [...result.subfolders, ...result.journals];
      flagIntroCandidate(candidates);
    } else {
      candidates = result.candidates;
    }

    return candidates.map((c) => ({
      id: c.id,
      name: c.name,
      tokens: c.tokens,
      role: c.role as ChapterRole,
      data: c,
    }));
  }

  parseContent(chapter: ParsedChapter<JournalChapterData>): string {
    return new ChapterContentParser(this.game).parse(chapter.data);
  }

  // ---------------------------------------------------------------------------
  // Journal-specific helpers (used by the wizard for enrichment)
  // ---------------------------------------------------------------------------

  /**
   * Decode the parser form "location" value into a Foundry location id + type.
   * Returns null when the form is incomplete.
   */
  static decodeLocation(
    formData: Record<string, string>,
  ): { id: string; type: 'folder' | 'journal' } | null {
    const location = formData['location'] ?? '';
    const colonIdx = location.lastIndexOf(':');
    if (colonIdx === -1) return null;
    return {
      id: location.slice(0, colonIdx),
      type: location.slice(colonIdx + 1) as 'folder' | 'journal',
    };
  }
}
