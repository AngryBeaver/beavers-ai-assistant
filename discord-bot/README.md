# Discord Voice Bot

Listens to a Discord voice channel, transcribes speech with a local Whisper instance, and stores the session as a Journal Entry in FoundryVTT.

---

## Quick Start (GPU)

Create a `docker-compose.yml` and a `.env` file in the same directory.

### docker-compose.yml

```yaml
services:
  whisper:
    image: onerahmet/openai-whisper-asr-webservice:latest-gpu
    ports:
      - "9000:9000"
    environment:
      - ASR_MODEL=${WHISPER_MODEL:-base}
      - ASR_ENGINE=openai_whisper
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  discord-bot:
    image: angrybeaver/discord-foundry-bot:latest
    env_file: .env
    environment:
      - WHISPER_URL=http://whisper:9000
    depends_on:
      - whisper
    restart: unless-stopped
```

> GPU requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).
> For CPU-only, remove the `deploy` block and use `onerahmet/openai-whisper-asr-webservice:latest`.

## Setup
### Discord Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, create a bot and copy the token.
3. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
   - Server Members Intent
4. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`
5. Bot permissions needed: `Connect`, `Speak`, `Read Messages`, `Send Messages`
6. Invite the bot to your server using the generated URL.
7. Enable **Developer Mode** in Discord settings, then right-click your server → **Copy Server ID** (Guild ID) and right-click your voice channel → **Copy Channel ID**.

### FoundryVTT Setup

1. Install the **Beavers AI Assistant** module in FoundryVTT.
2. Enable the module in your world.
3. Open the module settings and create a dedicated **AI-Assistant user** with a password.
4. Note the **User ID** and **password** — these go into `.env` as `FOUNDRY_USER` and `FOUNDRY_PASS`.
5. Make sure a Gamemaster is logged in when the bot runs (the module requires an active GM connection).

## Configuration

### Discord

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | Your server ID |
| `DISCORD_CHANNEL_ID` | Voice channel the bot auto-joins on startup |

### FoundryVTT

| Variable | Description |
|---|---|
| `FOUNDRY_URL` | FoundryVTT base URL, e.g. `http://localhost:30000` |
| `FOUNDRY_USER` | User ID from the Beavers AI Assistant module settings |
| `FOUNDRY_PASS` | Password for that user |
| `FOUNDRY_FOLDER_NAME` | Journal folder to write into (default: `Session Transcripts`) |
| `FOUNDRY_PAGE_NAME` | Journal page name (default: `Transcript`) |

### Bot Commands

| Variable | Default | Description |
|---|---|---|
| `BOT_NAME` | `Scribe` | Trigger word the bot listens for |
| `BOT_COMMAND_START` | `write down` | Phrase to start writing to FoundryVTT |
| `BOT_COMMAND_PAUSE` | `stop it` | Phrase to pause writing |
| `BOT_COMMAND_PAGE` | `new page` | Phrase to switch to a new journal page |

### Whisper

| Variable | Description |
|---|---|
| `WHISPER_URL` | Whisper API endpoint (default: `http://localhost:9000`) |
| `WHISPER_MODEL` | Model size — see table below |
| `WHISPER_LANGUAGE` | Input language code, e.g. `de`, `en` — leave blank to auto-detect |
| `WHISPER_TASK` | `transcribe` (keep language) or `translate` (output always English) |
| `WHISPER_INITIAL_PROMPT` | Optional prompt to prime Whisper with expected words |
| `WHISPER_TIMEOUT_MS` | Abort request after this many ms if Whisper hangs (default: `30000`) |

#### Nvidia GPU setup

Using a GPU is strongly recommended for medium and above. Follow these steps before starting the Whisper container.

**1. Install the Nvidia driver**

