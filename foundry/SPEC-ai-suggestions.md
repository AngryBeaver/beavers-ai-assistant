# Spec: AI GM Window

## Goal

A GM-only panel that acts as a narrative co-pilot. 
The GM presses one button and the AI reads the current game state, infers who the party is likely interacting with,
and suggests a persona-accurate response from that NPC. 
The GM uses the suggestion as a reference when speaking to their players that feeds back to the session journal.
Accepted suggestions are stored back into the world (actor flags) so the AI builds a persistent picture of the campaign over time.

---

## Settings (configured before use)

Registered in `ApiSettings.ts`. If required settings are missing the panel shows an inline prompt to configure them before any AI call is made.

| Key | Type | Default | Description |
|---|---|---|---|
| `claudeApiKey` | String (secret) | — | Anthropic API key. Required. |
| `claudeModel` | String | `claude-sonnet-4-6` | Model ID. |
| `adventureJournalFolder` | String | — | Folder containing adventure/lore journals. Optional — see Adventure Journal Types below. |
| `loreIndexJournalName` | String | `AI Lore Index` | Journal where the pre-built lore index is stored. Only used when `adventureJournalFolder` is configured. |
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
│  [colder] [warmer] [shorter] [details]   │  ← persona mood adjustments
│  [info]   [trash]                        │
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

| Data | Source | Notes                                               |
|---|---|-----------------------------------------------------|
| Active scene name + GM notes | `game.scenes.active` | Scene description gives location clue               |
| Recent session chat | Session journal (last N entries per setting) | Discord bot writes here                             |
| Session summary | Summary journal latest page | "Previously..." paragraph                           |
| Adventure lore | All journals in the configured adventure folder | Searched for location + NPC matches + Story Content |

Location awareness is scene-based for now.
Session Summary identifies where they've been roughly at the start of this session and what they have already done.
Session chat serves as a breadcrumb trail — as the party moves through scenes the journal naturally records it,
giving the AI a picture of where they've been and where they likely are.

#### Adventure journal types

There are two distinct use cases for `adventureJournalFolder`, and the module behaves differently for each:

**Pre-written adventure** (e.g. a published module loaded as journals)
- The full adventure exists before play begins — NPCs, locations, factions are all written down
- The lore index is the right tool here: a one-time Claude pass produces a compact structured summary covering stable world content only
- The session summary tracks *where the party currently is* in the story; the lore index gives the AI the stable world map

**Self-made / emergent adventure**
- Journals are sparse forward-looking sketches; most of what happened is already in session journals
- `adventureJournalFolder` can be left unconfigured — the module degrades gracefully
- Session summary + actor flags alone are sufficient for emergent campaigns

**Graceful degradation without adventure journals:**
If `adventureJournalFolder` is not set, the lore column is omitted from context entirely. The AI works from scene notes, session chat, session summary, and actor flags alone.

#### Lore index

For pre-written adventures, a lore index is built once and reused on every Interact call. It contains only **stable world content** — what exists in the adventure as written. Current plot state, what the party has done, and where events stand belong in the session summary, not the index.

**Structure stored in `loreIndexJournalName`:**
```
## Locations
- The Rusty Flagon (inn, Millhaven) — run by Aldric; common gathering spot for travellers
- Blackroot Farm — outlying farm north of Millhaven; owned by Jorin

## NPCs
- Aldric the Innkeeper — gruff, loyal, knows local gossip; soft spot for travellers in trouble
- Mira the Barmaid — Aldric's niece, curious and talkative
- Jorin the Farmer — hardworking, distrusts outsiders

## Factions & Groups
- Red Tooth Goblins — tribal raiders from the Ashwood; led by Skrix, motivated by hunger and fear
- The Merchant Guild — controls trade in Millhaven; politically influential
```

**Building the index:**
- Triggered by a **Build Lore Index** button in the module settings
- Claude reads all pages in `adventureJournalFolder` in a single call and produces the structured index
- The result is written as a page in `loreIndexJournalName`
- A **Rebuild** button re-runs the same process to pick up edits to the adventure journals
- One-time cost: a 50,000-word adventure ≈ ~$0.20 to index

**Usage in Interact:**
The full lore index (~1,000–2,000 tokens) is included in context on every call when `adventureJournalFolder` is configured. No per-call scoring or filtering needed — the index is compact enough to include whole.

#### Lore filtering strategy (fallback — no index built)

If `adventureJournalFolder` is configured but no lore index exists yet, the module falls back to keyword scoring until the GM builds the index.

Pages are scored and selected to stay within a token budget (~4,000 tokens of lore per call).

**Scoring (each journal page gets a relevance score):**
1. Extract keywords from: active scene name, last 10 session chat entries, and any NPC names already in `game.actors`
2. Count keyword hits per journal page (case-insensitive, partial word match)
3. Pages with zero hits are excluded

