# Discord AI Voice Bot

Listens to a Discord voice channel, transcribes speech with a local Whisper instance, and stores the session as a Journal Entry in FoundryVTT.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| Docker Desktop | For the Whisper container |
| Discord bot token | See [Discord setup](#discord-setup) below |
| FoundryVTT (local) | With the **Beavers AI Assistant** module installed |

---

## Discord Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, create a bot and copy the token.
3. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
   - Server Members Intent
4. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`
5. Bot permissions needed: `Connect`, `Speak`, `Read Messages`, `Send Messages`
6. Invite the bot to your server using the generated URL.
7. Enable **Developer Mode** in Discord settings, then right-click your server → **Copy Server ID** (Guild ID) and right-click your voice channel → **Copy Channel ID**.

---

## FoundryVTT Setup

1. Install the **Beavers AI Assistant** module in FoundryVTT.
2. Enable the module in your world.
3. Open the module settings and create a dedicated **AI-Assistant user** with a password.
4. Note the **User ID** and **password** — these go into `.env` as `FOUNDRY_USER` and `FOUNDRY_PASSWORD`.
5. Make sure a Gamemaster is logged in when the bot runs (the module requires an active GM connection).

---

## Installation

```bash
git clone <repo-url>
cd discord-ai-bot

cp .env.example .env
# Fill in your values (see Configuration below)

npm install
```

---

## Configuration

Edit `.env`:

```env
DISCORD_TOKEN=        # Bot token from Discord Developer Portal
DISCORD_GUILD_ID=     # Your server ID
DISCORD_CHANNEL_ID=   # Voice channel to auto-join on startup
WHISPER_URL=http://localhost:9000
WHISPER_MODEL=base           # See model table below
WHISPER_LANGUAGE=            # blank = auto-detect | e.g. en, de, fr, nl ...
WHISPER_TASK=transcribe      # transcribe (keep language) | translate (to English)
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USER=        # User ID from Beavers AI Assistant module settings
FOUNDRY_PASSWORD=    # Password for that user
```

### Whisper model sizes

Larger = more accurate, slower, more VRAM. On CPU all models are slow — GPU strongly recommended for medium and above.

| Model | VRAM | CPU speed | GPU speed | Notes |
|---|---|---|---|---|
| tiny | ~1 GB | fast | very fast | Low accuracy |
| base | ~1 GB | ok | fast | Good for testing |
| small | ~2 GB | slow | fast | Decent accuracy |
| medium | ~5 GB | very slow | real-time | Good balance |
| large | ~10 GB | impractical | near real-time | High accuracy |
| large-v3 | ~10 GB | impractical | near real-time | Best multilingual |

### Language settings

`WHISPER_LANGUAGE` — sets the **input** language. Leave blank to auto-detect.
Common codes: `en` `de` `fr` `nl` `es` `it` `pl` `ja`

`WHISPER_TASK` — controls **output** language:
- `transcribe` — output stays in the same language as the input
- `translate` — output is always **English**, regardless of input language (Whisper limitation — no other output language is supported)

---

## Running

**1. Start Whisper:**

CPU only (any machine):
```bash
docker compose up -d
```

Nvidia GPU (faster, recommended for medium/large models):
```bash
docker compose -f docker-compose.gpu.yml up -d
```

> GPU requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on the host.

**2. Start the bot:**
```bash
npm start
```

The bot will automatically join the voice channel set in `DISCORD_CHANNEL_ID`.

---

## Bot Commands

Send these in any text channel the bot can read:

| Command | Description |
|---|---|
| `!join #channel` | Move the bot to a different voice channel |
| `!leave` | Disconnect the bot from voice |

---

## What Happens During a Session

1. A user speaks → silence detected after ~1 second
2. Audio is transcribed by Whisper (local, no data leaves your machine)
3. Transcript line is appended to a FoundryVTT Journal Entry:
   - Folder: `Session Transcripts`
   - Entry name: `YYYY-MM-DD — Discord Session`

---

## Stopping

```bash
# Stop the bot: Ctrl+C

# Stop Whisper container:
docker compose down
```
