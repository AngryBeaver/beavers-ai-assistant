# Beaver's Voice Transcript — Foundry VTT Module
![Latest Release](https://img.shields.io/github/v/release/AngryBeaver/beavers-voice-transcript)
![Foundry Core Compatible Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-voice-transcript%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Foundry Systems](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fsystem%3FnameType%3Draw%26showVersion%3D1%26style%3Dflat%26url%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2FAngryBeaver%2Fbeavers-voice-transcript%2Fmain%2Fmodule.json)
![Download Count](https://img.shields.io/github/downloads/AngryBeaver/beavers-voice-transcript/total?color=green)


![AI Powered](https://img.shields.io/badge/AI-Whisper%20ASR-blueviolet)
![Setup Complexity](https://img.shields.io/badge/setup%20complexity-high-red)

Automatically records spoken dialogue from your game sessions and writes it to Foundry VTT Journal entries in real time.

---

## ⚠ This module does not work standalone

Installing this module in Foundry is only **one part** of the setup. By itself it does nothing visible — it exposes a socket API that an external voice bot connects to.

To get transcription working you also need:

- A **voice bot** that captures audio, transcribes it, and sends it here via the client library.
  The companion Discord bot in this repo does exactly that: [`discord-bot/`](../discord-bot/README.md)
- A running **[Whisper ASR](https://github.com/ahmetoner/whisper-asr-webservice)** instance for speech-to-text.
  Whisper runs in Docker. For anything beyond the `base` model you will want a dedicated **NVIDIA GPU** — CPU transcription at `medium` or larger is too slow for real-time use.
  See the [Discord bot README](../discord-bot/README.md) for Docker setup and model guidance.

In short: the effort involved is roughly *self-hosting a small AI service*, not just flipping a module toggle. If that sounds like your kind of project, read on.

---

## What this module does

The module runs inside your Foundry VTT instance and acts as the **receiving end**:

1. Auto-creates a dedicated **Bot-Control** Foundry user (role: Assistant GM) on first load.
2. Opens a `socket.io` channel that authenticated external tools can connect to.
3. Accepts transcript lines from the voice bot and appends them to a dated Journal entry.
4. Exposes a full Journal API — list, read, write, and append pages.

---

## Installation

Install via the Foundry module browser or paste the manifest URL directly:

```
https://github.com/AngryBeaver/beavers-voice-transcript/releases/latest/download/module.json
```

**Required dependencies** (install via Foundry module browser):
- `socketlib`
- `beavers-system-interface`

---

## Requirements

> **A Gamemaster must be connected** for the socket API to function. The module runs in the context of the active GM session — if no GM is logged in, API calls will silently fail.

---

## Setup

On first load the module automatically creates the **Bot-Control** user. Its credentials are shown under:

> **Settings → Configure Settings → Beaver's Voice Transcript → Connection Info**

Copy the **User ID** and **Password** into your bot's `.env` file (`FOUNDRY_USER` / `FOUNDRY_PASS`). The password can be regenerated any time from the same screen.

---

## Socket API

External tools connect via `socket.io-client` on the `module.beavers-voice-transcript` channel.

### Request / Response format

```json
{ "id": "<uuid>", "action": "<action>", "args": [...] }
{ "id": "<uuid>", "data": <result> }
{ "id": "<uuid>", "error": "<message>" }
```

### Actions

| Action | Args | Returns |
|---|---|---|
| `listJournals` | `[folder?]` | Folders and journals in root or given folder |
| `readJournal` | `[identifier]` | Full journal object with all pages |
| `writeJournal` | `[JournalData]` | Created/updated journal |
| `writeJournalPage` | `[journalIdentifier, JournalPageData]` | Created/updated page |
| `appendJournalPage` | `[journalIdentifier, pageName, html, maxPageBytes?]` | Appends HTML; auto-rotates page at size limit |

### Using the npm client

The easiest way to call the API from your own tool is the companion client package:

```ts
import { BeaversClient } from 'beavers-voice-transcript-client';

const client = new BeaversClient({
  url: 'http://localhost:30000',
  userId: '<Bot-Control user ID>',
  password: '<Bot-Control password>',
});

await client.connect();
await client.appendJournalPage('Session Log', 'Transcript', '<p><strong>Ada:</strong> We go left.</p>');
await client.disconnect();
```

See the [`client/`](../client) package for full API documentation. The client is optional — you can implement the socket protocol directly if you prefer.

---

## Development

```bash
cd foundry
npm install
npm run build       # compile TypeScript → dist/
npm run watch       # watch mode
npm run devbuild    # build directly into your local Foundry module directory
npm run devwatch    # watch mode into Foundry module directory
npm run release     # build + zip → package/
```

Set `devDir` in `package.json` to your local Foundry Data path for `devbuild` / `devwatch`.