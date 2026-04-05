# Tasks: Lore Index Redesign

Redesign `LoreIndexBuilder` from a single monolithic AI call into a multi-phase, multi-page
architecture. The result is a set of focused journal pages sized to be passed selectively as
context during an Interact call.

---

## Background

Current state: one AI call dumps the entire adventure into a single journal page. This breaks on
large modules (token limits), wastes context on every Interact call, and loses heading structure.

### Target index structure

Adventures are organised as: **Adventure → Chapters (arcs) → Scenes → Sublocations/rooms**.
The index mirrors this with three tiers of pages, each ~4 096 tokens:

| Page | Content |
|---|---|
| `Overview` | Global NPCs, factions, world context. Neutral — no visited/unvisited framing. |
| `Chapter: <name>` | Arc summary. All scenes described neutrally — what they contain, who is in them, what the stakes are. |
| `Scene: <name>` | Full detail — sublocations, NPCs present, what happens. Optional map layout section appended by enrichment pass. |

### Context assembly per Interact call

```
Overview        — global world context (neutral)
Chapter         — arc summary of current chapter (neutral)
Scene           — current scene full detail (neutral)
Session summary — source of truth for what PCs have actually done
```

The visited/unvisited framing is **not baked into the index**. The index is static and neutral.
Call 1 (Situation Assessment) combines the chapter summary with the session summary at runtime
and the AI infers which scenes are done vs not yet visited from that combination.

### Revised Interact flow (two AI calls)

**Call 1 — Situation Assessment**
Input: current chapter summary, recent session journal entries, session summary, Foundry active
scene name as a hint.
Output (structured, single response):
- Best-guess current scene + confidence
- Brief recap: which scenes are done, which are not, what happened so far
- 1–3 ranked candidate NPC interactions (who + what the party is asking/telling them)

GM sees one confirmation card and confirms (or adjusts) scene + NPC in a single step.

**Call 2 — Persona Response**
Input: chapter summary, scene summary, situation recap from Call 1, confirmed NPC + topic.
Output: streaming persona response → adjustment buttons → Accept.

GM's only mandatory pre-session input: select the current chapter from a list derived from the
index. The AI proposes the current scene from the session journal; GM corrects only if wrong.

### Model roles

Only the **Interact** model is stored persistently in settings. Indexing and vision models are
chosen inside the wizard each run — no stored preference.

| Role | Stored | When used |
|---|---|---|
| Interact | Yes — provider + model | Every NPC response, every session |
| Index & Summarise | No — chosen in wizard | Lore build (one-off or chapter rebuild) |
| Map Vision | No — chosen in wizard | Map enrichment pass (optional) |

---

## Settings restructure — AI Assistant settings app

Sections appear conditionally based on what is enabled/configured:

```
AI Assistant settings app
├── [Enable AI Assistant]
│
├── AI Interact  (always shown when enabled)
│   ├── Provider selector (Claude / LocalAI)
│   ├── Claude: API key, model
│   └── LocalAI: URL, active model, install model, refresh
│
├── Session Recap  (shown only when Voice Transcript is enabled)
│   └── History message count
│
└── Adventure Lore
    └── [Open Lore Index Wizard]  → opens LoreIndexWizard
```

Adventure folder selection and max output tokens are part of the wizard, not stored settings.
The button label may reflect state (no index / index exists) but the wizard handles everything.

---

## Phase 0 — Lore Index Wizard (new ApplicationV2)

**Files:** `foundry/src/apps/LoreIndexWizard.ts` + `templates/wizard/*.hbs`

The wizard is the single entry point for all lore index operations: building, rebuilding chapters,
and enriching scenes with map data. It is incremental and resumable — skipping a step always
preserves existing data.

Indexing and vision model choices are ephemeral (per-run, not stored in settings).

**Wizard step order:**

1. **location** — select adventure folder/journal; index status shown inline
2. **mixed** — (only if folder contains both subfolders and journals) choose which to treat as chapters
3. **chapters** — confirm and reorder chapter candidates
4. **model** — token/cost estimate (from confirmed non-skipped chapters) + AI provider + model selection → Start Indexing

