# beavers-voice-transcript-client

Node.js client library for the [Beavers Voice Transcript](https://github.com/AngryBeaver/beavers-voice-transcript) Foundry VTT module.

Allows external tools and AI agents to read and write Foundry VTT journal entries over a socket connection.

## Requirements

- The **Beavers Voice Transcript** module must be installed and running in Foundry VTT.
- A **Gamemaster must be connected** to the Foundry instance for the API to function.
- A dedicated Bot-Control user must be configured in the module settings (see Connection Info).

## Installation

```bash
npm install beavers-voice-transcript-client
```

## Usage

```js
import { BeaversClient } from "beavers-voice-transcript-client";

const client = new BeaversClient({
  url: "http://localhost:30000",
  userId: "<userId from module Connection Info>",
  password: "<password from module Connection Info>",
});

await client.connect();

const journals = await client.listJournals();
const entry = await client.readJournal("My Journal");

await client.writeJournal({ name: "My Journal", folder: "My Folder" });
await client.writeJournalPage("My Journal", { name: "Page 1", text: { content: "<p>Hello</p>" } });

await client.disconnect();
```

## API

### `new BeaversClient(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | — | Foundry base URL, e.g. `http://localhost:30000` |
| `userId` | `string` | — | Bot-Control user ID from module Connection Info |
| `password` | `string` | — | Bot-Control password from module Connection Info |
| `timeout` | `number` | `10000` | Request timeout in ms |

### `connect()` → `Promise<void>`

Authenticates with Foundry and opens the socket connection. Must be called before any API method.

### `disconnect()` → `Promise<void>`

Closes the socket connection.

### `listJournals(folder?)` → `Promise<object[]>`

Lists journal entries and subfolders. Omit `folder` to list from the root.

### `readJournal(identifier)` → `Promise<object>`

Reads a journal entry by name or ID.

### `writeJournal(data: JournalData)` → `Promise<object>`

Creates or updates a journal entry. Matches an existing entry by `id` or `name`; creates a new one if neither matches.

```ts
interface JournalData {
  id?:        string;           // update by ID
  name?:      string;           // update/create by name
  folder?:    string;           // folder name or ID; created automatically if missing
  pages?:     JournalPageData[]; // created atomically on first creation only
  ownership?: Record<string, number>; // e.g. { default: 0 }
  flags?:     Record<string, unknown>;
}
```

```js
await client.writeJournal({ name: "Session 12", folder: "Sessions" });
```

### `writeJournalPage(journalIdentifier, pageData: JournalPageData)` → `Promise<object>`

Creates or replaces a page inside a journal entry. Matches an existing page by `id` or `name`.

```ts
interface JournalPageData {
  id?:    string;
  name?:  string;
  type?:  "text" | "image" | "pdf" | "video"; // default: "text"
  text?: {
    content?:  string;  // raw HTML
    markdown?: string;  // markdown source (when format = 2)
    format?:   1 | 2;  // 1 = HTML (default), 2 = Markdown
  };
  src?:   string;       // media URI for image/pdf/video pages
  title?: { show?: boolean; level?: 1|2|3|4|5|6 };
  flags?: Record<string, unknown>;
}
```

```js
await client.writeJournalPage("Session 12", {
  name: "Summary",
  type: "text",
  text: { content: "<p>The party entered the dungeon.</p>" },
});
```

### `appendJournalPage(journalIdentifier, pageName, html, maxPageBytes?)` → `Promise<object>`

Appends HTML to a page, auto-rotating to a new page (`Transcript (2)`, `Transcript (3)`, …) when the current page exceeds `maxPageBytes` (default `50000`). Creates the first page if none exists.

Ideal for transcription — each utterance is one call, pages never grow unboundedly.

```js
await client.appendJournalPage("Session 12", "Transcript", "<p><b>GM:</b> You enter the tavern.</p>");
await client.appendJournalPage("Session 12", "Transcript", "<p><b>Alice:</b> I look around.</p>");
// rotates to "Transcript (2)" automatically once 50 KB is reached
```

## CLI

A CLI is included for quick scripting via an `.env` file:

```bash
# .env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USER=<userId>
FOUNDRY_PASS=<password>
```

```bash
npx beavers-client listJournals
npx beavers-client listJournals "My Folder"
npx beavers-client readJournal "My Journal"
npx beavers-client writeJournal '{"name":"My Journal","folder":"My Folder"}'
npx beavers-client writeJournalPage "My Journal" '{"name":"Page 1","text":{"content":"<p>Hi</p>"}}'
```

## License

MIT