# Tasks: AI GM Window

Build order for `SPEC-ai-suggestions.md`. Each step is independently testable before moving to the next.

---

## Step 1 — Settings ✅

Two custom `ApplicationV2` settings apps, each opened via a **Configure** menu button. No `config: true` inline fields.

**`definitions.ts`**
- [x] Export `HOOKS.VOICE_TRANSCRIPT_ENABLED_CHANGED` hook name constant
- [x] Add `SETTINGS.VOICE_TRANSCRIPT_ENABLED`, `SETTINGS.AI_ASSISTANT_ENABLED`
- [x] Add all other setting keys: `sessionJournalFolder`, `claudeApiKey`, `claudeModel`, `sessionHistoryMessages`, `adventureJournalFolder`, `adventureIndexJournalName`
- [x] Export `SUMMARY_JOURNAL_NAME = 'AI-Summary'` as a fixed constant — summary journal always lives at `{sessionFolder}/AI-Summary`; not a setting

**`apps/settings/VoiceTranscriptSettingsApp.ts`**
- [x] Enable toggle, AI Assistant Connection section (FOUNDRY_USER, FOUNDRY_PASS, copy buttons, Regenerate), Session Folder
- [x] On save: fires `HOOKS.VOICE_TRANSCRIPT_ENABLED_CHANGED` when enabled state changes

**`apps/settings/AiAssistantSettingsApp.ts`**
- [x] Enable toggle, AI Tool section (API key, model), Session section (context size + VT warning notice), Adventure section (folder, index name)

**`apps/settings/Settings.ts`** (registration only — no app logic)
- [x] All settings registered as `config: false`; two `registerMenu` buttons only
- [x] `Settings.isConfigured()` returns true only when `aiAssistantEnabled && claudeApiKey` is set
- [x] `Settings.isVoiceTranscriptEnabled()` helper

**`beavers-ai-assistant.ts`**
- [x] `ready` hook: only calls `ensureAiAssistantUser()` + `SocketApi.start()` when `voiceTranscriptEnabled` is true
- [x] `Hooks.on(HOOKS.VOICE_TRANSCRIPT_ENABLED_CHANGED, ...)`: starts or stops socket and user at runtime without requiring reload
---

## Step 2 — Panel skeleton ✅

- [x] Create `AiGmWindow.ts` as a GM-only `ApplicationV2` window
- [x] Create Scene Control button / keybind setting to open the AiGmWindow (only GMs can see that button)
- [x] SceneControl button / keybind will notify an error when not (`ApiSettings.isConfigured()` is true (`aiAssistantEnabled && claudeApiKey` set)).
- [x] Renders top-level controls: **Session Summary** , **Interact** button visible only when `ApiSettings.isVoiceTranscriptEnabled()` is true
- [x] When Interact is hidden: show inline notice "Voice Transcript is not enabled — Interact requires a live session feed. Configure Voice Transcript to enable."
- [x] Empty response area below controls (placeholder)
- [x] Window closes with [X]
- [x] No AI logic yet — just layout and wiring

---

## Step 3 — Context assembly

- [ ] Create `ContextBuilder.ts`
- [ ] Reads active scene name + GM notes from `game.scenes.active`
- [ ] Reads last N session journal entries (N from `sessionHistoryMessages` setting)
- [ ] Reads latest page of `AI-Summary` journal in the session folder (path: `{sessionJournalFolder}/AI-Summary`)
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
- [ ] Write summary as a new dated page in the `AI-Summary` journal inside the session folder
- [ ] Mark processed journals with `summarized: true` flag
- [ ] **Session Summary** button in panel triggers or shows the latest summary
- [ ] Write unit tests in `SessionSummary.test.ts`

---

## Step 9 — Lore index

- [ ] Add **Build Lore Index** button to module settings
- [ ] On click: read all pages in `adventureJournalFolder`, send to Claude in a single call, produce structured index (Locations, NPCs, Factions — stable world content only, no plot state)
- [ ] Write index as a page in `adventureIndexJournalName`
- [ ] Add **Rebuild** button alongside Build — same flow, overwrites existing index
- [ ] Plug lore index into `ContextBuilder`: if index exists, include it whole; if not, fall back to keyword-scored raw pages (budget: ~4,000 tokens)
- [ ] If `adventureJournalFolder` is not configured, omit lore from context entirely

---

## Vitest setup (do before Step 3)

- [ ] Add `vitest` to `foundry/package.json` devDependencies
- [ ] Confirm `npx vitest run` works in the `foundry/` directory