There is no separate status screen. Index status is a badge on the location step.
Token/cost estimate is on the model step, not the location step, and reflects only the non-skipped chapters.

---

### Task 0.1 — Wizard shell and state detection ✓ DONE

Create `LoreIndexWizard.ts` as an `ApplicationV2`. Step state is held in instance variables.
Navigation uses `_goToStep(name)` which re-renders the content area without closing the window.

**Step: Location selection (always first)**

Show a dropdown of all first-level items visible in Foundry — both folders and journals — so the
GM can point the wizard at their adventure content regardless of how it is organised. Display index
status as an inline badge below the dropdown — detected immediately when a location is chosen
(or when Continue is clicked):

```
Where is your adventure content?
[ dropdown: all root-level folders and journals ]

ℹ No lore index found for this adventure.      ← shown inline, not a separate screen
  (or) ✓ A lore index already exists.

[Continue]
```

Index status states:

| State | Badge shown |
|---|---|
| No index | ℹ info badge — "No lore index found. Continuing will build one." |
| Index exists | ✓ success badge — "A lore index exists. Continuing will let you rebuild or enrich." |

The selected item (folder or journal) is stored in wizard state. Clicking Continue always proceeds
to chapter detection — the status badge is informational only.

---

### Task 0.2 — Token / cost estimate (moved to model step)

Token and cost estimate is displayed on the **model step** (Task 0.4), not on a dedicated status
screen. It is calculated from the non-skipped chapters confirmed in the chapters step:

- Estimated input tokens: sum of `chapter.tokens` for all chapters where `role !== 'skip'`
- Claude Sonnet cost: input tokens × $3/1M (approximate, input only — labelled as such)
- LocalAI: Free

The separate `status` wizard step and its template are removed. The `status` PART is removed from
`LoreIndexWizard.PARTS`. The `_indexStatus` / `indexStatus` state is retained as a field but
displayed inline on the location step.

---

### Task 0.3 — Chapter detection and GM confirmation ✓ DONE

Chapter detection rules depend on what the GM selected in Step 0.1:

**If a journal was selected:**
- Chapters can only be headers within the journal's pages (`<h1>` or `<h2>` tags, preserved as
  `###`/`####` by `stripHtml`)
- Each distinct top-level heading group = one chapter candidate

**If a folder was selected:**
- Inspect folder contents:
  - Contains only subfolders → each subfolder = one chapter candidate
  - Contains only journals → each journal = one chapter candidate
  - Contains both subfolders and journals → both are candidates; wizard shows them grouped and
    lets the GM decide which to treat as chapters:
    ```
    Found mixed content — which should be chapters?
      Folders: Chapter 1, Chapter 2, Appendix
      Journals: Introduction, Credits
    [Use folders as chapters]  [Use journals as chapters]  [Use both]
    ```
- If folder has no subfolders and no journals with detectable heading structure: treat entire
  folder content as a single chapter

Show detected chapters to GM for confirmation before indexing begins:

```
Chapters found — confirm before indexing:
  ✓  Chapter 1: The Road to Millhaven
  ✓  Chapter 2: The Goblin Den
  ✓  Appendix: Bestiary
  (untick any you want to skip entirely)
[Start Indexing]
```

GM can untick chapters to exclude them permanently from this run.

**Overview source — first folder heuristic:**

Many published adventures place introductory material (world background, faction overview,
GM notes, read-aloud context) in the first folder or first journal, separate from the playable
chapters. The wizard detects this and flags it:

```
Possible introduction/background material found:
  → "Chapter 0: Introduction" (first folder, no scene structure detected)
  Use as source for the Overview page rather than indexing as a chapter?
  [Yes — use as overview source]  [No — index it as a chapter]  [Skip entirely]
```

If the GM confirms it as overview source, this folder's content is fed into the Overview
generation call instead of producing a `Chapter:` page. If the adventure has no such folder,
the Overview is generated from all chapter summaries as normal.

