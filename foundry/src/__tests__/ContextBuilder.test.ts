import { describe, it, expect } from 'vitest';
import { ContextBuilder, GameData } from '../modules/ContextBuilder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<GameData> = {}): GameData {
  return {
    settings: {
      get: () => undefined,
    },
    scenes: { active: null },
    actors: { contents: [] },
    folders: { find: () => undefined, filter: () => [] },
    journal: { find: () => undefined, filter: () => [] },
    ...overrides,
  };
}

function makeBuilder(overrides: Partial<GameData> = {}): ContextBuilder {
  return new ContextBuilder(makeGame(overrides));
}

// ---------------------------------------------------------------------------
// Scene section
// ---------------------------------------------------------------------------

describe('ContextBuilder — scene section', () => {
  it('returns empty string when scene is null', () => {
    const builder = makeBuilder();
    expect((builder as any)._buildSceneSection(null)).toBe('');
  });

  it('includes scene name', () => {
    const builder = makeBuilder();
    const result = (builder as any)._buildSceneSection({ name: 'The Rusty Flagon' });
    expect(result).toContain('The Rusty Flagon');
  });

  it('includes journal content from first scene note', () => {
    const builder = makeBuilder({
      journal: {
        find: (fn) =>
          fn({
            id: 'j1',
            name: 'Scene Note',
            pages: {
              contents: [
                { name: 'p1', text: { content: '<p>Room with <strong>treasure</strong>.</p>' } },
              ],
            },
          } as any)
            ? ({
                id: 'j1',
                name: 'Scene Note',
                pages: {
                  contents: [
                    {
                      name: 'p1',
                      text: { content: '<p>Room with <strong>treasure</strong>.</p>' },
                    },
                  ],
                },
              } as any)
            : undefined,
        filter: () => [],
      },
    });
    const result = (builder as any)._buildSceneSection({
      name: 'Throne Room',
      notes: [{ journalEntryId: 'j1' }],
    });
    expect(result).toContain('Throne Room');
    expect(result).toContain('**Notes:**');
    expect(result).toContain('Room with treasure');
    expect(result).not.toContain('<p>');
  });

  it('handles scene with no notes gracefully', () => {
    const builder = makeBuilder();
    const result = (builder as any)._buildSceneSection({
      name: 'Empty Room',
      notes: [],
    });
    expect(result).toBe('## Current Scene\nEmpty Room');
  });
});

// ---------------------------------------------------------------------------
// Actor section
// ---------------------------------------------------------------------------

describe('ContextBuilder — actor section', () => {
  it('returns empty string when no actors', () => {
    const builder = makeBuilder();
    expect((builder as any)._buildActorSection([])).toBe('');
  });

  it('lists actor name and type', () => {
    const builder = makeBuilder();
    const result = (builder as any)._buildActorSection([{ name: 'Aldric', type: 'npc' }]);
    expect(result).toContain('Aldric (npc)');
  });

  it('includes description snippet when present', () => {
    const builder = makeBuilder();
    const result = (builder as any)._buildActorSection([
      {
        name: 'Aldric',
        type: 'npc',
        system: { details: { biography: { value: '<p>Gruff innkeeper.</p>' } } },
      },
    ]);
    expect(result).toContain('Gruff innkeeper.');
  });

  it('truncates description to 200 characters', () => {
    const builder = makeBuilder();
    const longDesc = 'x'.repeat(300);
    const result = (builder as any)._buildActorSection([
      { name: 'A', type: 'npc', system: { description: { value: longDesc } } },
    ]);
    const snippetMatch = result.match(/: (.+)/);
    expect(snippetMatch![1].length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Session chat section
// ---------------------------------------------------------------------------

describe('ContextBuilder — session chat section', () => {
  it('returns empty string when no entries', () => {
    const builder = makeBuilder();
    expect((builder as any)._buildSessionChatSection([], 10)).toBe('');
  });

  it('trims to the configured limit', () => {
    const builder = makeBuilder();
    const entries = ['a', 'b', 'c', 'd', 'e'];
    const result = (builder as any)._buildSessionChatSection(entries, 3);
    expect(result).toContain('c');
    expect(result).toContain('d');
    expect(result).toContain('e');
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
  });

  it('includes all entries when limit exceeds count', () => {
    const builder = makeBuilder();
    const entries = ['x', 'y'];
    const result = (builder as any)._buildSessionChatSection(entries, 100);
    expect(result).toContain('x');
    expect(result).toContain('y');
  });
});

// ---------------------------------------------------------------------------
// Summary section
// ---------------------------------------------------------------------------

describe('ContextBuilder — summary section', () => {
  it('returns empty string for null', () => {
    const builder = makeBuilder();
    expect((builder as any)._buildSummarySection(null)).toBe('');
  });

  it('wraps content under Previously heading', () => {
    const builder = makeBuilder();
    const result = (builder as any)._buildSummarySection('The party arrived at the inn.');
    expect(result).toBe('## Previously\nThe party arrived at the inn.');
  });
});

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

describe('ContextBuilder — extractKeywords', () => {
  it('returns unique lowercase words longer than 3 chars', () => {
    const builder = makeBuilder();
    const keywords = builder.extractKeywords('Rusty Flagon', [], ['Aldric']);
    expect(keywords).toContain('rusty');
    expect(keywords).toContain('flagon');
    expect(keywords).toContain('aldric');
  });

  it('deduplicates repeated words', () => {
    const builder = makeBuilder();
    const keywords = builder.extractKeywords('flagon flagon', [], []);
    expect(keywords.filter((k) => k === 'flagon').length).toBe(1);
  });

  it('excludes words of 3 chars or fewer', () => {
    const builder = makeBuilder();
    const keywords = builder.extractKeywords('inn the ale', [], []);
    expect(keywords).not.toContain('inn');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('ale');
  });

  it('uses only last 10 chat entries', () => {
    const builder = makeBuilder();
    const entries = Array.from({ length: 15 }, (_, i) => `uniqueword${i}`);
    const keywords = builder.extractKeywords('', entries, []);
    expect(keywords).toContain('uniqueword14');
    expect(keywords).not.toContain('uniqueword0');
  });
});

// ---------------------------------------------------------------------------
// Lore page scoring
// ---------------------------------------------------------------------------

describe('ContextBuilder — scoreLorePages', () => {
  it('scores pages by keyword hits', () => {
    const builder = makeBuilder();
    const pages = [
      { name: 'A', content: 'aldric runs the flagon inn' },
      { name: 'B', content: 'nothing relevant here at all' },
    ];
    const scored = builder.scoreLorePages(pages, ['aldric', 'flagon']);
    expect(scored[0].name).toBe('A');
    expect(scored[0].score).toBe(2);
    expect(scored[1].score).toBe(0);
  });

  it('returns pages sorted highest score first', () => {
    const builder = makeBuilder();
    const pages = [
      { name: 'Low', content: 'aldric' },
      { name: 'High', content: 'aldric flagon millhaven' },
    ];
    const scored = builder.scoreLorePages(pages, ['aldric', 'flagon', 'millhaven']);
    expect(scored[0].name).toBe('High');
  });

  it('returns zero score for pages with no keyword matches', () => {
    const builder = makeBuilder();
    const pages = [{ name: 'X', content: 'completely unrelated text' }];
    const scored = builder.scoreLorePages(pages, ['aldric']);
    expect(scored[0].score).toBe(0);
  });
});
