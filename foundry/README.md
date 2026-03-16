# Beaver's Voice Transcript — Foundry VTT Module

A Foundry VTT module that exposes a socket API so external tools can read and write Journal entries.

## Installation

Install via the Foundry module browser or paste the manifest URL:

```
https://github.com/AngryBeaver/beavers-voice-transcript/releases/latest/download/module.json
```

**Dependencies:** `socketlib`, `beavers-system-interface`

## Requirements

> **A Gamemaster must be connected to the Foundry instance** for the socket API to function. The module runs in the context of the active Gamemaster session.

## Setup

On first load the module automatically creates an **Bot-Control** Foundry user (role: Assistant GM). The credentials for this user are shown in:

> **Settings → Configure Settings → Beaver's Voice Transcript → Connection Info**

Copy the **User ID** and **Password** into your external tool's configuration. Regenerate the password any time from the same UI.

## Socket API

External tools connect via `socket.io-client` and exchange messages on the `module.beavers-voice-transcript` channel.

### Request format

```json
{ "id": "<uuid>", "action": "<action>", "args": [...] }
```

### Response format

```json
{ "id": "<uuid>", "data": <result> }
{ "id": "<uuid>", "error": "<message>" }
```

### Actions

| Action | Args | Returns |
|---|---|---|
| `listJournals` | `[folder?]` | `[{ id, name, type }]` — folders and journals in root or given folder |
| `readJournal` | `[identifier]` | Journal object with pages |
| `writeJournal` | `[data]` | Updated/created journal |
| `writeJournalPage` | `[journalIdentifier, pageData]` | Updated/created page |

### Using the npm client

The easiest way to connect is via the companion npm package:

```js
import { BeaversClient } from "beavers-voice-transcript-client";

const client = new BeaversClient({
  url: "http://localhost:30000",
  userId: "<Bot-Control user ID>",
  password: "<Bot-Control password>",
});

await client.connect();
const journals = await client.listJournals();
await client.disconnect();
```

See the [`client/`](../client) package for full documentation.

## Development

```bash
cd foundry
npm install
npm run build       # compile TypeScript → dist/
npm run watch       # watch mode
npm run devbuild    # build directly into Foundry's module directory
npm run devwatch    # watch mode into Foundry's module directory
npm run release     # build + zip → package/
```

Set `devDir` in `package.json` to your local Foundry Data path for `devbuild`/`devwatch`.
