import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL ?? 'http://localhost:30000';
const FOUNDRY_USER = process.env.FOUNDRY_USER ?? '';
const FOUNDRY_PASS = process.env.FOUNDRY_PASS ?? '';

let client: BeaversClient | null = null;

export async function connect(): Promise<void> {
  client = new BeaversClient({
    url: FOUNDRY_URL,
    userId: FOUNDRY_USER,
    password: FOUNDRY_PASS,
  });
  await client.connect();
  console.log('[Foundry] Connected');
}

export async function showChatBubble(username: string, text: string): Promise<void> {
  if (!client?.connected) console.warn(`[Foundry] → chatBubble (connected=${client?.connected})`);
  try {
    await client!.chatBubble(username, text);
  } catch (err) {
    console.error(`[Foundry] Failed to show chat bubble: ${(err as Error).message}`);
  }
}

export async function transcribeJournal(username: string, text: string): Promise<void> {
  if (!client?.connected)
    console.warn(`[Foundry] → transcribeJournal (connected=${client?.connected})`);
  try {
    await client!.transcribeJournal(text, username);
    console.log(`[Foundry] Saved — ${username}: ${text}`);
  } catch (err) {
    console.error(`[Foundry] Failed to save transcript: ${(err as Error).message}`);
  }
}

export async function checkGmPresent(): Promise<boolean> {
  if (!client?.connected) console.warn(`[Foundry] → gmPresent (connected=${client?.connected})`);
  try {
    return await client!.gmPresent();
  } catch (err) {
    console.error(`[Foundry] gmPresent check failed: ${(err as Error).message}`);
    return false;
  }
}