---

### Task 0.4 — Estimate + model selection step

This is the fourth and final wizard step before indexing begins. It combines the token/cost
estimate with AI provider and model selection on a single screen.

**Screen layout (top to bottom):**

```
── Input estimate ──────────────────────────────
  Tokens (approx.)   12,400
  Claude Sonnet      ~$0.04  (approx. input cost — output shown per chapter)
  LocalAI            Free
────────────────────────────────────────────────

Provider   [● Claude]  [○ LocalAI]

── Claude branch (shown when Claude selected) ───
  API key: ✓ configured
  Hint: Reliable for large structured output. Costs apply — estimate shown above.

── LocalAI branch (shown when LocalAI selected) ─
  Model   [ dropdown of available models ▾ ]  [⟳ Refresh]
  Hint text depends on context:
    Indexing:  "Qwen3.5-9B recommended — 262k context, handles full adventure modules."
    Vision:    "Use a vision-capable model. Qwen3-VL-8B-Instruct recommended."
────────────────────────────────────────────────

[← Back]                          [Start Indexing →]
```

**Token/cost estimate**

Calculated from `sum of chapter.tokens` for all chapters where `role !== 'skip'`.
Uses the same formula as before: input tokens × $3/1M for Claude Sonnet, Free for LocalAI.

**Provider selector**

Radio toggle between Claude and LocalAI. Default to whichever provider is currently configured
in the Interact settings (`SETTINGS.AI_PROVIDER`).

**Claude branch**

Show API key status: configured (✓) or missing (✗ — warn but do not block).
Static hint text.

**LocalAI branch**

Fetch `GET /v1/models` once when the LocalAI branch is first shown (or on Refresh).
Display results in a dropdown. Show a Refresh button (⟳) next to the dropdown to re-fetch.
No polling. No loading indicator. Model management is done externally via the LocalAI UI at
`http://localhost:8080/app/models` — the wizard only reflects what is already available.

If the fetch fails or returns an empty list, show: "No models available. Load models via the
LocalAI UI before continuing." — and disable Start Indexing.

**Start Indexing button**

Disabled when LocalAI is selected and no model is chosen.
Always enabled when Claude is selected (even if API key is missing — error surfaces at call time).

**Reuse on vision step**

The same step is shown before the map enrichment pass (Task 0.6) with `context = 'vision'`.
The hint text and recommended model label differ based on context. No other differences.

---

### Task 0.5 — Chapter-by-chapter indexing pass ✓ DONE

After model is confirmed ready, process chapters one at a time.

For each chapter in the confirmed list:

**If chapter page already exists in the index:**
```
Chapter 2: The Goblin Den — already indexed.
[Rebuild this chapter]  [Skip → keep existing]
```

**If not yet indexed (or GM chose Rebuild):**
Show live log while indexing:
```
→ Indexing Chapter 2: The Goblin Den…
  ✓ Scene: The Cave Entrance
  ✓ Scene: The Throne Room
  ✓ Chapter summary written.
```

After each chapter completes, prompt for next:
```
Chapter 2 done. Next: Chapter 3 — The Sunken Temple.
[Continue]  [Skip this chapter]  [Stop here]
```

[Stop here] exits the indexing pass early. Chapters already indexed are kept. Overview is not
generated until all (non-skipped) chapters are done.

Before indexing each chapter, show its estimated input token count:
```
Chapter 2: The Goblin Den — ~3 400 input tokens
[Index this chapter]  [Skip]  [Stop for now]
```

After all chapters: generate Overview page → show summary:
```
✓ Index complete — 3 chapters, 14 scenes.
[Continue to Map Enrichment]  [Finish]
```

The live log is driven by progress events emitted by `LoreIndexBuilder.indexChapter()`.
The wizard appends each event to the log element directly without a full re-render.
The improved log format (streaming, per-scene writes, area identifiers) is defined in Task 1.2.

---

### Task 0.6 — Scene-by-scene map enrichment pass ✓ DONE

