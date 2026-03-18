import { NAMESPACE } from '../definitions.js';
import { JournalData, JournalPageData } from '../types.js';

export class JournalApi {
  /**
   * List journals in a folder (by folder id or name). Defaults to root (no folder).
   */
  static async listJournals(folderIdentifier?: string) {
    let folderId: string | null = null;
    if (folderIdentifier) {
      const folder =
        game.folders.get(folderIdentifier) ||
        game.folders.find((f: any) => f.name === folderIdentifier && f.type === 'JournalEntry');
      if (!folder) throw new Error(`Folder not found: ${folderIdentifier}`);
      folderId = folder.id;
    }
    const folders = game.folders
      .filter(
        (f: any) =>
          f.type === 'JournalEntry' && (folderId ? f.folder?.id === folderId : f.folder == null),
      )
      .map((f: any) => ({ id: f.id, name: f.name, type: 'folder' }));
    const journals = game.journal
      .filter((j: any) => (folderId ? j.folder?.id === folderId : j.folder == null))
      .map((j: any) => ({ id: j.id, name: j.name, type: 'journal' }));
    return [...folders, ...journals];
  }

  /**
   * Read a journal entry by ID or name.
   */
  static async readJournal(identifier: string) {
    const journal = game.journal.get(identifier) || game.journal.getName(identifier);
    if (!journal) {
      throw new Error(`Journal entry not found: ${identifier}`);
    }
    return {
      id: journal.id,
      name: journal.name,
      // @ts-ignore
      pages: journal.pages.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        text: p.text.content,
        src: p.src,
      })),
    };
  }

  /**
   * Create or update a journal entry.
   */
  static async writeJournal(data: JournalData) {
    const payload = { ...data };

    if (payload.folder) {
      const normalised = payload.folder.trim().toLowerCase();
      const existing =
        game.folders.get(payload.folder) ||
        game.folders.find(
          (f: any) => f.name.trim().toLowerCase() === normalised && f.type === 'JournalEntry',
        );
      if (existing) {
        payload.folder = existing.id;
      } else {
        // @ts-ignore
        const created = await Folder.create({ name: payload.folder, type: 'JournalEntry' });
        payload.folder = created.id;
      }
    }

    let journal = payload.id
      ? game.journal.get(payload.id)
      : payload.name
        ? game.journal.getName(payload.name)
        : null;

    if (journal) {
      await journal.update(payload);
      return journal;
    } else {
      // @ts-ignore
      return JournalEntry.create(payload);
    }
  }

  /**
   * Create or replace a page in a journal entry.
   */
  static async writeJournalPage(journalIdentifier: string, pageData: JournalPageData) {
    const journal = game.journal.get(journalIdentifier) || game.journal.getName(journalIdentifier);
    if (!journal) {
      throw new Error(`Journal entry not found: ${journalIdentifier}`);
    }

    // @ts-ignore
    const page = pageData.id
      ? journal.pages.get(pageData.id)
      : pageData.name
        ? journal.pages.getName(pageData.name)
        : null;

    if (page) {
      return page.update(pageData);
    } else {
      // @ts-ignore
      return journal.createEmbeddedDocuments('JournalEntryPage', [pageData]);
    }
  }

  /**
   * Append HTML to a transcript page, auto-rotating to a new page when the
   * current one exceeds maxPageBytes (default 50 KB). Pages are named
   * "<pageName>", "<pageName> (2)", "<pageName> (3)", etc.
   * Creates the journal entry's page on first call.
   */
  static async appendJournalPage(
    journalIdentifier: string,
    pageName: string,
    html: string,
    maxPageBytes = 50_000,
  ) {
    const journal = game.journal.get(journalIdentifier) || game.journal.getName(journalIdentifier);
    if (!journal) {
      throw new Error(`Journal entry not found: ${journalIdentifier}`);
    }

    // Find the highest-numbered existing page for this base name
    // @ts-ignore
    const pages: any[] = journal.pages.contents;
    const pattern = new RegExp(
      `^${pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\((\\d+)\\))?$`,
    );
    const matching = pages
      .filter((p: any) => pattern.test(p.name))
      .sort((a: any, b: any) => {
        const aNum = parseInt(a.name.match(pattern)?.[1] ?? '1');
        const bNum = parseInt(b.name.match(pattern)?.[1] ?? '1');
        return bNum - aNum;
      });

    const currentPage = matching[0] ?? null;
    const currentSize = new TextEncoder().encode(currentPage?.text?.content ?? '').length;

    if (!currentPage || currentSize + new TextEncoder().encode(html).length > maxPageBytes) {
      const nextNum = currentPage
        ? parseInt(currentPage.name.match(pattern)?.[1] ?? '1') + 1
        : null;
      const newName = nextNum ? `${pageName} (${nextNum})` : pageName;
      // @ts-ignore
      return journal.createEmbeddedDocuments('JournalEntryPage', [
        { name: newName, type: 'text', text: { content: html, format: 1 } },
      ]);
    }

    const existing = currentPage.text?.content ?? '';
    return currentPage.update({ 'text.content': existing + html });
  }
}