**Selection:**
- Sort pages by score descending
- Include pages in order until the lore budget is reached
- If the confirmed NPC name (from Step 2) matches text in a page, that page is always included regardless of budget — prepended before the scored list

**Budget:**
- Default lore budget: 4,000 tokens (~3,000 words)
- Estimation: `Math.ceil(text.length / 4)` characters-to-tokens — no tokenizer required

**Consequence:** if journals are well-structured (one page per location or NPC), filtering is effective. Large undivided journals may hit the budget cap early — GMs should build the lore index or keep journals paginated by topic.

### Step 2 — Infer situation

Claude is asked to:
1. Identify what the party is currently doing based on scene + recent chat
2. Return 1–3 candidate interactions the party is most likely having, ranked by confidence. Each candidate includes **who** the NPC is and **what** the party appears to be asking or telling them.

The panel replaces the response area with the candidate list:

```
┌──────────────────────────────────────────────────┐
│ What's happening?                                │
│                                                  │
│  1. Aldric the Innkeeper — asking about a room   │
│  2. Aldric the Innkeeper — asking about rumours  │
│  3. Mira the Barmaid — ordering drinks           │
│                                                  │
│  [1] [2] [3]                                     │  ← GM clicks to confirm
└──────────────────────────────────────────────────┘
```

If the AI is highly confident there is only one likely interaction, a single entry is shown — the GM still confirms it before the flow continues.

The GM clicks a button to confirm their choice. Only then does the flow continue to Step 3.

### Step 3 — Resolve persona

- Look up `game.actors` for an Actor matching the inferred NPC name
- If found: read `actor.flags["beavers-ai-assistant"]` for personality data
- If not found: infer personality from adventure lore; Actor is created on Accept
  - Search the adventure lore for what the NPC might have experienced based on the adventure if any
  - Search the session summary for what had happened and what the NPC might have been through.

### Step 4 — Generate suggestion

Claude produces a response as that persona, incorporating:
- Inferred or stored personality traits (dialect, mood, quirks)
- The NPC's relationship and history with the PCs (from actor flags)
- The current situation (what the party just did/said)

Response streams into the panel.

---

## Adjustment Buttons

These re-call Claude with a modifier appended to the original prompt. They do not reassemble context — context is cached from the last Interact press.

| Button  | Modifier added to prompt                                                                                                                                  |
|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| colder  | "Make the tone more hostile."                                                                                                                             |
| warmer  | "Make the persona more openly welcoming."                                                                                                                 |
| shorter | "make it shorter, less details"                                                                                                                           |
| details | "Add more colour — dialect, gesture, or detail."                                                                                                          |
| info    | "Increase the NPC's awareness of current events by one degree — reveal a slightly more specific or accurate detail."                                      |
| trash   | "Decrease the NPC's awareness by one degree — make them less informed, and at the lowest level have them offer something unrelated or mildly misleading." |

Buttons are shown only when a persona response is active. Different response types (future: plot hook, scene description) will have different button sets.

---

## Accept Flow

When GM presses **Accept**:

1. **Actor resolved:**
   - If Actor already exists: update `flags["beavers-ai-assistant"]` with any personality data Claude inferred during this exchange
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

3. **pcHistory entry:**
   Append a one-sentence summary of this exchange, including:
   - The inferred interaction selected in Step 2 (who the NPC was + what the party was asking/telling them)
   - A condensed version of the accepted response
   ```
   [2024-03-15 — Session] Aldric the Innkeeper, asked about a room: "Aye, I've a spare room upstairs, but it'll cost ya two silver."
   ```
   This feeds back into context on the next Interact press so the AI knows what has already been said.

4. **Session journal — written with ai-suggestion flag:**
   The accepted suggestion is written to the session journal via `writeSessionData`, marked with a special flag so it is distinguishable from real GM speech:
   ```
   [AI suggestion | Aldric the Innkeeper] "Aye, I've a spare room upstairs, but it'll cost ya two silver."
   ```
   The entry includes the actor name (and actor ID if the actor was resolved or just created). The Discord bot will later capture what the GM actually said — that entry has no special flag and represents what really happened. On the next Interact press the AI sees both entries and treats the `ai-suggestion` entry as "proposed, not confirmed" — the gap between suggestion and actual GM speech is itself useful context for inferring what transpired.

5. The response area stays visible so the GM can read it to players. It is cleared on the next Interact press.

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

3. **Session summary on startup** — runs silently in the background when the module loads. Each session has its own journal (Discord bot creates one per session). The current session journal is never read or summarized — the entire journal is skipped. Only journals from previous sessions are processed. The module tracks which journals have already been captured using a flag (`flags["beavers-ai-assistant"].summarized: true`) set on the journal (not individual pages) after it is processed. On startup: find all session journals in the session folder without that flag, skip the current one, summarize the rest, write the summary page, mark those journals as captured.

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

Registered in `beavers-ai-assistant.ts` as a socket method alongside the existing ones.

The client and Discord bot must be updated to use this method — see `SPEC-session-api-migration.md` in the project root.