Triggered from the wizard (either after indexing or standalone when index already exists).

**Step A — Select vision model** (Task 0.4 component, vision context)

**Step B — Scene-by-scene loop**

Wizard collects all scenes across all indexed chapters, then iterates:

For each scene:
```
Scene: The Throne Room  (Chapter 2: The Goblin Den)

Candidate images found near this scene:
  [thumbnail] map-goblin-throne.jpg   [✓ Use]
  [thumbnail] art-goblin-king.jpg     [  Skip]

(No image — skip this scene)
```

If the scene already has a `#### Connections` section:
```
Scene: The Cave Entrance — map data exists.
  Current: map-cave-entrance.jpg (indexed 2025-03-10)
  [Replace with new selection]  [Add to existing]  [Skip — keep current]
```

After GM makes a choice:
- [Use] / [Replace] / [Add] → run vision AI call (see Task 2.3) → append/replace
  `#### Connections` in `Scene: <name>` page → show result inline → move to next scene
- [Skip] → move to next scene, existing data untouched

Progress shown as "Scene 4 of 14". GM can [Stop enrichment] at any point; scenes already
enriched are kept.

After all scenes: done summary → [Finish]

---

### Task 0.7 — Wizard entry from settings app ✓ DONE

In `AiAssistantSettingsApp`, replace the current Build Lore Index button with:

```
[Build Lore Index]        ← if no index exists
[Lore Index ▾]            ← if index exists (split button or two buttons)
  [Rebuild chapters]
  [Update map enrichments]
```

All options open `LoreIndexWizard` — the wizard's Task 0.1 state detection handles routing to
the correct starting screen.

No token budget setting needed — indexing is chapter-by-chapter with a hardcoded 32 768 output limit per chapter call.

---

## Phase 1 — Text Index (core builder logic)

### Task 1.1 — ~~Output token budget~~ NOT NEEDED

Max output tokens is configured ephemerally in the wizard (Task 0.1 location/config screen)
and passed directly to `LoreIndexBuilder`. No stored setting required.
All Task 1.1 code changes have been reverted.

---

### Task 1.2 — Redesign index output to three-tier multi-page (per-chapter calls)

**Files:** `LoreIndexBuilder.ts`, `JournalApi.ts`

Add `indexChapter(chapterContent: string, chapterName: string): Promise<void>` and
`indexOverview(overviewSource?: string): Promise<void>` methods. Each call handles one chapter
and writes its pages immediately on completion.

One AI call per chapter produces Chapter + Scene pages using sentinel delimiters for splitting:

```
---CHAPTER: The Road to Millhaven---
...chapter summary...
---SCENE: The Road Ambush---
...scene detail...
---SCENE: The Innkeeper---
...scene detail...
```

The builder splits on sentinels and writes each block as a separate journal page.
Per-chapter output is naturally bounded (5–15 scenes × ~500 tokens) — no configurable
max tokens needed. Use a generous hardcoded per-chapter output limit of 32 768.

The overview call takes already-written chapter summary pages as input (small) plus optional
intro/background source content, and writes the `Overview` page.

Pages are written incrementally so chapters already indexed survive if the wizard is stopped.

| Page name | Content |
|---|---|
| `Overview` | NPC master index + factions + world context. Written last from chapter summaries. |
| `Chapter: <name>` | Structured: overview, scene list, narrative flow, NPC knowledge delta. |
| `Scene: <name>` | Full detail, areas with identifiers preserved. Connections appended by enrichment. |

---

**Chapter page format**

The chapter page has four fixed sections. The AI prompt must produce them in this order:

