# Discord AI Voice Listener Bot — Build Plan

## Goal
A Discord bot that joins a voice channel, listens to real conversations,
transcribes speech using a locally-hosted Whisper instance

---

## Language & Runtime
- **Node.js** (JavaScript)
- Reason: discord.js + @discordjs/voice has the best voice-receiving support
  of any Discord library across all languages

---

## Architecture

```
Discord Voice Channel
        │
        ▼
  Discord Bot (Node.js)
  @discordjs/voice — captures per-user Opus audio streams
        │
        ▼
  prism-media — decodes Opus → PCM
        │
        ▼
  WAV buffer (in-memory)
        │
        ▼
  Whisper (Docker container, local REST API)
  POST http://localhost:9000/asr
        │
        ▼
  Transcript text
        │
        ▼
  Foundry REST API Module
  POST http://localhost:30000/api/journal
  — appends to session Journal Entry
  — organized by date/session folder
        │
        ▼
  Console log
```

---

## Components

### 1. Docker — Whisper ASR Service
- Image: `onerahmet/openai-whisper-asr-webservice`
- Exposes REST endpoint: `POST http://localhost:9000/asr`
- Model configurable via env var: `tiny | base | small | medium | large`
- No API key, no cost — runs fully locally

### 2. Discord Bot (src/)
| File | Purpose |
|---|---|
| `src/index.js` | Entry point, Discord client setup, command handling |
| `src/voice.js` | Join voice channel, capture audio per user, write WAV |
| `src/whisper.js` | HTTP client — sends WAV buffer to local Whisper container |
| `src/foundry.js` | Foundry REST API client — stores transcripts as Journal Entries |

### 3. FoundryVTT Setup
- Install community module: **Foundry REST API** (or equivalent)
- Enable in active world, configure API key if the module supports one
- Journal folder `Session Transcripts` created automatically on first write
- One Journal Entry per session, named `YYYY-MM-DD — Discord Session`
- Each transcript line appended as HTML: `<p><strong>Username:</strong> text</p>`

### 4. Configuration (.env)
```
DISCORD_TOKEN=        # Bot token from Discord Developer Portal
DISCORD_GUILD_ID=     # Server ID to connect to
DISCORD_CHANNEL_ID=   # Voice channel ID to join on startup
WHISPER_URL=http://localhost:9000
WHISPER_MODEL=base
FOUNDRY_URL=http://localhost:30000
FOUNDRY_API_KEY=      # Set in Foundry REST API module settings
```

---

## Bot Behavior
- On startup: automatically joins the configured voice channel
- Listens for speaking events per user
- When a user stops talking (1s silence): captures their audio clip
- Sends audio to Whisper → gets transcript
- Logs: `[Username]: transcript text`
- Appends transcript line to Foundry Journal Entry (session-scoped, created if missing)
- Text command `!join #channel` to move the bot to a different channel
- Text command `!leave` to disconnect

---

## npm Dependencies
```
discord.js
@discordjs/voice
@discordjs/opus
prism-media
dotenv
node-fetch
```

---

## Docker Setup
- `docker-compose.yml` — runs Whisper container
- Bot runs locally (not containerized, to keep Discord token handling simple)
- Optional: add bot to docker-compose later

---

## What You Need Before Starting
1. Discord bot token — create at https://discord.com/developers/applications
   - Enable: `Message Content Intent`, `Server Members Intent`
   - Enable: `Voice` permission + `Read Messages` in your server
2. Docker Desktop running
3. Node.js 18+ installed
4. Guild ID and Voice Channel ID from Discord (enable Developer Mode → right-click → Copy ID)