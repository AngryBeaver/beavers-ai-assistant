import { MODULE_FOLDER_NAME, NAMESPACE, SESSION_FOLDER_NAME } from '../definitions.js';
import { ChatBubbleApi } from './ChatBubbleApi.js';
import { JournalData, JournalPageData } from '../types.js';
import { pageText } from '../modules/loreIndexUtils.js';

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
        text: pageText(p),
        src: p.src,
      })),
    };
  }

  /**
   * Create or update a journal entry.
   */
  static async writeJournal(data: JournalData) {
    const payload: any = {
      ...data,
      pages: data.pages?.map((p) => ({
        name: p.name,
        type: 'text',
        text: { content: p.text, format: p.format === 'html' ? 1 : 2 },
      })),
    };

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

    const format = pageData.format === 'html' ? 1 : 2;
    const textKey = format === 2 ? 'text.markdown' : 'text.content';
    const textObj =
      format === 2 ? { markdown: pageData.text, format } : { content: pageData.text, format };

    // @ts-ignore
    const page = journal.pages.getName(pageData.name);
    if (page) {
      return page.update({ [textKey]: pageData.text, 'text.format': format });
    } else {
      // @ts-ignore
      return journal.createEmbeddedDocuments('JournalEntryPage', [
        { name: pageData.name, type: 'text', text: textObj },
      ]);
    }
  }

  /**
   * Append a transcribed line to today's date-named session journal.
   * Resolves speaker from nameOrId: matched token name > GM > nameOrId.
   * Writes markdown: "**Speaker:** msg"
   */
  static async transcribeJournal(msg: string, nameOrId: string): Promise<void> {
    const speaker = JournalApi.resolveSpeaker(nameOrId);

    const moduleFolder = await JournalApi.ensureFolder(MODULE_FOLDER_NAME, null);
    const sessionFolder = await JournalApi.ensureFolder(SESSION_FOLDER_NAME, moduleFolder.id);

    const journalName = new Date().toISOString().slice(0, 10);
    let journal: any =
      game.journal.find((j: any) => j.folder?.id === sessionFolder.id && j.name === journalName) ??
      null;
    if (!journal) {
      // @ts-ignore
      journal = await JournalEntry.create({ name: journalName, folder: sessionFolder.id });
    }

    const line = `**${speaker}:** ${msg}\n\n`;
    // @ts-ignore
    const page = journal.pages.getName('Transcript');
    if (!page) {
      // @ts-ignore
      await journal.createEmbeddedDocuments('JournalEntryPage', [
        { name: 'Transcript', type: 'text', text: { content: line, format: 2 } },
      ]);
    } else {
      const existing = page.text?.content ?? '';
      await page.update({ 'text.format': 2, 'text.content': existing + line });
    }
  }

  private static resolveSpeaker(nameOrId: string): string {
    const token = ChatBubbleApi.resolveToken(nameOrId);
    if (token) return token.name;

    const user = (game.users as any).find((u: any) => u.name === nameOrId || u.id === nameOrId);
    if (user?.role === CONST.USER_ROLES.GAMEMASTER) return 'GM';

    return nameOrId;
  }

  private static async ensureFolder(name: string, parentId: string | null): Promise<any> {
    const existing = game.folders.find(
      (f: any) =>
        f.type === 'JournalEntry' &&
        f.name === name &&
        (parentId ? f.folder?.id === parentId : f.folder == null),
    );
    if (existing) return existing;
    // @ts-ignore
    return Folder.create({ name, type: 'JournalEntry', folder: parentId });
  }

  /**
   * Append markdown to a transcript page, auto-rotating to a new page when the
   * current one exceeds maxPageBytes (default 50 KB). Pages are named
   * "<pageName>", "<pageName> (2)", "<pageName> (3)", etc.
   * Creates the journal entry's page on first call. Each call appends a newline.
   */
  static async appendJournalPage(
    journalIdentifier: string,
    pageName: string,
    markdown: string,
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

    if (!currentPage || currentSize + new TextEncoder().encode(markdown).length > maxPageBytes) {
      const nextNum = currentPage
        ? parseInt(currentPage.name.match(pattern)?.[1] ?? '1') + 1
        : null;
      const newName = nextNum ? `${pageName} (${nextNum})` : pageName;
      // @ts-ignore
      return journal.createEmbeddedDocuments('JournalEntryPage', [
        { name: newName, type: 'text', text: { content: markdown + '\n', format: 2 } },
      ]);
    }

    const existing = currentPage.text?.content ?? '';
    return currentPage.update({ 'text.content': existing + markdown + '\n' });
  }
}
