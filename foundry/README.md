# Beaver's AI Assistant — Foundry VTT Module
![Latest Release](https://img.shields.io/github/v/release/AngryBeaver/beavers-voice-transcript)
![Foundry Core Compatible Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-voice-transcript%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Foundry Systems](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fsystem%3FnameType%3Draw%26showVersion%3D1%26style%3Dflat%26url%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2FAngryBeaver%2Fbeavers-voice-transcript%2Fmain%2Fmodule.json)
![Download Count](https://img.shields.io/github/downloads/AngryBeaver/beavers-voice-transcript/total?color=green)

![AI Powered](https://img.shields.io/badge/AI-Claude-blueviolet)

A Foundry VTT module with two complementary features:

1. **Voice Transcript** — records spoken dialogue from your game sessions and writes it to Foundry Journal entries in real time via a companion Discord bot.
2. **AI GM Window** — a GM-only panel that reads the current game state and suggests persona-accurate NPC responses, building a persistent picture of the campaign over time.

---

## ⚠ This module does not work fully standalone

The **Voice Transcript** feature requires an external voice bot. By itself that part of the module exposes a socket API that the bot connects to — it does nothing visible without it.

The **AI GM Window** requires an Anthropic API key but works standalone inside Foundry with no external bot.

---

## Voice Transcript

To get transcription working you need:

- A **voice bot** that captures audio, transcribes it, and sends it here via the client library.
  The companion Discord bot in this repo does exactly that: [`discord-bot/`](../discord-bot/README.md)
- A running **[Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice)** instance for speech-to-text.
  Whisper runs in Docker. For anything beyond the `base` model you will want a dedicated **NVIDIA GPU** — CPU transcription at `medium` or larger is too slow for real-time use.
  See the [Discord bot README](../discord-bot/README.md) for Docker setup and model guidance.

### What it does

1. Auto-creates a dedicated **ai-assistant** Foundry user (role: Assistant GM) on first load.
2. Opens a `socket.io` channel that authenticated external tools can connect to.
3. Accepts transcript lines from the voice bot and appends them to a dated Journal entry.
4. Exposes a full Journal API — list, read, write, and append pages.

### Setup

On first load the module automatically creates the **ai-assistant** user. Its credentials are shown under:

> **Settings → Configure Settings → Beaver's AI Assistant → Connection Info**

Copy the **User ID** and **Password** into your bot's `.env` file (`FOUNDRY_USER` / `FOUNDRY_PASS`). The password can be regenerated any time from the same screen.

### Socket API

External tools connect via `socket.io-client` on the `module.beavers-ai-assistant` channel.

#### Request / Response format

```json
{ "id": "<uuid>", "action": "<action>", "args": [...] }
{ "id": "<uuid>", "data": <result> }
{ "id": "<uuid>", "error": "<message>" }
```

#### Actions

| Action | Args | Returns |
|---|---|---|
| `listJournals` | `[folder?]` | Folders and journals in root or given folder |
| `readJournal` | `[identifier]` | Full journal object with all pages |
| `writeJournal` | `[JournalData]` | Created/updated journal |
| `writeJournalPage` | `[journalIdentifier, JournalPageData]` | Created/updated page |
| `appendJournalPage` | `[journalIdentifier, pageName, html, maxPageBytes?]` | Appends HTML; auto-rotates page at size limit |
| `writeSessionData` | `[html, pageName?, maxPageBytes?]` | Appends HTML to today's session journal; creates journal if needed |

#### Using the npm client

```ts
import { BeaversClient } from 'beavers-voice-transcript-client';

const client = new BeaversClient({
  url: 'http://localhost:30000',
  userId: '<ai-assistant user ID>',
  password: '<ai-assistant password>',
});

await client.connect();
await client.appendJournalPage('Session Log', 'Transcript', '<p><strong>Ada:</strong> We go left.</p>');
await client.disconnect();
```

See the [`client/`](../client) package for full API documentation.

---

## AI GM Window

A GM-only panel that acts as a narrative co-pilot. Press **Interact** and the AI reads the current game state, presents 1–3 candidate interactions for the GM to confirm, then streams a persona-accurate NPC response.

Accepted responses are stored in actor flags so the AI builds a persistent picture of NPCs and their history with the party over time.

### Requirements

- An **Anthropic API key** (Claude)
- Session journals written by the Discord bot (or manually) in the format `YYYY-MM-DD — Session`

### Setup

Under **Settings → Configure Settings → Beaver's AI Assistant**:

| Setting | Description |
|---|---|
| Claude API Key | Your Anthropic API key. Required. |
| Claude Model | Model ID. Defaults to `claude-sonnet-4-6`. |
| Session Journal Folder | Folder containing session journals. Required. |
| Session History Messages | How many recent journal entries to include in AI context. Default: 30. |
| Summary Journal Name | Journal for AI-generated session summaries. Default: `AI Session Summary`. |
| Adventure Journal Folder | Folder with adventure/lore journals. Optional — leave blank for emergent campaigns. |
| Lore Index Journal Name | Journal for the pre-built lore index. Default: `AI Lore Index`. |

### Lore Index (optional, pre-written adventures)

If you are running a published or pre-written adventure, click **Build Lore Index** in settings. The AI reads all your adventure journals and produces a compact structured index (NPCs, locations, factions) that is included in every Interact call. This keeps token costs low and gives the AI a stable world map to reason from.

---

## Installation

Install via the Foundry module browser or paste the manifest URL directly:

```
https://github.com/AngryBeaver/beavers-voice-transcript/releases/latest/download/module.json
```

**Required dependencies** (install via Foundry module browser):
- `socketlib`

> **A Gamemaster must be connected** for the socket API and AI GM Window to function.

---

## Development

```bash
cd foundry
pnpm install
pnpm run build       # compile TypeScript → dist/
pnpm run watch       # watch mode
pnpm run devbuild    # build directly into your local Foundry module directory
pnpm run devwatch    # watch mode into Foundry module directory
pnpm run release     # build + zip → package/
```

Set `devDir` in `package.json` to your local Foundry Data path for `devbuild` / `devwatch`.