```markdown
## Overview
What this chapter is about — arc, theme, central tension. 2–4 sentences.

## Scenes
- **Scene: <name>** — one sentence: what happens and why it matters to the arc.
- **Scene: <name>** — ...
(one bullet per scene, in play order)

## Narrative Flow
How scenes connect. Which scenes are optional. What gates what. What information a scene
unlocks for the next. Written as short prose or a brief list — not a flowchart.

## NPCs
| NPC | Role in chapter | New information revealed here |
|---|---|---|
| Gundren Rockseeker | Missing patron | Captured by Klarg; being delivered to "the Spider" |
| Klarg | Bugbear chieftain | Commands the hideout; acts on orders from King Grol at Cragmaw Castle |
| Sildar Hallwinter | Captive ally | Lord's Alliance agent; knows Gundren had a map to Wave Echo Cave |
| The Spider | Unseen villain | Name only; pulling the strings behind goblin activity in the region |
```

The **NPCs** table records only what is **new in this chapter** — the delta, not the full
biography. The same NPC appears in multiple chapter tables as knowledge accumulates.

This is the structure the Interact AI uses for NPC knowledge stacking (see Task 1.4).

---

**Overview page format**

The Overview page is a master index — it does not duplicate NPC detail that lives in chapter
pages. It anchors the global picture and points to where detail lives.

```markdown
## World Context
Brief setting introduction — geography, factions at play, the adventure's central conflict.

## Factions
| Faction | Goal | Key figure |
|---|---|---|
| The Zhentarim | Control trade routes | The Spider (identity unknown) |
| Lord's Alliance | Stability in the region | Sildar Hallwinter |

## NPC Index
| NPC | Brief description | Appears in |
|---|---|---|
| Gundren Rockseeker | Dwarf prospector, quest giver | Chapter 1, Chapter 3 |
| Sildar Hallwinter | Lord's Alliance agent | Chapter 1, Chapter 2 |
| The Spider | Main villain, identity hidden | Chapter 1, 2, 3, 4 |
| Klarg | Bugbear chieftain, Cragmaw goblin | Chapter 1 |

The "Appears in" column tells the Interact AI which chapter NPC tables to stack when
building a knowledge profile for a given NPC.
```

**Area identifier preservation in Scene pages**

Many published adventures describe scene locations as numbered or lettered areas (e.g.,
"1. Guard Post", "2. The Armoury", "A. Hidden Alcove"). These identifiers are the anchor
between the text description and the map — the same numbers/letters that appear printed on
the map image.

The AI prompt for scene indexing must:
- Detect and preserve all area identifiers exactly as they appear in the source (`1.`, `2a.`,
  `A.`, `B.`, etc.) — never renumber or strip them.
- Output each area as a labelled sub-entry within the scene block:

```
---SCENE: The Goblin Den---
Summary of the scene and what is at stake.

NPCs: Gorlag the Chief (area 3), 4× goblin guards (areas 1–2)

#### Areas
**1. Guard Post** — Two goblins on watch. Arrow slits cover the entrance tunnel.
**2. Armoury** — Racks of crude spears and a locked chest.
**3. Throne Room** — Gorlag sits here. Double doors to area 4.
**4. Escape Tunnel** — Narrow crawl-space, exits to the forest (area outside scope).
```

If the source text uses only prose with no explicit identifiers, the AI writes area
descriptions as a flat prose paragraph instead — no invented labels.

The area block is the input that Task 2.3 (vision enrichment) will anchor its spatial
analysis to. When a `#### Connections` section is appended (Task 2.3) it references these
exact identifiers so the combined page is self-consistent.

---

**Streaming and incremental page writes**

`indexChapter()` uses `stream()` rather than `call()`. As tokens arrive, the builder parses
sentinel patterns and writes pages as soon as each block closes:

| Pattern detected in stream | Action |
|---|---|
| `---CHAPTER: <name>---` | Start accumulating chapter block |
| `---SCENE: <name>---` | Flush + write previous scene page (if any); start new scene block |
| `**<id> — <area name>**` | Emit progress event: `{ type: 'area', id, name }` |
| End of stream | Flush + write final scene page; write chapter summary page |

The wizard (Task 0.5-b) subscribes to progress events and updates the live log. Pages are
written incrementally — partial progress survives if the stream is interrupted.

**`SceneArea` type:**

