export type EnrichmentPhase = 'pre_scene' | 'running' | 'complete';

/** A map/art image candidate with a human-readable name derived from its source context. */
export interface NamedImage {
  url: string;
  /** Alt text → figcaption → nearest heading → page/journal name, in that priority order. */
  name: string;
}

export interface EnrichmentScene {
  sceneName: string;
  chapterName: string; // empty string when chapter association could not be determined
  images: NamedImage[];
  hasConnections: boolean;
}

/**
 * Pure state machine for the wizard's scene-by-scene map enrichment pass.
 *
 * No Foundry globals, no AI calls — only tracks what phase the pass is in
 * and exposes clean transition methods. Mirrors the IndexingPassRunner pattern.
 */
export class EnrichmentPassRunner {
  private _queue: EnrichmentScene[] = [];
  private _currentIdx = 0;
  private _phase: EnrichmentPhase = 'pre_scene';
  private _log: string[] = [];
  private _enrichedCount = 0;
  private _error: string | null = null;

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get phase(): EnrichmentPhase {
    return this._phase;
  }
  get currentScene(): EnrichmentScene | undefined {
    return this._queue[this._currentIdx];
  }
  get currentIdx(): number {
    return this._currentIdx;
  }
  get totalScenes(): number {
    return this._queue.length;
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

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  start(queue: EnrichmentScene[]): void {
    this._queue = queue;
    this._currentIdx = 0;
    this._phase = queue.length > 0 ? 'pre_scene' : 'complete';
    this._log = [];
    this._enrichedCount = 0;
    this._error = null;
  }

  beginRun(): void {
    this._phase = 'running';
    const scene = this.currentScene;
    this._log = [`→ Enriching scene: ${scene?.sceneName ?? ''}…`];
    this._error = null;
  }

  sceneComplete(): void {
    this._enrichedCount++;
    this._advance();
  }

  sceneFailed(error: string): void {
    this._error = error;
    this._phase = 'pre_scene';
  }

  skipCurrent(): void {
    this._advance();
  }

  stopEarly(): void {
    this._phase = 'complete';
  }

  addLogLine(line: string): void {
    this._log.push(line);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _advance(): void {
    this._currentIdx++;
    this._error = null;
    this._phase = this._currentIdx < this._queue.length ? 'pre_scene' : 'complete';
  }
}
