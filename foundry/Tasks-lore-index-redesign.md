# Tasks: Lore Index Redesign

Redesign `LoreIndexBuilder` from a single monolithic AI call into a multi-phase, multi-page
architecture. The result is a set of focused journal pages (one per scene + one overview) each
small enough (~4 096 tokens) to be passed selectively as context during an Interact call.

---

## Background

Current state: one AI call dumps the entire adventure into a single journal page. This breaks on
large modules (token limits), wastes context on every Interact call, and loses heading structure.

Target state:
- **Overview page** — cross-scene summary (all NPCs, factions, world context). ~4 096 tokens.
- **One page per scene** — sublocations, NPCs present, hooks, what happens. ~4 096 tokens each.
- **Optional map enrichment** — vision AI parses map images; sublocation adjacency is appended to
  the relevant scene page. GM confirms which images are maps before processing.

Input format is deliberately flexible — adventures can be one big journal, nested folders,
headers-as-chapters, or any combination. The AI infers structure from heading hierarchy and
folder/journal names (which our `stripHtml` now preserves as `###`–`#######`).

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

### Task 1.2 — Redesign index output to multi-page

**Files:** `LoreIndexBuilder.ts`, `JournalApi.ts`

Change `_writeIndex` so instead of writing one big page it writes multiple pages into
`adventureIndexJournalName`:

| Page name | Content |
|---|---|
| `Overview` | Global NPCs, factions, world context. Cross-scene hooks. |
| `Scene: <name>` | One page per identified scene (sublocations flat list, NPCs present, summary). |

Each page should target ~4 096 output tokens. The AI receives the full content but is instructed
to write each scene as a standalone block so it can be split by the builder.

Splitting strategy: ask the AI to delimit scenes with a sentinel line (e.g. `---SCENE: name---`)
so the builder can split the single AI response into separate pages rather than making N+1 calls
for large adventure modules. Keep the option to do individual calls per scene if the module is
too large for one response.

---

### Task 1.3 — Multi-call fallback for very large modules

**File:** `LoreIndexBuilder.ts`

If total input content exceeds a configurable character threshold (default ~200 000 chars,
~50 000 tokens), switch to a per-chapter call strategy:

1. Split pages by top-level folder / heading group.
2. One AI call per chunk → produces scene pages for that chunk.
3. Final AI call receives all scene summaries → produces the Overview page.

This keeps each call within even conservative local model context windows.

---

### Task 1.4 — Update ContextBuilder to read multi-page index

**File:** `foundry/src/modules/ContextBuilder.ts`

Update `_readLore` to read the new page structure:

- If a scene is selected in the GM window, load `Scene: <name>` + `Overview`.
- If no scene is selected, load `Overview` only.
- Fall back to keyword-scored raw pages if neither page exists (current behaviour).

Lore budget per Interact call drops from ~4 000 tokens to ~2 × 4 096 = ~8 192 tokens max,
but is typically much smaller since individual scene pages are compact.

---

### Task 1.5 — Progress feedback during build

**File:** `LoreIndexBuilder.ts`, `AiGmWindow.ts` (or settings app)

The rebuild is now multi-step and can take minutes on large modules. Emit progress notifications
(`ui.notifications.info`) at each stage:

- "Collecting pages…"
- "Sending to AI service… (N pages)"
- "Writing scene pages… (X of Y)"
- "Writing overview…"
- "Lore index built successfully."

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
If no vision model is configured, the method is absent / throws a descriptive error.

---

### Task 2.2 — Add vision model setting for LocalAI

**Files:** `foundry/src/definitions.ts`, `AiAssistantSettingsApp.ts`, `ai-assistant-settings.hbs`

Add a new setting `localAiVisionModel` (string, default `""`) under the LocalAI section.
Displayed as a text input with placeholder `e.g. qwen3-vl-8b-instruct`.

When blank, Phase 2 is disabled for LocalAI users. Show a note in the UI explaining that a
vision model is required for map enrichment.

---

### Task 2.3 — Collect candidate map images

**File:** `LoreIndexBuilder.ts`

After Phase 1 completes, scan journal pages in the adventure folder for embedded images:

- `<img src="...">` in page HTML
- `src` field of image-type journal pages

Group candidate images by the scene page they were found in (or "unmatched" if found in content
not attributed to a scene). Return a list of `{ scenePageName: string; imageUrls: string[] }`.

---

### Task 2.4 — GM map selection UI

**File:** New dialog `MapSelectionDialog.ts` (ApplicationV2), or inline in settings app.

After Phase 1 finishes (or via a separate "Enrich Maps" button in the settings), show the GM a
review dialog:

```
┌─────────────────────────────────────────────────┐
│  Map Enrichment — Select Maps                   │
├─────────────────────────────────────────────────┤
│  Scene: The Goblin Warren                       │
│  Candidate images:                              │
│    [thumbnail] map-goblin-warren.jpg  [✓ Use]   │
│    [thumbnail] art-goblin-shaman.jpg  [  Skip]  │
│                                                 │
│  Scene: The Flooded Vault                       │
│  Candidate images:                              │
│    [thumbnail] map-vault-level1.jpg   [✓ Use]   │
│    [thumbnail] map-vault-level2.jpg   [✓ Use]   │
├─────────────────────────────────────────────────┤
│              [Cancel]  [Enrich Selected Maps]   │
└─────────────────────────────────────────────────┘
```

Thumbnails are rendered as small `<img>` tags. GM toggles each image. Confirmed selections are
stored in module flags so the dialog remembers choices on re-open.

---

### Task 2.5 — Vision AI map parsing

**File:** `LoreIndexBuilder.ts` (new method `_enrichSceneWithMap`)

For each GM-confirmed map image:

1. Call `aiService.callWithImage()` with a prompt asking the model to:
   - List all numbered or lettered locations visible on the map.
   - Describe which locations are directly adjacent (share a door, corridor, or open connection).
   - Output as a simple markdown list.

2. Append the result to the relevant `Scene: <name>` journal page under a `#### Map Layout`
   heading.

3. Emit progress notifications per map processed.

---

### Task 2.6 — "Enrich Maps" button in settings

**File:** `AiAssistantSettingsApp.ts`, `ai-assistant-settings.hbs`

Add an **Enrich Maps** button next to the existing **Build Lore Index** / **Rebuild** buttons.

Disabled when:
- No lore index exists yet (Phase 1 must run first).
- No vision-capable service is configured (Claude API key absent AND `localAiVisionModel` blank).

Button triggers Task 2.4 (map selection dialog), which on confirm triggers Task 2.5.

---

## Out of Scope

- Parsing spatial coordinates from map images (adjacency descriptions are sufficient for AI context).
- Automatic scene detection from Foundry's active scene (GM confirms scene manually in the panel).
- Compendium-based adventure data.
- Player-facing access to the lore index.