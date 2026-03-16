# beavers-voice-transcript — test client

A standalone Node.js client to manually test the module's socket API against a running Foundry instance.

> **A Gamemaster must be connected to the Foundry instance** before running any tests.

## Setup

```bash
cd test
npm install
cp .env.example .env
```

Edit `.env` with your Foundry credentials and (optionally) the module's API token:

```env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USER=Gamemaster
FOUNDRY_PASS=yourpassword
API_TOKEN=yourtoken
```

`API_TOKEN` can be left empty if you haven't set one in the module settings.

## Running

### npm scripts (recommended)

```bash
# List journals in root (no argument) or a specific folder
npm run list
npm run list -- "My Folder Name"

# Read a journal by name or ID
npm run read -- "My Journal Name"

# Create / update a journal
npm run write -- '{"name":"Test Journal","content":"hello"}'

# Create / update a page inside a journal
npm run write-page -- "My Journal Name" '{"name":"Page 1","text":{"content":"<p>hello</p>"}}'
```

### Or directly with node

```bash
node --env-file=.env client.mjs readJournal "My Journal Name"
node --env-file=.env client.mjs writeJournal '{"name":"Test","content":"hello"}'
node --env-file=.env client.mjs writeJournalPage "My Journal" '{"name":"p1","text":{"content":"<p>hi</p>"}}'
```

## How it works

1. POSTs to `/join` with your credentials to get a session cookie.
2. Connects a `socket.io-client` using that cookie.
3. Emits a request on `module.beavers-voice-transcript` with a correlation ID.
4. Waits for the response with the matching ID and prints the result.

Requires Node.js **v20.6+** (for `--env-file` support).
