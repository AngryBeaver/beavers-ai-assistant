# Spec: Session API Migration

## Goal

Move session journal naming and folder configuration out of the Discord bot and into the Foundry module. The module owns the convention `YYYY-MM-DD — Session` and the folder location via a new `writeSessionData` socket method. Callers pass only content — no folder, no journal name.

---

## Why

Previously the Discord bot chose both the journal name and the folder. This meant the AI GM Window had to be told separately where session journals live. Now the module owns both — the GM configures the folder once in module settings, and all callers (Discord bot, future integrations) just send content. The AI always knows where to look.

---

## Changes Required

### 1. Foundry module (`foundry/src/`)

Already specified in `foundry/SPEC-ai-suggestions.md` under "API Changes", with this update:

- `writeSessionData` reads the session folder from the module setting `sessionJournalFolder` internally — **no folder parameter**
- If `sessionJournalFolder` is not configured, the method throws a descriptive error
- Signature: `writeSessionData(html: string, pageName?: string, maxPageBytes?: number)`
- Register it as a socket method in `beavers-voice-transcript.ts`

### 2. Client (`client/src/index.ts`)

```ts
/**
 * Append HTML to today's session journal.
 * The module generates the journal name ("YYYY-MM-DD — Session") and reads
 * the session folder from its own settings — no folder needed from the caller.
 */
async writeSessionData(
  html: string,
  pageName?: string,
  maxPageBytes?: number,
): Promise<void> {
  return this.#request('writeSessionData', [html, pageName, maxPageBytes]);
}
```

`appendJournalPage` stays on the client — still useful for non-session writes.

### 3. Discord bot (`discord-bot/src/foundry.ts`)

Simplify `appendTranscript`. Remove `currentJournalId`, `sessionTitle()`, and `FOLDER_NAME` usage for this call entirely.

Before:
```ts
const FOLDER_NAME = process.env.FOUNDRY_FOLDER_NAME ?? 'Session Transcripts';
let currentJournalId: string | null = null;

export async function appendTranscript(username: string, text: string): Promise<void> {
  if (!currentJournalId) {
    const journal = await client!.writeJournal({ name: sessionTitle(), folder: FOLDER_NAME });
    currentJournalId = journal?._id ?? journal?.id ?? null;
  }
  const html = `<p><strong>${escapeHtml(username)}:</strong> ${escapeHtml(text)}</p>`;
  await client!.appendJournalPage(currentJournalId!, currentPageName, html);
}
```

After:
```ts
export async function appendTranscript(username: string, text: string): Promise<void> {
  const html = `<p><strong>${escapeHtml(username)}:</strong> ${escapeHtml(text)}</p>`;
  await client!.writeSessionData(html, currentPageName);
}
```

Also remove:
- `currentJournalId` variable
- `sessionTitle()` function
- `FOLDER_NAME` constant (folder is now a Foundry module setting, not a bot env var)

`setPageName` and `currentPageName` stay — page name is still useful for callers to control.

---

## Migration Notes

- The GM must configure `sessionJournalFolder` in the Foundry module settings before the Discord bot can write. If not set, `writeSessionData` throws and the bot logs an error.
- Existing journals named `YYYY-MM-DD — Discord Session` are unaffected
- New journals will be named `YYYY-MM-DD — Session` in the configured folder
- The AI GM Window reads from the same `sessionJournalFolder` setting — one source of truth
- No data loss, no breaking change for existing sessions

---

## Rollout Order

1. Implement `writeSessionData` in Foundry module (reads folder from settings) + bump module version
2. Update client + publish new client version
3. Update Discord bot to use new client version + remove `FOUNDRY_FOLDER_NAME` env var