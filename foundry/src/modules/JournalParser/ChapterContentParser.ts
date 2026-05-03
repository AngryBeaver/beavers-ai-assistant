import { ChapterCandidate } from './ChapterDetector.js';
import { GameData } from '../ContextBuilder.js';
import { stripHtml, cleanFoundryMarkup } from '../loreIndexUtils.js';
import type { HeadingCandidate, SceneRole } from '../../apps/LoreIndexWizard.types.js';

const INTRO_KEYWORDS =
  /intro|introduction|preface|background|foreword|credits|appendix|prologue|about|overview|welcome|how to use|read first|getting started/i;

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

  /**
   * Extract only the top-level (`#`) headings from the parsed chapter markdown.
   * These are the only candidates for scenes — sub-headings are content within a scene.
   *
   * Hierarchy reminder:
   *   folder  → # = journal name, ## = page name, deeper = content
   *   journal → # = page name, ## = content h1, deeper = content
   *   page    → # = content h1, deeper = content
   */
  extractHeadings(chapter: ChapterCandidate): HeadingCandidate[] {
    const raw = this.parse(chapter);
    const results: HeadingCandidate[] = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^(#)\s+(.+)$/);
      if (!m) continue;
      const text = m[2].trim();
      const role: SceneRole = INTRO_KEYWORDS.test(text) ? 'overview' : 'include';
      results.push({ text, level: 1, role });
    }
    return results;
  }

  /**
   * Extract only the sections whose top-level heading matches one of the given
   * heading texts. Returns the full parse when headings is empty.
   */
  parseScene(chapter: ChapterCandidate, headings: string[]): string {
    const fullMd = this.parse(chapter);
    if (!headings.length) return fullMd;
    const lines = fullMd.split('\n');
    const included: string[] = [];
    let inSection = false;
    let sectionLevel = 0;
    for (const line of lines) {
      const hm = line.match(/^(#{1,6})\s+(.+)$/);
      if (hm) {
        const lvl = hm[1].length;
        const txt = hm[2].trim();
        if (headings.some((h) => h === txt)) {
          inSection = true;
          sectionLevel = lvl;
          included.push(line);
        } else if (inSection && lvl <= sectionLevel) {
          inSection = false;
        } else if (inSection) {
          included.push(line);
        }
      } else if (inSection) {
        included.push(line);
      }
    }
    return included.join('\n').trim();
  }

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
        const mark = this.getMark(p);
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

  private getMark(p: any) {
    return (
      (game.system.id === 'dnd5e' && p.system.code?.trim()) ||
      (p.sceneNote?.text as string | undefined)?.trim()
    );
  }
}
