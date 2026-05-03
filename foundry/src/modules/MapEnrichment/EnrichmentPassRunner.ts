export type EnrichmentPhase = 'pre_chapter' | 'running' | 'post_chapter' | 'complete';

/** A map/art image candidate with a human-readable name derived from its source context. */
export interface NamedImage {
  url: string;
  /** Alt text → figcaption → nearest heading → page/journal name, in that priority order. */
  name: string;
}

export interface EnrichmentScene {
  sceneName: string;
  chapterName: string;
  images: NamedImage[];
  hasConnections: boolean;
  /** Raw source text extracted from the original adventure journal. */
  sourceText: string;
}

export interface EnrichmentChapter {
  chapterName: string;
  loreJournalId: string;
  scenes: EnrichmentScene[];
}

/**
 * Pure state machine for the wizard's chapter-by-chapter map enrichment pass.
 *
 * Flow per chapter: pre_chapter (user selects images) → running (batch AI calls) → next chapter.
 * No Foundry globals, no AI calls — only tracks state and exposes clean transition methods.
 */
export class EnrichmentPassRunner {
  private _chapters: EnrichmentChapter[] = [];
  private _currentChapterIdx = 0;
  private _phase: EnrichmentPhase = 'complete';
  private _log: string[] = [];
  private _enrichedCount = 0;
  private _runQueue: Array<{ scene: EnrichmentScene; imageUrl: string }> = [];
  private _runningIdx = 0;
  private _error: string | null = null;

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get phase(): EnrichmentPhase {
    return this._phase;
  }
  get currentChapter(): EnrichmentChapter | undefined {
    return this._chapters[this._currentChapterIdx];
  }
  get currentChapterIdx(): number {
    return this._currentChapterIdx;
  }
  get totalChapters(): number {
    return this._chapters.length;
  }
  get log(): string[] {
    return this._log;
  }
  get enrichedCount(): number {
    return this._enrichedCount;
  }
  get error(): string | null {
    return this._error;
  }
  get currentRunningScene(): { scene: EnrichmentScene; imageUrl: string } | undefined {
    return this._runQueue[this._runningIdx];
  }
  get runningIdx(): number {
    return this._runningIdx;
  }
  get runningTotal(): number {
    return this._runQueue.length;
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  start(chapters: EnrichmentChapter[]): void {
    this._chapters = chapters;
    this._currentChapterIdx = 0;
    this._phase = chapters.length > 0 ? 'pre_chapter' : 'complete';
    this._log = [];
    this._enrichedCount = 0;
    this._error = null;
    this._runQueue = [];
    this._runningIdx = 0;
  }

  skipChapter(): void {
    this._error = null;
    this._advanceChapter();
  }

  /** Build the run queue from the user's image selections and switch to running phase. */
  beginChapterRun(selections: Record<string, string>): void {
    const chapter = this.currentChapter;
    if (!chapter) return;
    this._runQueue = chapter.scenes
      .filter((s) => !!selections[s.sceneName])
      .map((s) => ({ scene: s, imageUrl: selections[s.sceneName] }));
    this._runningIdx = 0;
    this._log = [];
    this._error = null;
    this._phase = this._runQueue.length > 0 ? 'running' : 'pre_chapter';
  }

  sceneComplete(): void {
    this._enrichedCount++;
    this._runningIdx++;
    this._error = null;
    if (this._runningIdx >= this._runQueue.length) {
      this._phase = 'post_chapter';
    }
  }

  sceneFailed(error: string): void {
    this._error = error;
    this._log.push(`  ✗ ${error}`);
    this._runningIdx++;
    if (this._runningIdx >= this._runQueue.length) {
      this._phase = 'post_chapter';
    }
  }

  continueToNextChapter(): void {
    this._error = null;
    this._advanceChapter();
  }

  addLogLine(line: string): void {
    this._log.push(line);
  }

  stopEarly(): void {
    this._phase = 'complete';
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _advanceChapter(): void {
    this._currentChapterIdx++;
    this._runQueue = [];
    this._runningIdx = 0;
    this._error = null;
    this._phase = this._currentChapterIdx < this._chapters.length ? 'pre_chapter' : 'complete';
  }
}
