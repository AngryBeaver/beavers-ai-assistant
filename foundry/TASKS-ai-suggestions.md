# Tasks: AI GM Window

Build order for `SPEC-ai-suggestions.md`. Each step is independently testable before moving to the next.

---

## Step 1 — Settings

- [ ] Add new setting keys to `definitions.ts`: `claudeApiKey`, `claudeModel`, `adventureJournalFolder`, `sessionJournalFolder`, `sessionHistoryMessages`, `summaryJournalName`, `loreIndexJournalName`
- [ ] Register settings in `ApiSettings.ts` with correct types, defaults, and secret handling for `claudeApiKey`
- [ ] Panel shows an inline prompt (not an error) when required settings (`claudeApiKey`, `sessionJournalFolder`) are missing

---

## Step 2 — Panel skeleton

- [ ] Create `AiGmWindow.ts` as a GM-only `ApplicationV2` window
- [ ] Renders top-level controls: **Interact** button and **Session Summary** button
- [ ] Empty response area below controls (placeholder)
- [ ] Window opens from a keybind or module button; closes with [X]
- [ ] No AI logic yet — just layout and wiring

---

## Step 3 — Context assembly

- [ ] Create `ContextBuilder.ts`
- [ ] Reads active scene name + GM notes from `game.scenes.active`
- [ ] Reads last N session journal entries (N from `sessionHistoryMessages` setting)
- [ ] Reads latest page of summary journal (`summaryJournalName`)
- [ ] Reads actor flags (`flags["beavers-ai-assistant"]`) for known actors
- [ ] Returns assembled prompt string
- [ ] Handles missing/empty sources gracefully (missing scene notes, no summary yet, no actors)
- [ ] Write unit tests in `ContextBuilder.test.ts` using `vi.stubGlobal` for `game.*`

---

## Step 4 — First Claude call: candidates

- [ ] Create `ClaudeApi.ts` with a `call()` method (non-streaming for now)
- [ ] On **Interact** press: assemble context via `ContextBuilder`, send to Claude, ask for 1–3 candidate interactions (NPC + what party is asking/telling)
- [ ] Replace response area with candidate selection list
- [ ] Show 1–3 numbered entries; GM clicks a button to confirm
- [ ] If only one candidate, still require GM confirmation before proceeding

---

## Step 5 — Persona resolution + streaming response

- [ ] Create `PersonaResolver.ts`
- [ ] Look up `game.actors` for actor matching confirmed NPC name
- [ ] If found: read `flags["beavers-ai-assistant"]` for personality data
- [ ] If not found: infer personality from lore context; actor created later on Accept
- [ ] Add `stream()` to `ClaudeApi.ts`
- [ ] On GM confirmation: call Claude with resolved persona + confirmed interaction, stream response into panel
- [ ] Show persona header (NPC name + confidence note) above streaming text
- [ ] Show adjustment buttons and **Accept** once streaming completes

---

## Step 6 — Accept flow

- [ ] If actor exists: update `flags["beavers-ai-assistant"]` with any newly inferred personality data
- [ ] If actor does not exist: create new NPC Actor with name, write flags
- [ ] Show inline notification: "Actor created: [name]" — non-blocking, fades after a few seconds
- [ ] Append to `pcHistory`: session journal name + inferred interaction + condensed accepted response
- [ ] Write accepted suggestion to session journal via `writeSessionData` with `[AI suggestion | ActorName]` marker and actor ID
- [ ] Response area stays visible after Accept; cleared on next Interact press

---

## Step 7 — Adjustment buttons

- [ ] Show adjustment buttons only when a persona response is active
- [ ] Cache context from the last Interact press (do not reassemble)
- [ ] Wire each button to re-call Claude with its modifier appended:
  - **colder** — more hostile tone
  - **warmer** — more openly welcoming
  - **shorter** — shorter, less detail
  - **details** — more colour, dialect, gesture
  - **info** — increase NPC awareness by one degree
  - **trash** — decrease NPC awareness by one degree; at lowest, mildly misleading
  - **Regenerate** — full re-call, same context, no modifier
- [ ] Streaming response replaces current suggestion in place

---

## Step 8 — Session summary

- [ ] Create `SessionSummary.ts`
- [ ] On module startup: find all journals in `sessionJournalFolder` without `flags["beavers-ai-assistant"].summarized: true`, skip the journal whose name starts with today's ISO date, summarise the rest
- [ ] Write summary as a new dated page in `summaryJournalName`
- [ ] Mark processed journals with `summarized: true` flag
- [ ] **Session Summary** button in panel triggers or shows the latest summary
- [ ] Write unit tests in `SessionSummary.test.ts`

---

## Step 9 — Lore index

- [ ] Add **Build Lore Index** button to module settings
- [ ] On click: read all pages in `adventureJournalFolder`, send to Claude in a single call, produce structured index (Locations, NPCs, Factions — stable world content only, no plot state)
- [ ] Write index as a page in `loreIndexJournalName`
- [ ] Add **Rebuild** button alongside Build — same flow, overwrites existing index
- [ ] Plug lore index into `ContextBuilder`: if index exists, include it whole; if not, fall back to keyword-scored raw pages (budget: ~4,000 tokens)
- [ ] If `adventureJournalFolder` is not configured, omit lore from context entirely

---

## Vitest setup (do before Step 3)

- [ ] Add `vitest` to `foundry/package.json` devDependencies
- [ ] Confirm `npx vitest run` works in the `foundry/` directory