import { describe, it, expect } from 'vitest';
import { stripHtml, cleanFoundryMarkup } from '../modules/loreIndexUtils.js';

describe('stripHtml', () => {
  it('returns plain text unchanged', () => {
    expect(stripHtml('Hello world')).toBe('Hello world');
  });

  it('strips unknown tags to spaces', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
  });

  // ── Headings ────────────────────────────────────────────────────────────────

  it('converts h1 to ###', () => {
    expect(stripHtml('<h1>Title</h1>')).toBe('### Title');
  });

  it('converts h2 to ####', () => {
    expect(stripHtml('<h2>Section</h2>')).toBe('#### Section');
  });

  it('converts h3 to #####', () => {
    expect(stripHtml('<h3>Sub</h3>')).toBe('##### Sub');
  });

  // ── Inline formatting ────────────────────────────────────────────────────────

  it('converts <strong> to **bold**', () => {
    expect(stripHtml('<p><strong>bold</strong> text</p>')).toBe('**bold** text');
  });

  it('converts <b> to **bold**', () => {
    expect(stripHtml('<b>bold</b>')).toBe('**bold**');
  });

  it('converts <em> to *italic*', () => {
    expect(stripHtml('<em>italic</em>')).toBe('*italic*');
  });

  it('converts <i> to *italic*', () => {
    expect(stripHtml('<i>italic</i>')).toBe('*italic*');
  });

  // ── Unordered lists ──────────────────────────────────────────────────────────

  it('converts <ul> to markdown list', () => {
    const html = '<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>';
    expect(stripHtml(html)).toBe('- Alpha\n- Beta\n- Gamma');
  });

  it('strips inner tags from list items', () => {
    const html = '<ul><li><strong>Bold item</strong></li><li>Plain item</li></ul>';
    expect(stripHtml(html)).toBe('- Bold item\n- Plain item');
  });

  // ── Ordered lists ────────────────────────────────────────────────────────────

  it('converts <ol> to numbered list', () => {
    const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
    expect(stripHtml(html)).toBe('1. First\n2. Second\n3. Third');
  });

  // ── Tables ───────────────────────────────────────────────────────────────────

  it('converts a table with thead/tbody to markdown table', () => {
    const html = `
      <table>
        <thead><tr><th>NPC</th><th>Location</th><th>Attitude</th></tr></thead>
        <tbody>
          <tr><td>Mira</td><td>Tavern</td><td>Friendly</td></tr>
          <tr><td>Gron</td><td>Smithy</td><td>Hostile</td></tr>
        </tbody>
      </table>`;
    const result = stripHtml(html);
    expect(result).toContain('| NPC | Location | Attitude |');
    expect(result).toContain('| --- | --- | --- |');
    expect(result).toContain('| Mira | Tavern | Friendly |');
    expect(result).toContain('| Gron | Smithy | Hostile |');
  });

  it('converts a table without thead to markdown table using first row as header', () => {
    const html = `
      <table>
        <tr><td>Name</td><td>Value</td></tr>
        <tr><td>HP</td><td>42</td></tr>
      </table>`;
    const result = stripHtml(html);
    expect(result).toContain('| Name | Value |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| HP | 42 |');
  });

  it('strips inner tags from table cells', () => {
    const html = `
      <table>
        <tr><th><strong>Name</strong></th><th>Role</th></tr>
        <tr><td><em>Aria</em></td><td>Mage</td></tr>
      </table>`;
    const result = stripHtml(html);
    expect(result).toContain('| Name | Role |');
    expect(result).toContain('| Aria | Mage |');
  });

  // ── Mixed content ────────────────────────────────────────────────────────────

  it('handles a full lore page with heading, paragraph, list and table', () => {
    const html = `
      <h2>The Dragon's Lair</h2>
      <p>A dark cave filled with treasure.</p>
      <ul><li>Gold coins</li><li>Magic sword</li></ul>
      <table>
        <tr><th>Enemy</th><th>CR</th></tr>
        <tr><td>Dragon</td><td>20</td></tr>
      </table>`;
    const result = stripHtml(html);
    expect(result).toContain("#### The Dragon's Lair");
    expect(result).toContain('A dark cave filled with treasure.');
    expect(result).toContain('- Gold coins');
    expect(result).toContain('- Magic sword');
    expect(result).toContain('| Enemy | CR |');
    expect(result).toContain('| Dragon | 20 |');
  });

  // ── Whitespace cleanup ───────────────────────────────────────────────────────

  it('collapses multiple spaces', () => {
    expect(stripHtml('hello   world')).toBe('hello world');
  });

  it('collapses more than two consecutive newlines to two', () => {
    expect(stripHtml('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('cleanFoundryMarkup', () => {
  it('returns plain text unchanged', () => {
    expect(cleanFoundryMarkup('Hello world')).toBe('Hello world');
  });

  // ── @Embed ───────────────────────────────────────────────────────────────────

  it('removes @Embed[...] entirely', () => {
    expect(cleanFoundryMarkup('See @Embed[JournalEntry.abc.JournalEntryPage.xyz] here')).toBe(
      'See here',
    );
  });

  // ── @UUID / generic @Tag ─────────────────────────────────────────────────────

  it('extracts label from @UUID[...]{Label}', () => {
    expect(cleanFoundryMarkup('@UUID[JournalEntry.pbsoPhandalinVil]{Phandalin}')).toBe('Phandalin');
  });

  it('extracts label from @UUID[Actor.xxx]{Name}', () => {
    expect(cleanFoundryMarkup('@UUID[Actor.pbsoKlarg0000000]{Klarg}')).toBe('Klarg');
  });

  it('removes @Tag[...] with no label', () => {
    expect(cleanFoundryMarkup('before @UUID[JournalEntry.abc] after')).toBe('before after');
  });

  it('handles @Tag with dotted namespace', () => {
    expect(cleanFoundryMarkup('@Compendium.world.journal.JournalEntry.abc{Town}')).toBe('Town');
  });

  // ── &Reference ───────────────────────────────────────────────────────────────

  it('extracts label from &amp;Reference[...]{label}', () => {
    expect(cleanFoundryMarkup('target is &amp;Reference[restrained]{restrained}')).toBe(
      'target is restrained',
    );
  });

  it('extracts label from &Reference[...]{label}', () => {
    expect(cleanFoundryMarkup('target is &Reference[blinded]{blinded}')).toBe('target is blinded');
  });

  // ── [[/check]] ───────────────────────────────────────────────────────────────

  it('converts [[/check skill=survival dc=10]] to (Survival DC 10)', () => {
    expect(cleanFoundryMarkup('Make a [[/check skill=survival dc=10]] check')).toBe(
      'Make a (Survival DC 10) check',
    );
  });

  it('converts [[/check skill=perception dc=15]] case-insensitively', () => {
    expect(cleanFoundryMarkup('[[/check SKILL=perception DC=15]]')).toBe('(Perception DC 15)');
  });

  // ── [[/save]] ────────────────────────────────────────────────────────────────

  it('converts [[/save ability=constitution dc=12]] to (Constitution save DC 12)', () => {
    expect(cleanFoundryMarkup('[[/save ability=constitution dc=12]]')).toBe(
      '(Constitution save DC 12)',
    );
  });

  // ── generic [[/...]] ─────────────────────────────────────────────────────────

  it('removes unknown [[/...]] macros', () => {
    expect(cleanFoundryMarkup('deal [[/damage 2d6 fire]] damage')).toBe('deal damage');
  });

  // ── Mixed ────────────────────────────────────────────────────────────────────

  it('cleans multiple patterns in one string', () => {
    const input =
      'Go to @UUID[JournalEntry.abc]{Phandalin} and make a [[/check skill=stealth dc=12]] or face &amp;Reference[restrained]{restrained}.';
    expect(cleanFoundryMarkup(input)).toBe(
      'Go to Phandalin and make a (Stealth DC 12) or face restrained.',
    );
  });
});