```ts
type SceneArea = {
  areaId: string;       // "A", "7", "B2"; empty string when source has no labels
  name?: string;        // "Guard Nook"
  description: string;
  npcs?: string[];
  features?: string[];
};
```

Not stored as JSON — serialised into the `#### Areas` markdown block and re-parsed on read.

---

### Task 1.3 — ~~Multi-call fallback~~ NOT NEEDED

Per-chapter calls are now the only approach — not a fallback. Removed.

---

### Task 1.4 — Update ContextBuilder to read three-tier index

**File:** `foundry/src/modules/ContextBuilder.ts`

| GM selection state | Pages loaded |
|---|---|
| Chapter + Scene selected | `Overview` + `Chapter: <name>` + `Scene: <name>` |
| Chapter only | `Overview` + `Chapter: <name>` |
| Nothing selected | `Overview` only |
| No index built | keyword-scored raw pages (current fallback) |

The lore index is static and neutral — it has no concept of completed chapters or visited
scenes. ContextBuilder only selects which pages to pass; it does not filter or annotate them.

---

### Task 1.5 — Chapter selector in GM panel

**File:** `AiGmWindow.ts`, `ai-gm-window.hbs`

Chapter dropdown populated from `Chapter: *` pages in the lore index. GM selects once per
session; cached. Scene is proposed by Call 1 (Situation Assessment), not selected manually.

---

### Task 1.6 — Revised Interact flow (two-call)

**File:** `AiGmWindow.ts`

**Call 1 — Situation Assessment:**
Input: current chapter page + session journal entries + session summary + active Foundry
scene name as a hint.
Output (structured): best-guess current scene + confidence, brief recap of what has happened,
1–3 ranked NPC interaction candidates.
GM sees one confirmation card and confirms (or adjusts) scene + NPC.

**Call 2 — Persona Response:**
Input: chapter page + scene page + situation recap from Call 1 + confirmed NPC + topic.
Output: streaming persona response → adjustment buttons → Accept.

Context from Call 1 is cached for adjustment button re-calls.

**NPC knowledge — resolved by the AI, not by ContextBuilder**

The chapter page NPC table records what new information about each NPC was revealed in that
chapter. Multiple chapter pages for the same NPC stack into a timeline of accumulating
knowledge. The AI receives all of this as part of the lore index pages plus the current
state (session summary), and from that combination it determines:
- What the party currently knows about an NPC
- What they do not yet know (information in future chapters)
- How the NPC would behave given that knowledge gap

The lore index does not filter or annotate itself based on session progress. The AI does
the reasoning. If at a later point the current state provides enough signal to pre-filter
which chapter NPC entries are relevant, that can be done before passing context — but the
index itself stays static.

---

## Phase 2 — Map Enrichment (wizard-driven, no persistent settings)

### Task 2.1 — Add vision support to AiService interface

**Files:** `foundry/src/services/AiService.ts`, `ClaudeService.ts`, `LocalAiService.ts`

```ts
callWithImage?(
  systemPrompt: string,
  userPrompt: string,
  imageUrl: string,
  options?: CallOptions,
): Promise<string>;
```

`ClaudeService`: image content block (base64 or URL).
`LocalAiService`: vision model ID passed as a `CallOptions` parameter from the wizard (not stored
in settings). Throws a descriptive error if called without a model.

---

### Task 2.2 — Collect candidate map images per scene

**File:** `LoreIndexBuilder.ts`

Scan journal pages for embedded images (`<img src="...">` and image-type pages).
Group by scene via proximity to scene headings in source content.
Return `{ sceneName: string; imageUrls: string[] }[]`.

---

### Task 2.3 — Vision AI map parsing

**File:** `LoreIndexBuilder.ts` (`_enrichSceneWithMap`)

For each confirmed map image, call `callWithImage()` with:
- The map image.
- The existing `#### Areas` block from the scene page (if present), passed in the user
  prompt so the AI can match its output labels to the text-derived identifiers.

