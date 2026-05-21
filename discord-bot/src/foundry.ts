import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL ?? 'http://localhost:30000';
const FOUNDRY_USER = process.env.FOUNDRY_USER ?? '';
const FOUNDRY_PASS = process.env.FOUNDRY_PASS ?? '';

let client: BeaversClient | null = null;

export async function connect(): Promise<void> {
  const c = new BeaversClient({
    url: FOUNDRY_URL,
    userId: FOUNDRY_USER,
    password: FOUNDRY_PASS,
  });
  await c.connect();
  client = c;
  console.log('[Foundry] Connected');
}

function requireClient(): BeaversClient {
  if (!client?.connected) {
    throw new Error(
      `Not connected to Foundry (client=${client == null ? 'null — connect() failed or not called' : 'disconnected'}). ` +
        `Check FOUNDRY_URL=${FOUNDRY_URL}, FOUNDRY_USER and FOUNDRY_PASS in .env.`,
    );
  }
  return client;
}

export async function showChatBubble(username: string, text: string): Promise<void> {
  try {
    await requireClient().chatBubble(username, text);
  } catch (err) {
    console.error(`[Foundry] Failed to show chat bubble: ${(err as Error).message}`);
  }
}

export async function transcribeJournal(username: string, text: string): Promise<void> {
  try {
    await requireClient().transcribeJournal(text, username);
    console.log(`[Foundry] Saved — ${username}: ${text}`);
  } catch (err) {
    console.error(`[Foundry] Failed to save transcript: ${(err as Error).message}`);
  }
}

export async function checkGmPresent(): Promise<boolean> {
  try {
    return await requireClient().gmPresent();
  } catch (err) {
    console.error(`[Foundry] gmPresent check failed: ${(err as Error).message}`);
    return false;
  }
}
