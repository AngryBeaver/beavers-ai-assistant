# Spec: AI GM Window

## Goal

A GM-only panel that acts as a narrative co-pilot. The GM presses one button and the AI reads the current game state, infers who the party is likely interacting with, and suggests a persona-accurate response from that NPC. The GM uses the suggestion as a reference when speaking to their players. Accepted suggestions are stored back into the world (actor flags, session journal) so the AI builds a persistent picture of the campaign over time.

---

## Settings (configured before use)

Registered in `ApiSettings.ts`. If required settings are missing the panel shows an inline prompt to configure them before any AI call is made.

| Key | Type | Default | Description |
|---|---|---|---|
| `claudeApiKey` | String (secret) | — | Anthropic API key. Required. |
| `claudeModel` | String | `claude-sonnet-4-6` | Model ID. |
| `adventureJournalFolder` | String | — | Folder name containing adventure/lore journals. Required. |
| `sessionJournalFolder` | String | — | Folder containing session journals (one journal per day, named `YYYY-MM-DD — Session`). Required. |
| `sessionHistoryMessages` | Number | 30 | How many recent session journal entries to include in context. |
| `summaryJournalName` | String | `AI Session Summary` | Journal where AI-generated session summaries are stored. |

---

## Panel Layout

The panel is a persistent `ApplicationV2` window, GM-only.

```
┌──────────────────────────────────────────┐
│ AI GM Window                         [X] │
├──────────────────────────────────────────┤
│                                          │
│  [Session Summary]        [Interact]     │  ← top-level controls
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Persona: Aldric the Innkeeper      │  │  ← inferred persona header
│  │ (created from adventure lore)      │  │
│  ├────────────────────────────────────┤  │
│  │ "Aye, I've seen stranger folk      │  │  ← streaming suggestion
│  │  pass through. What's it to ya?"   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Less Grumpy] [Friendlier]              │  ← persona mood adjustments
│  [Shorter]     [More Detail]             │
│  [Regenerate]                            │
│                                          │
│  [✓ Accept]                              │  ← accept bar
│                                          │
└──────────────────────────────────────────┘
```

**Top-level controls** (always visible):
- **Interact** — triggers the main AI loop (see below)
- **Session Summary** — triggers or shows the session summary (see below)

**Response area** (appears after Interact):
- Persona header: name + a short note on how confidence was determined
- Streaming suggestion text
- Mood/style adjustment buttons (contextual to persona response)
- Regenerate: re-runs with same context, different random seed
- Accept

The response area is replaced on each new Interact press.

---

## The Interact Loop

Triggered when GM presses **Interact**.

### Step 1 — Assemble context

| Data | Source | Notes |
|---|---|---|
| Active scene name + GM notes | `game.scenes.active` | Scene description gives location clue |
| Recent session chat | Session journal (last N entries per setting) | Discord bot writes here |
| Session summary | Summary journal latest page | "Previously..." paragraph |
| Adventure lore | All journals in the configured adventure folder | Searched for location + NPC matches |

Location awareness is scene-based for now. The session journal serves as a breadcrumb trail — as the party moves through scenes the journal naturally records it, giving the AI a picture of where they've been and where they likely are.

### Step 2 — Infer situation

Claude is asked to:
1. Identify what the party is currently doing based on scene + recent chat
2. Identify the most likely NPC they are interacting with or about to interact with
3. Search the adventure lore for that NPC's description, role, location

### Step 3 — Resolve persona

- Look up `game.actors` for an Actor matching the inferred NPC name
- If found: read `actor.flags["beavers-voice-transcript"]` for personality data
- If not found: infer personality from adventure lore; Actor is created on Accept

### Step 4 — Generate suggestion

Claude produces a response as that persona, incorporating:
- Inferred or stored personality traits (dialect, mood, quirks)
- The NPC's relationship and history with the PCs (from actor flags)
- The current situation (what the party just did/said)

Response streams into the panel.

---

## Adjustment Buttons

These re-call Claude with a modifier appended to the original prompt. They do not reassemble context — context is cached from the last Interact press.

| Button | Modifier added to prompt |
|---|---|
| Less Grumpy | "Make the tone warmer and less hostile." |
| Friendlier | "Make the persona more openly welcoming." |
| Shorter | "Shorten to one sentence." |
| More Detail | "Add more colour — dialect, gesture, or detail." |
| Regenerate | Full re-call with same context, no modifier |

Buttons are shown only when a persona response is active. Different response types (future: plot hook, scene description) will have different button sets.

---

## Accept Flow

When GM presses **Accept**:

1. **Actor resolved:**
   - If Actor already exists: update `flags["beavers-voice-transcript"]` with any personality data Claude inferred during this exchange
   - If Actor does not exist: create a new NPC Actor with name, and write flags with inferred personality

2. **Actor flags schema:**
```ts
{
  dialect: string,          // e.g. "thick Scottish brogue, drops articles"
  mood: string,             // e.g. "grumpy but loyal"
  traits: string[],         // e.g. ["distrusts magic", "soft spot for children"]
  pcHistory: string,        // running short summary of encounters with PCs
}
```