Download and install the latest Game Ready or Studio driver for your card from [nvidia.com/drivers](https://www.nvidia.com/drivers).

**2. Check your CUDA version**

After installing the driver, open a terminal and run:
```bash
nvidia-smi
```
The top-right corner shows the maximum CUDA version your driver supports, e.g. `CUDA Version: 12.4`.

**3. Pick the right Whisper image tag**

The GPU image requires a CUDA-compatible driver. Use the tag that matches your CUDA version:

| CUDA version | Image tag |
|---|---|
| 12.x | `onerahmet/openai-whisper-asr-webservice:latest-gpu` |
| 11.x | `onerahmet/openai-whisper-asr-webservice:v1.6.0-gpu` |

If `nvidia-smi` shows CUDA 12.x, `latest-gpu` is fine. If you are on an older driver (CUDA 11.x), pin to the older tag.

**4. Install the NVIDIA Container Toolkit**

Required for Docker to access the GPU. Follow the official guide:
[docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

On Windows with Docker Desktop, enable **WSL 2 backend** and install the toolkit inside WSL.

> If you share your GPU with a browser or other apps, consider setting your browser to use the integrated GPU (Windows Settings → System → Display → Graphics) to free up VRAM for Whisper.

---

#### Whisper model sizes

Larger = more accurate, slower, more VRAM. On CPU all models are slow — GPU strongly recommended for medium and above.

| Model | VRAM | CPU speed | GPU speed | Notes |
|---|---|---|---|---|
| tiny | ~1 GB | fast | very fast | Low accuracy |
| base | ~1 GB | ok | fast | Good for testing |
| small | ~2 GB | slow | fast | Decent accuracy |
| medium | ~5 GB | very slow | real-time | Good balance |
| large | ~10 GB | impractical | near real-time | High accuracy |
| large-v3 | ~10 GB | impractical | near real-time | Best multilingual |

#### Language settings

`WHISPER_LANGUAGE` — sets the **input** language. Leave blank to auto-detect.
Common codes: `en` `de` `fr` `nl` `es` `it` `pl` `ja`

`WHISPER_TASK` — controls the **output** language:
- `transcribe` — output stays in the same language as the input
- `translate` — output is always **English**, regardless of input language (Whisper limitation — no other output language is supported)

`WHISPER_INITIAL_PROMPT` — a text string Whisper treats as if it were spoken just before your audio. Use it to list the bot name and command phrases so Whisper recognises them reliably:
```
WHISPER_INITIAL_PROMPT=Scribe write down. Scribe stop it. Scribe new page.
```

---

## Voice Commands

The bot starts **paused** — transcriptions are printed to the console but not written to FoundryVTT. Speak to control it:

| Say | Effect |
|---|---|
| `Scribe write down` | Start writing transcript lines to FoundryVTT |
| `Scribe stop it` | Pause writing (console-only again) |
| `Scribe new page <name>` | Switch to a new journal page with the given name |

The phrases above use the default values. They can be changed via the `BOT_NAME`, `BOT_COMMAND_START`, `BOT_COMMAND_PAUSE`, and `BOT_COMMAND_PAGE` environment variables.

Matching is fuzzy (case-insensitive, punctuation-tolerant) to account for Whisper transcription variations.

---

## What Happens During a Session

1. A user speaks → silence detected after ~1 second
2. Audio is sent to the local Whisper instance — no data leaves your machine
3. The transcript is checked for voice commands (see above)
4. If recording is active, the line is appended to a FoundryVTT Journal Entry:
   - Folder: value of `FOUNDRY_FOLDER_NAME`
   - Entry: value of `FOUNDRY_PAGE_NAME`

Text commands available in any Discord text channel the bot can read:

| Command | Description |
|---|---|
| `!join #channel` | Move the bot to a different voice channel |
| `!leave` | Disconnect the bot from voice |

---

## Building and Running Locally

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 22+ | [nodejs.org](https://nodejs.org) |
| Docker Desktop | For the Whisper container |
| Discord bot token | See [Discord setup](#discord-setup) below |
| FoundryVTT (local) | With the **Beavers AI Assistant** module installed |


### Installation

```bash
git clone https://github.com/AngryBeaver/beavers-voice-transcript.git
cd beavers-voice-transcript/discord-bot

cp .env.example .env
# Fill in your values
```

```bash
npm install
```

### Running

**1. Start Whisper:**

CPU only:
```bash
docker compose up -d
```

Nvidia GPU:
```bash
docker compose -f docker-compose.gpu.yml up -d
```

**2. Start the bot:**
```bash
npm start
```

The bot will automatically join the voice channel set in `DISCORD_CHANNEL_ID`.

### Stopping

```bash
# Stop the bot: Ctrl+C

# Stop Whisper container:
docker compose down
```