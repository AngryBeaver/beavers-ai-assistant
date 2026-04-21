import { describe, it, expect } from 'vitest';
import {
  ChapterDetector,
  flagIntroCandidate,
  GameAccessor,
  FolderLike,
  JournalLike,
} from '../modules/JournalParser/index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFolder(id: string, name: string): FolderLike {
  return { id, name };
}

function makeJournal(id: string, name: string, pages: string[]): JournalLike {
  return {
    id,
    name,
    pages: { contents: pages.map((content) => ({ text: { content } })) },
  };
}

/**
 * Minimal GameAccessor backed by plain Maps.
 * Only provide the maps needed for each test.
 */
function makeAccessor(opts: {
  folders?: Map<string, FolderLike>;
  subfolders?: Map<string, FolderLike[]>;
  journals?: Map<string, JournalLike>;
  journalsInFolder?: Map<string, JournalLike[]>;
}): GameAccessor {
  return {
    getFolder: (id) => opts.folders?.get(id) ?? null,
    getSubfolders: (parentId) => opts.subfolders?.get(parentId) ?? [],
    getJournal: (id) => opts.journals?.get(id) ?? null,
    getJournalsInFolder: (folderId) => opts.journalsInFolder?.get(folderId) ?? [],
  };
}

function makeDetector(opts: Parameters<typeof makeAccessor>[0]): ChapterDetector {
  return new ChapterDetector(makeAccessor(opts));
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('ChapterDetector.estimateTokens', () => {
  it('counts stripped chars in a journal and divides by 4', () => {
    const j = makeJournal('j1', 'J', ['<p>' + 'a'.repeat(400) + '</p>']);
    const detector = makeDetector({
      journals: new Map([['j1', j]]),
      journalsInFolder: new Map(),
    });
    expect(detector.estimateTokens('j1', 'journal')).toBe(100);
  });

  it('strips HTML tags before counting', () => {
    const j = makeJournal('j1', 'J', ['<h1>Title</h1><p>' + 'a'.repeat(396) + '</p>']);
    const detector = makeDetector({
      journals: new Map([['j1', j]]),
      journalsInFolder: new Map(),
    });
    // "Title" (5) + 396 = 401 → ceil(401/4) = 101
    expect(detector.estimateTokens('j1', 'journal')).toBe(101);
  });

  it('sums journals and subfolders recursively for a folder', () => {
    const j1 = makeJournal('j1', 'J1', ['<p>' + 'a'.repeat(800) + '</p>']);
    const j2 = makeJournal('j2', 'J2', ['<p>' + 'a'.repeat(400) + '</p>']);
    const sf = makeFolder('sf', 'Sub');
    const detector = makeDetector({
      folders: new Map([['sf', sf]]),
      subfolders: new Map([
        ['root', [sf]],
        ['sf', []],
      ]),
      journals: new Map([
        ['j1', j1],
        ['j2', j2],
      ]),
      journalsInFolder: new Map([
        ['root', [j1]],
        ['sf', [j2]],
      ]),
    });
    // root: j1(800) + sf→j2(400) = 1200 / 4 = 300
    expect(detector.estimateTokens('root', 'folder')).toBe(300);
  });

  it('returns 0 for a folder with no content', () => {
    const detector = makeDetector({
      subfolders: new Map([['f', []]]),
      journalsInFolder: new Map([['f', []]]),
    });
    expect(detector.estimateTokens('f', 'folder')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detect — journal
// ---------------------------------------------------------------------------

describe('ChapterDetector.detect — journal', () => {
  it('splits on h1 headings', () => {
    const j = makeJournal('j1', 'Adventure', [
      '<h1>Chapter One</h1><p>' +
        'a'.repeat(400) +
        '</p>' +
        '<h1>Chapter Two</h1><p>' +
        'b'.repeat(200) +
        '</p>',
    ]);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { isMixed, candidates } = detector.detect('j1', 'journal');

    expect(isMixed).toBe(false);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('Chapter One');
    expect(candidates[0].sourceType).toBe('header');
    expect(candidates[1].name).toBe('Chapter Two');
  });

  it('splits on h2 headings', () => {
    const j = makeJournal('j1', 'Adventure', [
      '<h2>Part A</h2><p>text</p><h2>Part B</h2><p>text</p>',
    ]);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('Part A');
  });

  it('ignores content before the first heading', () => {
    const j = makeJournal('j1', 'A', ['<p>preamble</p><h1>Ch1</h1><p>body</p>']);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('Ch1');
  });

  it('returns the whole journal as one candidate when no headings exist', () => {
    const j = makeJournal('j1', 'Adventure', ['<p>Some content without headings</p>']);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('j1');
    expect(candidates[0].sourceType).toBe('journal');
    expect(candidates[0].name).toBe('Adventure');
  });

  it('assigns unique header-based IDs', () => {
    const j = makeJournal('j1', 'A', ['<h1>Ch1</h1><p>x</p><h1>Ch2</h1><p>y</p>']);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates[0].id).toBe('j1::h::0');
    expect(candidates[1].id).toBe('j1::h::1');
  });

  it('strips HTML from heading text', () => {
    const j = makeJournal('j1', 'A', ['<h1><strong>Bold Title</strong></h1><p>x</p>']);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates[0].name).toBe('Bold Title');
  });

  it('auto-flags any heading matching an intro keyword as overview', () => {
    const j = makeJournal('j1', 'A', ['<h1>Chapter 1</h1><p>x</p><h1>Introduction</h1><p>y</p>']);
    const detector = makeDetector({ journals: new Map([['j1', j]]) });
    const { candidates } = detector.detect('j1', 'journal');

    expect(candidates[0].role).toBe('chapter');
    expect(candidates[1].role).toBe('overview');
  });
});

// ---------------------------------------------------------------------------
// detect — folder (subfolders only)
// ---------------------------------------------------------------------------

describe('ChapterDetector.detect — folder with subfolders only', () => {
  it('returns one candidate per subfolder', () => {
    const sf1 = makeFolder('sf1', 'Chapter 1');
    const sf2 = makeFolder('sf2', 'Chapter 2');
    const j = makeJournal('j1', 'Scene', ['<p>content</p>']);
    const detector = makeDetector({
      folders: new Map([
        ['sf1', sf1],
        ['sf2', sf2],
      ]),
      subfolders: new Map([
        ['root', [sf1, sf2]],
        ['sf1', []],
        ['sf2', []],
      ]),
      journals: new Map([['j1', j]]),
      journalsInFolder: new Map([
        ['root', []],
        ['sf1', [j]],
        ['sf2', []],
      ]),
    });
    const { isMixed, candidates } = detector.detect('root', 'folder');

    expect(isMixed).toBe(false);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('Chapter 1');
    expect(candidates[0].sourceType).toBe('folder');
    expect(candidates[1].name).toBe('Chapter 2');
  });

  it('calculates tokens per subfolder recursively', () => {
    const sf1 = makeFolder('sf1', 'Ch1');
    const j1 = makeJournal('j1', 'J1', ['<p>' + 'a'.repeat(400) + '</p>']);
    const detector = makeDetector({
      folders: new Map([['sf1', sf1]]),
      subfolders: new Map([
        ['root', [sf1]],
        ['sf1', []],
      ]),
      journals: new Map([['j1', j1]]),
      journalsInFolder: new Map([
        ['root', []],
        ['sf1', [j1]],
      ]),
    });
    const { candidates } = detector.detect('root', 'folder');

    expect(candidates[0].tokens).toBe(100); // 400 / 4
  });
});

// ---------------------------------------------------------------------------
// detect — folder (journals only)
// ---------------------------------------------------------------------------

describe('ChapterDetector.detect — folder with journals only', () => {
  it('returns one candidate per journal', () => {
    const j1 = makeJournal('j1', 'Chapter 1', ['<p>x</p>']);
    const j2 = makeJournal('j2', 'Chapter 2', ['<p>y</p>']);
    const detector = makeDetector({
      subfolders: new Map([['root', []]]),
      journals: new Map([
        ['j1', j1],
        ['j2', j2],
      ]),
      journalsInFolder: new Map([['root', [j1, j2]]]),
    });
    const { isMixed, candidates } = detector.detect('root', 'folder');

    expect(isMixed).toBe(false);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].sourceType).toBe('journal');
  });
});

// ---------------------------------------------------------------------------
// detect — mixed folder
// ---------------------------------------------------------------------------

describe('ChapterDetector.detect — mixed folder', () => {
  it('returns isMixed=true with separate lists when folder has both subfolders and journals', () => {
    const sf = makeFolder('sf', 'Chapter 1');
    const j = makeJournal('j1', 'Introduction', ['<p>intro</p>']);
    const detector = makeDetector({
      folders: new Map([['sf', sf]]),
      subfolders: new Map([
        ['root', [sf]],
        ['sf', []],
      ]),
      journals: new Map([['j1', j]]),
      journalsInFolder: new Map([
        ['root', [j]],
        ['sf', []],
      ]),
    });
    const result = detector.detect('root', 'folder');

    expect(result.isMixed).toBe(true);
    expect(result.subfolders).toHaveLength(1);
    expect(result.journals).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
  });

  it('does not auto-flag intro when returning mixed (no candidates to flag)', () => {
    const sf = makeFolder('sf', 'Introduction');
    const j = makeJournal('j1', 'Chapter 1', ['<p>x</p>']);
    const detector = makeDetector({
      folders: new Map([['sf', sf]]),
      subfolders: new Map([
        ['root', [sf]],
        ['sf', []],
      ]),
      journals: new Map([['j1', j]]),
      journalsInFolder: new Map([
        ['root', [j]],
        ['sf', []],
      ]),
    });
    const result = detector.detect('root', 'folder');

    // isMixed=true — the caller resolves mixed first, then re-flags
    expect(result.isMixed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detect — empty folder
// ---------------------------------------------------------------------------

describe('ChapterDetector.detect — empty folder', () => {
  it('returns the folder itself as a single chapter candidate', () => {
    const detector = makeDetector({
      folders: new Map([['f', makeFolder('f', 'Adventure')]]),
      subfolders: new Map([['f', []]]),
      journalsInFolder: new Map([['f', []]]),
    });
    const { candidates } = detector.detect('f', 'folder');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('f');
    expect(candidates[0].name).toBe('Adventure');
    expect(candidates[0].sourceType).toBe('folder');
  });
});

// ---------------------------------------------------------------------------
// flagIntroCandidate
// ---------------------------------------------------------------------------

describe('flagIntroCandidate', () => {
  it('flags any candidate whose name matches a keyword, not just the first', () => {
    const candidates = [
      {
        id: '1',
        name: 'Chapter 1',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 200,
      },
      {
        id: '2',
        name: 'Introduction',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 100,
      },
    ];
    flagIntroCandidate(candidates);
    expect(candidates[0].role).toBe('chapter');
    expect(candidates[1].role).toBe('overview');
  });

  it('flags multiple matching candidates', () => {
    const candidates = [
      {
        id: '1',
        name: 'Welcome to Phandalin',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 80,
      },
      {
        id: '2',
        name: 'Chapter 1',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 200,
      },
      {
        id: '3',
        name: 'Getting Started',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 60,
      },
    ];
    flagIntroCandidate(candidates);
    expect(candidates[0].role).toBe('overview');
    expect(candidates[1].role).toBe('chapter');
    expect(candidates[2].role).toBe('overview');
  });

  it('matches substring — "Chapter 0: Introduction" triggers overview', () => {
    const candidates = [
      {
        id: '1',
        name: 'Chapter 0: Introduction',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 50,
      },
    ];
    flagIntroCandidate(candidates);
    expect(candidates[0].role).toBe('overview');
  });

  it('is case-insensitive', () => {
    const candidates = [
      {
        id: '1',
        name: 'PREFACE AND BACKGROUND',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 50,
      },
    ];
    flagIntroCandidate(candidates);
    expect(candidates[0].role).toBe('overview');
  });

  it('does not change role when name has no keyword', () => {
    const candidates = [
      {
        id: '1',
        name: 'The Road to Millhaven',
        sourceType: 'folder' as const,
        role: 'chapter' as const,
        tokens: 300,
      },
    ];
    flagIntroCandidate(candidates);
    expect(candidates[0].role).toBe('chapter');
  });

  it('does nothing for an empty array', () => {
    expect(() => flagIntroCandidate([])).not.toThrow();
  });
});