3. **Session journal entry:**
   Append to the session journal a line such as:
   ```
   [AI · Aldric the Innkeeper] "Aye, I've seen stranger folk pass through. What's it to ya?"
   ```
   This feeds back into context on the next Interact press.

4. The response area stays visible so the GM can read it to players. It is cleared on the next Interact press.

---

## Session Summary

### Generation

Triggered by the **Session Summary** button or optionally on module startup (configurable).

Claude reads:
- All session journal pages that have not yet been summarized (tracked via a flag on each page, or by date range since last summary)
- The existing latest summary page (for continuity)

Claude produces a "Previously in the campaign..." paragraph — 150–250 words.

The summary is written as a new page in the summary journal (one page per session, dated).

### Usage in context

The most recent summary page is always prepended to the Claude context on every Interact call. This gives the AI persistent campaign memory without feeding the entire journal history on every call.

---

## New Files

```
foundry/src/
  apps/
    AiGmWindow.ts           # ApplicationV2 panel, all UI logic
  modules/
    ClaudeApi.ts            # stream(), assembleContext(), cacheContext()
    ContextBuilder.ts       # scene + journal + actor flags → prompt string
    PersonaResolver.ts      # infer NPC from context, read/write actor flags
    SessionSummary.ts       # generate and store session summaries
  __tests__/
    ContextBuilder.test.ts  # unit tests (see Testing section)
    PersonaResolver.test.ts
    SessionSummary.test.ts
```

`definitions.ts` — add new SETTINGS keys
`ApiSettings.ts` — register new settings with the existing form

---

## Testing

### Unit tests (automated, no Foundry required)

Use **vitest**. The three pure-logic modules — `ContextBuilder`, `PersonaResolver`, `SessionSummary` — take plain data in and return strings or objects. They can be tested by stubbing the `game.*` globals vitest provides via `vi.stubGlobal`.

What to cover per module:

**ContextBuilder**
- Assembles correct prompt sections from mocked scene, journal pages, and actor flags
- Truncates chat history to the configured message limit
- Handles missing/empty scene notes gracefully

**PersonaResolver**
- Reads actor flags and maps them to persona context string
- Returns a sensible default when no actor exists for the inferred NPC name
- `pcHistory` append: new summary is added, existing history is preserved

**SessionSummary**
- Correctly identifies which journals are past sessions (name starts with a date other than today)
- Skips journals already flagged `summarized: true`
- Skips the journal whose name starts with today's ISO date

Tooling to add in `foundry/package.json`:
```json
"devDependencies": {
  "vitest": "^2"
}
```

Run with:
```bash
npx vitest run
```

---

## Out of Scope (v1)

- Player-facing suggestions or player access to the panel
- Automatic triggering without GM pressing Interact
- Fine-grained token/room position awareness (future: parse scene notes for room names)
- Multiple simultaneous persona suggestions
- Voice output of accepted suggestions
- Compendium-based adventure data (journals only for now)

---

## Decisions

1. **Actor creation confirmation** — show a brief inline notification in the panel ("Actor created: Aldric the Innkeeper") after Accept. Non-blocking, fades after a few seconds.

2. **pcHistory** — Claude auto-generates a 1-sentence summary of the accepted exchange and appends it to `pcHistory` in the actor flags. GM does not need to do anything.

3. **Session summary on startup** — runs silently in the background when the module loads. Each session has its own journal (Discord bot creates one per session). The current session journal is never read or summarized — the entire journal is skipped. Only journals from previous sessions are processed. The module tracks which journals have already been captured using a flag (`flags["beavers-voice-transcript"].summarized: true`) set on the journal (not individual pages) after it is processed. On startup: find all session journals in the session folder without that flag, skip the current one, summarize the rest, write the summary page, mark those journals as captured.

**Current session detection:** the module owns the journal naming convention — `YYYY-MM-DD — Session`. The `writeSessionData` socket method (see API Changes below) generates this name internally. The AI identifies the current session journal by checking if the name starts with today's ISO date. All other journals in the session folder are past sessions.

---

## API Changes (Foundry module)

The generic `appendJournalPage` socket method stays as-is (general purpose). A new dedicated method is added for session data so the naming convention is enforced inside the module and callers never manage journal names or IDs.

### New: `writeSessionData`

```ts
writeSessionData(html: string, pageName?: string, maxPageBytes?: number): Promise<void>
```

- Reads the session folder from the `sessionJournalFolder` module setting — **no folder parameter**
- Throws a descriptive error if `sessionJournalFolder` is not configured
- Generates journal name as `YYYY-MM-DD — Session` (today's date, fixed format)
- Creates the folder if it doesn't exist
- Creates the journal if it doesn't exist for today
- Appends HTML to the page (same auto-rotation logic as `appendJournalPage`)
- `pageName` defaults to `"Transcript"`

Registered in `beavers-voice-transcript.ts` as a socket method alongside the existing ones.

The client and Discord bot must be updated to use this method — see `SPEC-session-api-migration.md` in the project root.