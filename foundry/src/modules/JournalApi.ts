import { NAMESPACE } from "../definitions.js";

export class JournalApi {
  /**
   * List journals in a folder (by folder id or name). Defaults to root (no folder).
   */
  static async listJournals(folderIdentifier?: string) {
    let folderId: string | null = null;
    if (folderIdentifier) {
      const folder =
        game.folders.get(folderIdentifier) ||
        game.folders.find((f: any) => f.name === folderIdentifier && f.type === "JournalEntry");
      if (!folder) throw new Error(`Folder not found: ${folderIdentifier}`);
      folderId = folder.id;
    }
    const folders = game.folders
      .filter((f: any) => f.type === "JournalEntry" && (folderId ? f.folder?.id === folderId : f.folder == null))
      .map((f: any) => ({ id: f.id, name: f.name, type: "folder" }));
    const journals = game.journal
      .filter((j: any) => (folderId ? j.folder?.id === folderId : j.folder == null))
      .map((j: any) => ({ id: j.id, name: j.name, type: "journal" }));
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
  static async writeJournal(data: any) {
    let journal = data.id ? game.journal.get(data.id) : data.name ? game.journal.getName(data.name) : null;

    if (journal) {
      return journal.update(data);
    } else {
      // @ts-ignore
      return JournalEntry.create(data);
    }
  }

  /**
   * Add or update a page in a journal entry.
   */
  static async writeJournalPage(journalIdentifier: string, pageData: any) {
    const journal = game.journal.get(journalIdentifier) || game.journal.getName(journalIdentifier);
    if (!journal) {
      throw new Error(`Journal entry not found: ${journalIdentifier}`);
    }

    // @ts-ignore
    let page = pageData.id
      ? journal.pages.get(pageData.id)
      : pageData.name
        ? journal.pages.getName(pageData.name)
        : null;

    if (page) {
      return page.update(pageData);
    } else {
      // @ts-ignore
      return journal.createEmbeddedDocuments("JournalEntryPage", [pageData]);
    }
  }
}
