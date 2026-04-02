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

| Page | Content tone |
|---|---|
| `Overview` | Global NPCs, factions, world context. Neutral — no visited/unvisited framing. |
| `Chapter: <name>` | Arc summary. All scenes described neutrally — what they contain, who is in them, what the stakes are. |
| `Scene: <name>` | Full detail — sublocations, NPCs present, what happens. Optional map layout appended by Phase 2. |

### Context assembly per Interact call

```
Overview        — global world context (neutral)
Chapter         — arc summary of current chapter (neutral)
Scene           — current scene full detail (neutral)
Session summary — source of truth for what PCs have actually done
```

The visited/unvisited framing is **not baked into the index**. The index is static and neutral.
Call 1 (Situation Assessment) combines the chapter summary with the session summary at runtime
and the AI infers which scenes are done (background context) vs not yet visited (foreshadowing/
setup) from that combination.

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

Input format is deliberately flexible — adventures can be one big journal, nested folders,
headers-as-chapters, or any combination. The AI infers structure from heading hierarchy and
folder/journal names (which `stripHtml` now preserves as `###`–`#######`).

---

## Phase 1 — Text Index (required)

### Task 1.1 — Increase output token budget

**File:** `foundry/src/modules/LoreIndexBuilder.ts`

Replace the hardcoded `max_tokens: 4096` on the `_generateIndex` call with a configurable value.
Add a new setting `loreIndexMaxTokens` (default `16384`) to `definitions.ts` and
`AiAssistantSettingsApp`. Read it in `LoreIndexBuilder` instead of the hardcoded value.

> Rationale: 4 096 output tokens hard-cuts large adventures mid-index with no error.
> 16 384 covers most published modules; 32 768 is safe for very large ones.

---

### Task 1.2 — Redesign index output to three-tier multi-page

**Files:** `LoreIndexBuilder.ts`, `JournalApi.ts`

Change `_writeIndex` so instead of writing one big page it writes multiple pages into
`adventureIndexJournalName`:

| Page name | Content |
|---|---|
| `Overview` | Global NPCs, factions, world context. Neutral summary of the whole adventure. |
| `Chapter: <name>` | One page per chapter. Neutral arc summary — all scenes, stakes, themes. |
| `Scene: <name>` | One page per scene. Full detail, sublocations flat list, NPCs present. |

Each page targets ~4 096 output tokens. The AI receives full content and is instructed to write
using sentinel delimiters so the builder can split one response into separate pages:

```
---OVERVIEW---
...overview content...
---CHAPTER: The Road to Millhaven---
...chapter content...
---SCENE: The Road Ambush---
...scene content...
```

Keep the option to do individual calls per chapter if total output would exceed `loreIndexMaxTokens`.

The index is deliberately neutral — no visited/unvisited framing. That framing is applied at
runtime by Call 1 (Situation Assessment), which combines the chapter summary with the session
summary to infer what the party has done vs what lies ahead.

---

### Task 1.3 — Multi-call fallback for very large modules

**File:** `LoreIndexBuilder.ts`

If total input content exceeds a configurable character threshold (default ~200 000 chars,
~50 000 tokens), switch to a per-chapter call strategy:

1. Split pages by top-level folder / heading group (one chunk per chapter).
2. One AI call per chunk → produces Chapter page + Scene pages for that chunk.
3. Final AI call receives all chapter summaries → produces the Overview page.

This keeps each call within even conservative local model context windows (Qwen3.5-9B: 262k).

---

### Task 1.4 — Update ContextBuilder to read three-tier index

**File:** `foundry/src/modules/ContextBuilder.ts`

Update `_readLore` to load pages by tier based on GM selection:

| GM selection state | Pages loaded |
|---|---|
| Chapter + Scene selected | `Overview` + `Chapter: <name>` + `Scene: <name>` |
| Chapter only | `Overview` + `Chapter: <name>` |
| Nothing selected | `Overview` only |
| No index built | keyword-scored raw pages (current fallback behaviour) |

Total lore budget per Interact call: ~3 × 4 096 = ~12 288 tokens max. In practice much smaller
since scene pages for focused scenes are compact.

---

### Task 1.5 — Chapter selector in GM panel

**File:** `AiGmWindow.ts`, `ai-gm-window.hbs`

Add a chapter dropdown/list to the AI GM Window populated from the `Chapter: *` pages in the
lore index. GM selects once per session; selection is cached.

Scene is not selected manually — it is proposed by Call 1 (Situation Assessment). GM confirms
or corrects via the confirmation card.

---

### Task 1.6 — Revised Interact flow (two-call)

**File:** `AiGmWindow.ts` (and supporting modules)

Replace the current single-call Interact with:

**Call 1 — Situation Assessment**
- Input: chapter summary, recent session entries (last N), session summary, active Foundry scene name
- Output: structured block with current scene guess + recap + ranked NPC candidates
- Display: single confirmation card (scene label + recap paragraph + NPC list with confirm buttons)
- GM confirms scene + NPC in one click; can adjust before confirming

