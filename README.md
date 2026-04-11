# Beaver's AI Assistant

An AI-powered Foundry VTT companion with two features:

| Feature | What it does |
|---|---|
| **AI GM Window** | GM-only panel that reads the current game state and suggests persona-accurate NPC responses, building a persistent picture of NPCs and campaign history over time |
| **Voice Transcript** | Records spoken dialogue from your sessions and writes it to Foundry Journal entries in real time via a companion Discord bot |

## What's in this repo

| Directory | What it is |
|---|---|
| [`foundry/`](./foundry) | The Foundry VTT module — install this in your Foundry instance |
| [`discord-bot/`](./discord-bot) | Discord bot that listens to a voice channel and transcribes speech via Whisper |
| [`client/`](./client) | *(Optional)* `beavers-voice-transcript-client` npm package — connect your own voice bot or tool to the module |
| [`test/`](./test) | Local test CLI — quick manual testing against a running Foundry instance |

## AI GM Window

Press **Interact** in the GM panel and the AI:
1. Reads the active scene, recent session chat, session summary, and adventure lore
2. Presents 1–3 candidate interactions (NPC + what the party is asking) for the GM to confirm
3. Streams a persona-accurate NPC response based on stored personality, history with the party, and current context

Accepted responses are stored in actor flags. The AI builds a richer picture of each NPC over time.

Requires an **Anthropic API key** — configured in module settings.

## Voice Transcript

1. Install the **Foundry module** (`foundry/`) in your Foundry VTT instance.
2. The module auto-creates an **ai-assistant** user and shows its credentials in the module settings.
3. Run the **Discord bot** (`discord-bot/`) — it joins your voice channel, transcribes speech via a local [Whisper](https://github.com/openai/whisper) instance, and writes transcripts to Foundry journals.

See **[Docker Setup Guide](./DOCKER-SETUP.md)** for instructions on running both components locally (zero API cost).

The bot starts in **listen-only mode** and is controlled by voice commands:

| Voice command | Action |
|---|---|
| `{BOT_NAME} {BOT_COMMAND_START}` | Start writing transcripts to Foundry |
| `{BOT_NAME} {BOT_COMMAND_PAUSE}` | Pause — transcripts go to console only |

## Using the client in your own tool

```ts
import { BeaversClient } from 'beavers-voice-transcript-client';

const client = new BeaversClient({ url, userId, password });
await client.connect();

await client.appendJournalPage('Session Log', 'Transcript', '<p><strong>Ada:</strong> We go left.</p>');
await client.writeJournalPage('My Journal', { name: 'Page 1', text: { content: '<p>hello</p>' } });
const journal = await client.readJournal('My Journal');

await client.disconnect();
```

## Docs

- [Foundry module setup, AI GM Window & socket API](./foundry/README.md)
- [Discord bot setup & voice commands](./discord-bot/README.md)
- [Client package](./client/README.md)
