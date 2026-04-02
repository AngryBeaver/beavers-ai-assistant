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

**Files:** `foundry/src/apps/LoreIndexWizard.ts` + `templates/lore-index-wizard.hbs`

The wizard is the single entry point for all lore index operations: building, rebuilding chapters,
and enriching scenes with map data. It is incremental and resumable — skipping a step always
preserves existing data.

Indexing and vision model choices are ephemeral (per-run, not stored in settings).

---

### Task 0.1 — Wizard shell and state detection

Create `LoreIndexWizard.ts` as an `ApplicationV2`. Step state is held in instance variables.
Navigation uses `_goToStep(name)` which re-renders the content area without closing the window.

**Step: Location selection (always first)**

Show a dropdown of all first-level items visible in Foundry — both folders and journals — so the
GM can point the wizard at their adventure content regardless of how it is organised:

```
Where is your adventure content?
[ dropdown: all root-level folders and journals ]
[Continue]
```

The selected item (folder or journal) is stored in wizard state.

**Step: State detection (after location selected)**

Inspect the lore index journal to determine what already exists for this adventure location:

| State | Detection | Screen shown |
|---|---|---|
| No index | Index journal has no pages for this location | "No index found. Let's build one." → chapter detection |
| Partial index | Some `Chapter:` pages exist but not all detected chapters | "Index incomplete. Continue or rebuild from scratch?" |
| Full index | All detected chapters present | "Index is up to date." → [Rebuild chapters] [Update map enrichments] |

---

### Task 0.2 — Token / cost estimate ✓ DONE

After location is selected, collect all pages from the adventure content and display on the
status screen:
- Estimated input tokens: `Math.ceil(stripped_chars / 4)`
- Claude Sonnet cost: input tokens × $3/1M (approximate, input only — labelled as such)
- LocalAI: Free

Per-chapter token estimates are shown live during the indexing pass (Task 0.5).
No global max output tokens setting is needed — indexing is chapter-by-chapter so each call
output is naturally bounded by one chapter's content.

---

### Task 0.3 — Chapter detection and GM confirmation

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

### Task 0.4 — Model selection and LocalAI load indicator

Shown once before the chapter-by-chapter indexing pass begins (and again separately before the
map enrichment pass, since a different model may be chosen).

**Provider selector: Claude | LocalAI**

Claude branch:
- Shows API key status (configured / missing)
- Hint: "Reliable for large structured output. Costs apply — estimate shown above."

LocalAI branch:
- Shows installed models fetched from `GET /v1/models`
- For indexing: recommended label on Qwen3.5-9B — "262k context, handles full adventure modules"
- For vision: show only vision-capable models; recommended label on Qwen3-VL-8B-Instruct —
  "Fast and accurate for map layouts. Use Instruct variant, not Thinking."
- **Load indicator** when a model is selected that is not yet in the `/v1/models` response:

```
⏳ Loading qwen3.5-9b — this may take several minutes on first use.
   Once loaded it stays resident in Docker until the container restarts.
   [animated bar]
```

Poll `GET /v1/models` every 5 seconds. When the model appears, replace with:
```
✓ Model ready.
```

The [Continue] button is disabled until the model is confirmed ready (or Claude is selected).

Model load indicator appears identically in both the indexing model step and the vision model
step — same component, different context.

---

### Task 0.5 — Chapter-by-chapter indexing pass

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

---

### Task 0.6 — Scene-by-scene map enrichment pass

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

If the scene already has a `#### Map Layout` section:
```
Scene: The Cave Entrance — map data exists.
  Current: map-cave-entrance.jpg (indexed 2025-03-10)
  [Replace with new selection]  [Add to existing]  [Skip — keep current]
```

After GM makes a choice:
- [Use] / [Replace] / [Add] → run vision AI call → append/replace `#### Map Layout` in
  `Scene: <name>` page → show result inline → move to next scene
- [Skip] → move to next scene, existing data untouched

Progress shown as "Scene 4 of 14". GM can [Stop enrichment] at any point; scenes already
enriched are kept.

After all scenes: done summary → [Finish]

---

### Task 0.7 — Wizard entry from settings app

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
| `Overview` | Global NPCs, factions, world context. Written last from chapter summaries. |
| `Chapter: <name>` | Neutral arc summary — all scenes, stakes, themes. |
| `Scene: <name>` | Full detail, sublocations flat list, NPCs present. Map layout appended by enrichment. |

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

---

### Task 1.5 — Chapter selector in GM panel

**File:** `AiGmWindow.ts`, `ai-gm-window.hbs`

Chapter dropdown populated from `Chapter: *` pages in the lore index. GM selects once per
session; cached. Scene is proposed by Call 1 (Situation Assessment), not selected manually.

---

### Task 1.6 — Revised Interact flow (two-call)

**File:** `AiGmWindow.ts`

**Call 1 — Situation Assessment:** chapter summary + session entries + session summary + active
scene name → scene guess + recap + ranked NPC candidates (single structured response) →
GM confirms scene + NPC in one card.

**Call 2 — Persona Response:** chapter summary + scene summary + situation recap + confirmed
NPC → streaming persona response → adjustment buttons → Accept (unchanged).

Context from Call 1 cached for adjustment button re-calls.

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

For each confirmed map image, call `callWithImage()` to:
- List numbered/lettered locations visible on the map
- Describe direct adjacency between locations
- Output as markdown list

Write result under `#### Map Layout` in `Scene: <name>` page.
Replace or append based on GM's choice in Task 0.6 Step B.

---

## Out of Scope

- Parsing spatial coordinates from map images (adjacency descriptions are sufficient).
- Compendium-based adventure data (journals only).
- Player-facing access to the lore index.
- Persistent storage of indexing or vision model preferences.