# Beaver's Voice Transcript

Connects external AI tools to [Foundry VTT](https://foundryvtt.com) by exposing a socket API for reading and writing Journal entries.

## What's in this repo

| Directory | What it is |
|---|---|
| [`foundry/`](./foundry) | The Foundry VTT module — TypeScript source, build tooling, module manifest |
| [`client/`](./client) | `beavers-voice-transcript-client` npm package — use this in your own tools to talk to the module |
| [`test/`](./test) | Local test CLI — quick manual testing against a running Foundry instance |

## How it works
1. Install the **Foundry module** (`foundry/`) in your Foundry VTT instance.
2. The module auto-creates an **Bot-Control** user and shows its credentials in the module settings.
3. Use the **npm client** (`client/`) in your tool to connect and call the API:

```js
import { BeaversClient } from "beavers-voice-transcript-client";

const client = new BeaversClient({ url, userId, password });
await client.connect();

const journals = await client.listJournals();
const journal  = await client.readJournal("My Journal");
await client.writeJournalPage("My Journal", { name: "Page 1", text: { content: "<p>hello</p>" } });

await client.disconnect();
```

## Docs

- [Foundry module setup & socket API reference](./foundry/README.md)
- [npm client package](./client/package.json)
- [Test client usage](./test/README.md)
