# JournalParser

Parses Foundry VTT journal entries and folders into structured markdown for the AI lore indexer.

## Files

| File | Responsibility |
|---|---|
| `ChapterDetector.ts` | Inspects a Foundry location and returns a flat list of `ChapterCandidate` objects — pure logic, no Foundry globals, fully testable |
| `ChapterContentParser.ts` | Converts one `ChapterCandidate` into a markdown string ready to send to the AI |
| `JournalParser.ts` | `AdventureParser` implementation — wires detection + parsing, exposes wizard form fields |
| `index.ts` | Re-exports all public types and classes |

## Chapter types and markdown hierarchy

A chapter is the unit the wizard indexes in one AI call. There are three source types:

| `sourceType` | When | Markdown structure |
|---|---|---|
| `folder` | Adventure = folder, subfolder is a chapter | `# JournalName` → `## PageName` → `### <h1>` |
| `journal` | Adventure = folder, direct journal is a chapter | `# PageName` → `## <h1>` |
| `page` | Adventure = journal, each page is a chapter | `# <h1>` (headings as-is, no title added) |

## Detection logic (`ChapterDetector.detect`)

```
adventure = folder
  ├─ has subfolders AND journals → isMixed=true (wizard lets GM assign roles)
  ├─ subfolders only             → one 'folder' candidate per subfolder
  ├─ journals only               → one 'journal' candidate per journal
  └─ empty                       → single 'folder' candidate (the folder itself)

adventure = journal
  └─ one 'page' candidate per journal page
```

Names matching `INTRO_KEYWORDS` (intro, background, prologue, …) are auto-flagged `role='overview'`.

## Data flow

```
1. User picks location in wizard
       ↓
2. JournalParser.getSettingInformation()
   → returns a single select field: [Folder] … / [Journal] …

3. User selects a value; wizard calls JournalParser.detectChapters(formData)
       ↓ ChapterDetector.detect(id, type)
   → ChapterCandidate[]  (each with id, name, sourceType, role, tokens)

4. User confirms/adjusts chapter roles in wizard

5. For each chapter: JournalParser.parseContent(chapter)
       ↓ ChapterContentParser.parse(chapter.data)
   → markdown string  (sent to AI indexer)
```

## Area codes (scene note marks)

When `sourceType` is `folder` or `journal`, page names are checked against the active Foundry scene's map notes (`JournalEntryPage.sceneNote`). If a note links to the page and its label looks like an area code (`H1`, `A2`, `1.`, …), that label is prepended to the page name — e.g. `H1: Cave Mouth`. This gives the AI reliable area identifiers for map scanning.