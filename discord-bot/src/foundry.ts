import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL ?? 'http://localhost:30000';
const FOUNDRY_USER = process.env.FOUNDRY_USER ?? '';
const FOUNDRY_PASS = process.env.FOUNDRY_PASS ?? '';
const FOLDER_NAME = process.env.FOUNDRY_FOLDER_NAME ?? 'Session Transcripts';

let client: BeaversClient | null = null;
let currentJournalId: string | null = null;
let currentPageName = process.env.FOUNDRY_PAGE_NAME ?? 'Transcript';

export function setPageName(name: string): void {
  currentPageName = name;
}

export async function connect(): Promise<void> {
  client = new BeaversClient({
    url: FOUNDRY_URL,
    userId: FOUNDRY_USER,
    password: FOUNDRY_PASS,
  });
  await client.connect();
  console.log('[Foundry] Connected');
}

function sessionTitle(): string {
  return `${new Date().toISOString().slice(0, 10)} — Discord Session`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function showChatBubble(username: string, text: string): Promise<void> {
  try {
    await client!.chatBubble(username, text);
  } catch (err) {
    console.error(`[Foundry] Failed to show chat bubble: ${(err as Error).message}`);
  }
}

export async function appendTranscript(username: string, text: string): Promise<void> {
  try {
    if (!currentJournalId) {
      const journal = await client!.writeJournal({ name: sessionTitle(), folder: FOLDER_NAME });
      currentJournalId = journal?._id ?? journal?.id ?? null;
      console.log(`[Foundry] Created journal: ${sessionTitle()} (${currentJournalId})`);
    }

    const html = `<p><strong>${escapeHtml(username)}:</strong> ${escapeHtml(text)}</p>`;
    await client!.appendJournalPage(currentJournalId!, currentPageName, html);

    console.log(`[Foundry] Saved — ${username}: ${text}`);
  } catch (err) {
    console.error(`[Foundry] Failed to save transcript: ${(err as Error).message}`);
  }
}
