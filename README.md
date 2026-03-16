# Beaver's Voice Transcript

Records spoken dialogue during your Foundry VTT sessions and writes it to Journal entries — automatically, in real time.

## What's in this repo

| Directory | What it is |
|---|---|
| [`foundry/`](./foundry) | The Foundry VTT module — install this in your Foundry instance |
| [`discord-bot/`](./discord-bot) | Discord bot that listens to a voice channel and transcribes speech via Whisper |
| [`client/`](./client) | *(Optional)* `beavers-voice-transcript-client` npm package — connect your own voice bot or tool to the module |
| [`test/`](./test) | Local test CLI — quick manual testing against a running Foundry instance |

## How it works

1. Install the **Foundry module** (`foundry/`) in your Foundry VTT instance.
2. The module auto-creates a **Bot-Control** user and shows its credentials in the module settings.
3. Run the **Discord bot** (`discord-bot/`) — it joins your voice channel, transcribes speech via a local [Whisper](https://github.com/openai/whisper) instance, and writes transcripts to Foundry journals.

The bot starts in **listen-only mode** and is controlled by voice commands:

| Voice command | Action |
|---|---|
| `{BOT_NAME} {BOT_COMMAND_START}` | Start writing transcripts to Foundry |
| `{BOT_NAME} {BOT_COMMAND_PAUSE}` | Pause — transcripts go to console only |
| `{BOT_NAME} {BOT_COMMAND_PAGE} <name>` | Switch to a new journal page named `<name>` |

## Using the client in your own tool

The `client/` package is optional. Use it if you want to connect a different voice bot or external tool to the same Foundry module:

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

- [Discord bot setup & voice commands](./discord-bot/README.md)
- [Foundry module setup & socket API reference](./foundry/README.md)
- [Client package](./client/README.md)