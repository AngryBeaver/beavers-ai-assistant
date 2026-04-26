import type { ParsedChapter } from './AdventureParser.js';

export type IndexingPhase =
  | 'pre_chapter'
  | 'already_indexed'
  | 'running'
  | 'between'
  | 'overview'
  | 'complete';

/**
 * Pure state machine for the wizard's chapter-by-chapter indexing pass.
 *
 * No Foundry globals, no AI calls — only tracks what phase the pass is in
 * and exposes clean transition methods.
 */
export class IndexingPassRunner {
  private _queue: ParsedChapter<unknown>[] = [];
  private _overviewChapter: ParsedChapter<unknown> | null = null;
  private _currentIdx = 0;
  private _phase: IndexingPhase = 'pre_chapter';
  private _log: string[] = [];
  private _justCompleted = '';
  private _completedCount = 0;
  private _sceneCount = 0;
  private _error: string | null = null;
  private _lastSceneNames: string[] = [];
  private _lastJournalId = '';
  private _indexAll = false;

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get phase(): IndexingPhase {
    return this._phase;
  }
  get currentChapter(): ParsedChapter<unknown> | undefined {
    return this._queue[this._currentIdx];
  }
  get nextChapter(): ParsedChapter<unknown> | undefined {
    return this._queue[this._currentIdx + 1];
  }
  get overviewChapter(): ParsedChapter<unknown> | null {
    return this._overviewChapter;
  }
  get currentIdx(): number {
    return this._currentIdx;
  }
  get totalChapters(): number {
    return this._queue.length;
  }
  get hasNextChapter(): boolean {
    return this._currentIdx + 1 < this._queue.length;
  }
  get log(): string[] {
    return this._log;
  }
  get justCompleted(): string {
    return this._justCompleted;
  }
  get completedCount(): number {
    return this._completedCount;
  }
  get sceneCount(): number {
    return this._sceneCount;
  }
  get error(): string | null {
    return this._error;
  }
  get lastSceneNames(): string[] {
    return this._lastSceneNames;
  }
  get lastJournalId(): string {
    return this._lastJournalId;
  }
  get indexAll(): boolean {
    return this._indexAll;
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  start(
    queue: ParsedChapter<unknown>[],
    overviewChapter: ParsedChapter<unknown> | null,
    indexAll = false,
  ): void {
    this._queue = queue;
    this._overviewChapter = overviewChapter;
    this._currentIdx = 0;
    this._phase = 'pre_chapter';
    this._log = [];
    this._justCompleted = '';
    this._completedCount = 0;
    this._sceneCount = 0;
    this._error = null;
    this._lastSceneNames = [];
    this._lastJournalId = '';
    this._indexAll = indexAll;
  }

  markAlreadyIndexed(): void {
    this._phase = 'already_indexed';
  }

  beginRun(): void {
    this._phase = 'running';
    this._log = [`→ Indexing ${this.currentChapter?.name ?? ''}…`];
    this._error = null;
  }

  chapterComplete(sceneCount: number, sceneNames: string[] = [], journalId = ''): void {
    this._completedCount++;
    this._sceneCount += sceneCount;
    this._justCompleted = this.currentChapter?.name ?? '';
    this._lastSceneNames = sceneNames;
    this._lastJournalId = journalId;
    this._phase = 'between';
  }

  chapterFailed(error: string): void {
    this._error = error;
    this._phase = 'pre_chapter';
  }

  skipCurrent(): void {
    this._advanceBy(1);
  }

  continueToNext(): void {
    this._advanceBy(1);
  }

  skipNext(): void {
    this._advanceBy(2);
  }

  stopEarly(): void {
    this._phase = 'complete';
  }

  startOverview(): void {
    this._phase = 'overview';
  }

  overviewComplete(): void {
    this._phase = 'complete';
  }

  overviewFailed(error: string): void {
    this._error = error;
    this._phase = 'complete';
  }

  addLogLine(line: string): void {
    this._log.push(line);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _advanceBy(n: number): void {
    this._currentIdx += n;
    this._justCompleted = '';
    this._error = null;
    this._phase = this._currentIdx < this._queue.length ? 'pre_chapter' : 'between';
  }
}