**Call 2 — Persona Response**
- Triggered immediately after GM confirms
- Input: chapter summary, scene summary, situation recap, confirmed NPC + topic
- Output: streaming persona response
- Feeds into existing adjustment buttons + Accept flow unchanged

Cache the assembled context from Call 1 so adjustment button re-calls (colder/warmer/etc.)
do not reassemble from scratch.

---

### Task 1.7 — Progress feedback during build

**File:** `LoreIndexBuilder.ts`, settings app

The rebuild is multi-step and can take minutes on large modules. Emit progress notifications
(`ui.notifications.info`) at each stage:

- "Collecting pages…"
- "Sending to AI service… (N pages)"
- "Writing chapter and scene pages… (X of Y)"
- "Writing overview…"
- "Lore index built successfully — X chapters, Y scenes."

---

## Phase 2 — Map Enrichment (optional, user-initiated)

### Task 2.1 — Add vision support to AiService interface

**Files:** `foundry/src/services/AiService.ts`, `ClaudeService.ts`, `LocalAiService.ts`

Add an optional method to the `AiService` interface:

```ts
callWithImage?(
  systemPrompt: string,
  userPrompt: string,
  imageUrl: string,
  options?: CallOptions,
): Promise<string>;
```

Implement in `ClaudeService` using the existing messages API with an `image` content block
(Claude supports vision natively — base64 or URL).

Implement in `LocalAiService` using a **separate** vision model setting (see Task 2.2).
If no vision model is configured, the method throws a descriptive error.

---

### Task 2.2 — Add vision model setting for LocalAI

**Files:** `foundry/src/definitions.ts`, `AiAssistantSettingsApp.ts`, `ai-assistant-settings.hbs`

Add a new setting `localAiVisionModel` (string, default `""`) under the LocalAI section.
Displayed as a text input with placeholder `e.g. qwen3-vl-8b-instruct`.

When blank, Phase 2 is disabled for LocalAI users. Show a note in the UI explaining that a
vision model is required for map enrichment.

---

### Task 2.3 — Collect candidate map images per scene

**File:** `LoreIndexBuilder.ts`

After Phase 1 completes, scan journal pages in the adventure folder for embedded images:

- `<img src="...">` in page HTML
- `src` field of image-type journal pages

Group candidate images by the scene they were found in (matched by proximity to the scene's
heading in the source content, or "unmatched" if attribution is unclear).
Return `{ sceneName: string; imageUrls: string[] }[]`.

---

### Task 2.4 — GM map selection UI

**File:** New `MapSelectionDialog.ts` (ApplicationV2).

After Phase 1 finishes (or via a separate **Enrich Maps** button in the settings), show the GM
a review dialog:

```
┌─────────────────────────────────────────────────┐
│  Map Enrichment — Select Maps                   │
├─────────────────────────────────────────────────┤
│  Scene: The Goblin Warren                       │
│    [thumbnail] map-goblin-warren.jpg  [✓ Use]   │
│    [thumbnail] art-goblin-shaman.jpg  [  Skip]  │
│                                                 │
│  Scene: The Flooded Vault                       │
│    [thumbnail] map-vault-level1.jpg   [✓ Use]   │
│    [thumbnail] map-vault-level2.jpg   [✓ Use]   │
│                                                 │
│  Unmatched                                      │
│    [thumbnail] cover-art.jpg          [  Skip]  │
├─────────────────────────────────────────────────┤
│              [Cancel]  [Enrich Selected Maps]   │
└─────────────────────────────────────────────────┘
```

Confirmed selections stored in module flags (persist across sessions).

---

### Task 2.5 — Vision AI map parsing

**File:** `LoreIndexBuilder.ts` (new method `_enrichSceneWithMap`)

For each GM-confirmed map image:

1. Call `aiService.callWithImage()` asking the model to:
   - List all numbered or lettered locations visible on the map.
   - Describe which locations are directly adjacent (share a door, corridor, or open connection).
   - Output as a simple markdown list.

2. Append the result to the relevant `Scene: <name>` journal page under a `#### Map Layout`
   heading.

3. Emit progress notifications per map processed.

---

### Task 2.6 — "Enrich Maps" button in settings

**File:** `AiAssistantSettingsApp.ts`, `ai-assistant-settings.hbs`

Add an **Enrich Maps** button next to **Build Lore Index** / **Rebuild**.

Disabled when:
- No lore index exists yet (Phase 1 must run first).
- No vision-capable service is configured (Claude API key absent AND `localAiVisionModel` blank).

Button triggers Task 2.4 → on confirm triggers Task 2.5.

---

## Out of Scope

- Parsing spatial coordinates from map images (adjacency descriptions are sufficient).
- Compendium-based adventure data (journals only).
- Player-facing access to the lore index.
- Automatic chapter/scene detection without GM input.