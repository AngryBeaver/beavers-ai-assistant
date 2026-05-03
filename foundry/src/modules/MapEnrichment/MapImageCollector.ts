import type { ChapterCandidate } from '../JournalParser/index.js';
import { stripHtml } from '../loreIndexUtils.js';
import type { NamedImage } from './EnrichmentPassRunner.js';

/**
 * Collects candidate map images from a chapter's Foundry source content.
 *
 * Image names are derived in priority order:
 *   alt attribute → <figcaption> immediately after → nearest preceding heading → page/journal name.
 */
export class MapImageCollector {
  readonly #game: any;

  constructor(game: any) {
    this.#game = game;
  }

  /**
   * Return all unique images found in the source journals/folder for a chapter.
   * Results are deduplicated by URL, preserving first occurrence.
   */
  collectForChapter(chapter: ChapterCandidate): NamedImage[] {
    const journals: any[] = [];

    if (chapter.sourceType === 'folder') {
      this._collectJournalsInFolder(chapter.id, journals);
    } else if (chapter.sourceType === 'journal') {
      const j = this.#game.journal?.find((j: any) => j.id === chapter.id);
      if (j) journals.push(j);
    } else if (chapter.sourceType === 'page') {
      const journalId = chapter.id.split('::page::')[0];
      const j = this.#game.journal?.find((j: any) => j.id === journalId);
      if (j) journals.push(j);
    }

    const images: NamedImage[] = [];
    for (const journal of journals) {
      for (const page of journal.pages.contents as any[]) {
        if (page.type === 'image' && page.src) {
          images.push({ url: page.src as string, name: (page.name as string) || journal.name });
        }
        const html: string = page.text?.content ?? '';
        images.push(...this._extractImagesWithNames(html, (page.name as string) || journal.name));
      }
    }

    const seen = new Set<string>();
    return images.filter((img) => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });
  }

  collectJournalsInFolder(folderId: string, out: any[]): void {
    this._collectJournalsInFolder(folderId, out);
  }

  /**
   * Scan HTML for <img> tags and derive a name for each.
   * Walks headings, img tags, and figcaptions in document order.
   */
  private _extractImagesWithNames(html: string, fallback: string): NamedImage[] {
    const results: NamedImage[] = [];
    let lastHeading = fallback;
    let lastImgIdx = -1;

    const tokenRe =
      /<(h[1-6])[^>]*>[\s\S]*?<\/\1>|<img\s[^>]*\/?>|<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi;

    for (const match of html.matchAll(tokenRe)) {
      const tag = match[0];
      if (/^<h[1-6]/i.test(tag)) {
        lastHeading = stripHtml(tag).trim() || lastHeading;
        lastImgIdx = -1;
      } else if (/^<img/i.test(tag)) {
        const srcMatch = tag.match(/src=["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const url = srcMatch[1];
        const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
        const alt = altMatch?.[1]?.trim() ?? '';
        results.push({ url, name: alt || lastHeading });
        lastImgIdx = results.length - 1;
      } else if (/^<figcaption/i.test(tag) && lastImgIdx >= 0) {
        const caption = stripHtml(tag).trim();
        if (caption && results[lastImgIdx].name === lastHeading) {
          results[lastImgIdx] = { ...results[lastImgIdx], name: caption };
        }
        lastImgIdx = -1;
      }
    }

    return results;
  }

  private _collectJournalsInFolder(folderId: string, out: any[]): void {
    const journals = this.#game.journal?.filter((j: any) => j.folder?.id === folderId) ?? [];
    out.push(...journals);
    const subfolders =
      this.#game.folders?.filter(
        (f: any) => f.folder?.id === folderId && f.type === 'JournalEntry',
      ) ?? [];
    for (const sf of subfolders) {
      this._collectJournalsInFolder(sf.id, out);
    }
  }
}
