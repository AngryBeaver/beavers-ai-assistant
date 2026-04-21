import { ChapterCandidate } from './ChapterDetector.js';
import { GameData } from '../ContextBuilder.js';
import { stripHtml, cleanFoundryMarkup } from '../loreIndexUtils.js';

/** True when the name already starts with an area code like "H1", "A2", "1.", "3b". */
function _hasAreaCode(name: string): boolean {
  return /^[A-Za-z]{0,3}\d/.test(name);
}

/**
 * Converts a ChapterCandidate into formatted markdown for the AI indexer.
 *
 * Hierarchy rules:
 *   folder  chapter → journal = #, page = ##, <h1> = ###, <h2> = ####, …
 *   journal chapter → page = #, <h1> = ##, <h2> = ###, …
 *   page    chapter → content headings as-is (h1=#, h2=##, …), no heading added
 */
export class ChapterContentParser {
  constructor(private readonly game: GameData) {}

  parse(chapter: ChapterCandidate): string {
    switch (chapter.sourceType) {
      case 'folder':
        return this._parseFolder(chapter.id);
      case 'journal':
        return this._parseJournal(chapter.id);
      case 'page': {
        const parts = chapter.id.split('::page::');
        if (parts.length !== 2) return '';
        return this._parsePage(parts[0], parseInt(parts[1], 10));
      }
      case 'header': {
        const parts = chapter.id.split('::h::');
        if (parts.length !== 2) return '';
        return this._parseHeaderSection(parts[0], parseInt(parts[1], 10));
      }
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Source-type parsers
  // ---------------------------------------------------------------------------

  private _parseJournal(journalId: string): string {
    const journal = (this.game as any).journal?.find((j: any) => j.id === journalId);
    if (!journal) return '';
    return this._journalToMarkdown(journal, 1);
  }

  private _parseHeaderSection(journalId: string, sectionIndex: number): string {
    const journal = (this.game as any).journal?.find((j: any) => j.id === journalId);
    if (!journal) return '';
    const fullHtml = (journal.pages.contents as any[])
      .map((p: any) => p.text?.content ?? '')
      .join('');
    const sections = fullHtml.split(/(?=<h[12][^>]*>)/i).filter((s: string) => /^<h[12]/i.test(s));
    const section = sections[sectionIndex];
    if (!section) return '';
    return cleanFoundryMarkup(stripHtml(section, 1)).trim();
  }

  private _parsePage(journalId: string, pageIndex: number): string {
    const journal = (this.game as any).journal?.find((j: any) => j.id === journalId);
    if (!journal) return '';
    const page = (journal.pages.contents as any[])[pageIndex];
    if (!page) return '';
    // Chapter is a single page — output content headings as-is (h1=#, h2=##, …).
    return cleanFoundryMarkup(stripHtml(page.text?.content ?? '', 1)).trim();
  }

  private _parseFolder(folderId: string): string {
    return this._collectJournals(folderId)
      .map((j: any) => this._journalToMarkdown(j, 2, 1))
      .filter(Boolean)
      .join('\n\n');
  }

  private _collectJournals(folderId: string): any[] {
    const direct: any[] =
      (this.game as any).journal?.filter((j: any) => j.folder?.id === folderId) ?? [];
    const subfolders: any[] =
      (this.game as any).folders?.filter(
        (f: any) => f.folder?.id === folderId && f.type === 'JournalEntry',
      ) ?? [];
    return [...direct, ...subfolders.flatMap((sf: any) => this._collectJournals(sf.id as string))];
  }

  // ---------------------------------------------------------------------------
  // Shared journal formatter
  // ---------------------------------------------------------------------------

  /**
   * Render one journal as markdown.
   *
   * @param journal      Foundry JournalEntry document.
   * @param pageLevel    Hash depth for page headings (1 = #, 2 = ##).
   * @param journalLevel When set, prepend a heading for the journal itself at
   *                     this depth before the pages (used in folder chapters).
   */
  private _journalToMarkdown(journal: any, pageLevel: number, journalLevel?: number): string {
    // h1 in page content sits one level below the page heading
    const h1Level = pageLevel + 1;
    const pageHash = '#'.repeat(pageLevel);

    const pages = (journal.pages.contents as any[])
      .map((p: any) => {
        const rawName = p.name as string;
        // Use the scene-note text label (e.g. "H1", "A2") as an area prefix
        // when the page name doesn't already carry an area code.
        const mark = (p.sceneNote?.text as string | undefined)?.trim() || p.system.code?.trim(); //dnd5e
        const pageName = mark && !_hasAreaCode(rawName) ? `${mark}: ${rawName}` : rawName;
        const content = cleanFoundryMarkup(stripHtml(p.text?.content ?? '', h1Level)).trim();
        return content ? `${pageHash} ${pageName}\n${content}` : null;
      })
      .filter(Boolean) as string[];

    if (!pages.length) return '';

    if (journalLevel !== undefined) {
      const jHash = '#'.repeat(journalLevel);
      return `${jHash} ${journal.name as string}\n\n${pages.join('\n\n')}`;
    }
    return pages.join('\n\n');
  }
}