The system prompt instructs the model to produce a compact adjacency list anchored to the
same area identifiers. Connection types to recognise (mapped to the `AreaConnection.type`
union): `open`, `door`, `hidden-door`, `ladder`, `stairs`, `secret-passage`.
Add a `notes` value for anything that needs qualification (one-way, locked, perception DC,
key location).

**`AreaConnection` type (for `LoreIndexBuilder.ts`):**

```ts
type AreaConnection = {
  fromAreaId: string;   // "A"
  toAreaId: string;     // "B"
  type: "open" | "door" | "hidden-door" | "ladder" | "stairs" | "secret-passage";
  notes?: string;       // "key in Area B", "one-way", "DC 15 Perception"
};
```

Connections are not stored as structured JSON — they are serialised into the `#### Connections`
markdown block and re-parsed on read. The markdown is the source of truth.

Output format written verbatim to `#### Connections`:

```markdown
#### Connections

- `A -> B` : door
- `B -> C` : open
- `C -> lower-level` : ladder  *(one-way down)*
- `A -> D` : hidden-door  *(DC 15 Perception)*
```

One entry per connection. Connections are directional only when asymmetric (e.g., one-way
trap door). Symmetric connections are written once — `A -> B` implies `B -> A` unless a
note says otherwise.

If the map has no readable area identifiers, the AI uses the area names from the `#### Areas`
block as keys (e.g., `Guard Room -> Armoury : door`). Text-derived identifiers take priority.

Write result under `#### Connections` in the `Scene: <name>` page (not `#### Map Layout` —
that name is retired). Replace or append based on GM's choice in Task 0.6 Step B.

**Purpose:** the connections block is consumed by the Interact AI (Call 2 — Persona Response)
to reason about NPC movement, retreat paths, and reinforcement routing without requiring the
GM to explain map topology each session.

---

## Phase 3 — Storage & Rendering

### Task 3.1 — Native markdown storage for lore index pages

**Files:** `foundry/src/modules/JournalApi.ts`, `foundry/src/modules/LoreIndexBuilder.ts`,
`foundry/src/modules/ContextBuilder.ts`

Foundry V13 has built-in markdown support for journal pages via `text.format = 2` and
`text.markdown`. Switch all lore index pages to this format so the AI reads and writes
pure markdown with zero conversion overhead.

**Why this matters:**
- Currently: AI output (markdown) → `escapeHtml` → stored as HTML → `stripHtml` → fed back to AI.
  That round-trip is lossy (table formatting, inline code, emphasis can degrade).
- With format 2: AI output stored verbatim, read back verbatim. No conversion at any layer.
- Foundry renders format-2 pages natively in the journal viewer — beautiful display,
  no extra library or custom page type needed.

**`JournalApi.ts`**

Change `writePage` / `createPage` to write lore index pages with:
```ts
text: { markdown: content, format: 2 }
```
instead of:
```ts
text: { content: escapeHtml(content), format: 1 }
```

Change `readPages` to return `text.markdown` when `text.format === 2`, falling back to
`stripHtml(text.content)` for legacy HTML pages (backwards compatibility).

**`LoreIndexBuilder.ts`**

Remove all `escapeHtml` / `unescapeHtml` / `stripHtml` calls on lore index page content.
AI output goes straight to `JournalApi.writePage`. Reads come back as clean markdown.

`collectEnrichmentScenes` currently calls `stripHtml(p.text?.content ?? '')` — replace with
direct `text.markdown` read (via the updated JournalApi).

**`ContextBuilder.ts`**

Lore index page reads (`Chapter:`, `Scene:`, `Overview`) go through JournalApi — no change
needed if JournalApi already returns clean markdown. Verify no residual `stripHtml` calls
on index pages remain.

**Backwards compatibility**

Pages written by older versions of the module use format 1 (HTML). The JournalApi fallback
(`stripHtml` when `format !== 2`) ensures those pages still work until rebuilt.

---

## Out of Scope

- Parsing spatial coordinates from map images (adjacency descriptions are sufficient).
- Compendium-based adventure data (journals only).
- Player-facing access to the lore index.
- Persistent storage of indexing or vision model preferences.