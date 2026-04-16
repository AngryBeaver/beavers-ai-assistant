import {
  LORE_INDEX_JOURNAL_NAME,
  MODULE_FOLDER_NAME,
  NAMESPACE,
  SETTINGS,
  DEFAULTS,
} from '../definitions.js';
import type { AiProvider } from '../definitions.js';
import { AiService } from '../services/AiService.js';
import type { CallOptions } from '../services/AiService.js';
import {
  ChapterCandidate,
  ChapterDetector,
  ChapterRole,
  flagIntroCandidate,
  GameAccessor,
} from '../modules/ChapterDetector.js';
import { LoreIndexBuilder } from '../modules/LoreIndexBuilder.js';
import { IndexingPassRunner } from '../modules/IndexingPassRunner.js';
import { EnrichmentPassRunner } from '../modules/EnrichmentPassRunner.js';
import type {
  LocationItem,
  WizardStep,
  IndexStatus,
  ModelContext,
  IndexingCtx,
  EnrichmentCtx,
  WizardContext,
  ChapterCandidateView,
} from './LoreIndexWizard.types.js';

// ---------------------------------------------------------------------------
// Foundry GameAccessor implementation
// ---------------------------------------------------------------------------

function makeFoundryGameAccessor(): GameAccessor {
  return {
    getFolder: (id) => (game.folders as any)?.get(id) ?? null,

    getSubfolders: (parentId) => {
      const items: any[] =
        (game.folders as any)?.filter(
          (f: any) => f.folder?.id === parentId && f.type === 'JournalEntry',
        ) ?? [];
      return items.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    },

    getJournal: (id) => (game.journal as any)?.get(id) ?? null,

    getJournalsInFolder: (folderId) => {
      const items: any[] =
        (game.journal as any)?.filter((j: any) => j.folder?.id === folderId) ?? [];
      return items.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    },
  };
}

// ---------------------------------------------------------------------------
// LoreIndexWizard
// ---------------------------------------------------------------------------

/**
 * Guided wizard for building and maintaining the lore index.
 *
 * Step order: location → (mixed) → chapters → model → indexing pass
 *
 * Each step has its own Handlebars template declared in PARTS.
 * Only the active step's part is rendered on each transition.
 * Indexing pass state is managed by {@link IndexingPassRunner}.
 */
export class LoreIndexWizard extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-lore-index-wizard',
    window: { title: 'Lore Index Wizard', resizable: true },
    position: { width: 540 },
    actions: {
      continueFromLocation: LoreIndexWizard._onContinueFromLocation,
      backToLocation: LoreIndexWizard._onBackToLocation,
      useMixedFolders: LoreIndexWizard._onUseMixedFolders,
      useMixedJournals: LoreIndexWizard._onUseMixedJournals,
      useMixedBoth: LoreIndexWizard._onUseMixedBoth,
      confirmChapters: LoreIndexWizard._onConfirmChapters,
      backToChapters: LoreIndexWizard._onBackToChapters,
      refreshModels: LoreIndexWizard._onRefreshModels,
      startIndexing: LoreIndexWizard._onStartIndexing,
      // Indexing pass
      cancelIndexing: LoreIndexWizard._onCancelIndexing,
      indexThisChapter: LoreIndexWizard._onIndexThisChapter,
      rebuildChapter: LoreIndexWizard._onRebuildChapter,
      skipThisChapter: LoreIndexWizard._onSkipThisChapter,
      continueIndexing: LoreIndexWizard._onContinueIndexing,
      skipNextChapter: LoreIndexWizard._onSkipNextChapter,
      stopIndexing: LoreIndexWizard._onStopIndexing,
      generateOverview: LoreIndexWizard._onGenerateOverview,
      finishWizard: LoreIndexWizard._onFinishWizard,
      continueToEnrichment: LoreIndexWizard._onContinueToEnrichment,
      goToEnrichmentFromLocation: LoreIndexWizard._onGoToEnrichmentFromLocation,
      // Vision model step
      backFromVisionModel: LoreIndexWizard._onBackFromVisionModel,
      startEnrichment: LoreIndexWizard._onStartEnrichment,
      // Enrichment pass
      enrichReplaceScene: LoreIndexWizard._onEnrichReplaceScene,
      enrichAddScene: LoreIndexWizard._onEnrichAddScene,
      enrichSkipScene: LoreIndexWizard._onEnrichSkipScene,
      stopEnrichment: LoreIndexWizard._onStopEnrichment,
      finishEnrichment: LoreIndexWizard._onFinishEnrichment,
    },
  };

  static PARTS = {
    location: { template: `modules/${NAMESPACE}/templates/wizard/location.hbs` },
    mixed: { template: `modules/${NAMESPACE}/templates/wizard/mixed.hbs` },
    chapters: { template: `modules/${NAMESPACE}/templates/wizard/chapters.hbs` },
    model: { template: `modules/${NAMESPACE}/templates/wizard/model.hbs` },
    indexing: { template: `modules/${NAMESPACE}/templates/wizard/indexing.hbs` },
    enriching: { template: `modules/${NAMESPACE}/templates/wizard/enriching.hbs` },
  };

  private static _instance: LoreIndexWizard | null = null;

  // Wizard navigation state
  private _step: WizardStep = 'location';
  private _selectedLocation: LocationItem | null = null;
  private _indexStatus: IndexStatus = 'none';
  private _chapters: ChapterCandidate[] = [];
  private _mixedFolders: ChapterCandidate[] = [];
  private _mixedJournals: ChapterCandidate[] = [];

  // Model step state
  private _modelContext: ModelContext = 'indexing';
  private _selectedProvider: AiProvider = DEFAULTS.AI_PROVIDER;
  private _selectedModel: string = '';
  private _availableModels: string[] = [];
  private _modelFetchError: boolean = false;
  private _selectedReasoningEffort: string = '';

  // Indexing pass state — managed by the runner
  private readonly _runner = new IndexingPassRunner();

  // Enrichment pass state
  private readonly _enrichmentRunner = new EnrichmentPassRunner();
  private _enrichmentSelectedImageUrl = '';
  private _enrichmentEntryPoint: 'indexing' | 'location' = 'indexing';
  private _estimatedEnrichmentScenes = 0;

  // Active AI call abort controller
  private _abortController: AbortController | null = null;

  private readonly _detector = new ChapterDetector(makeFoundryGameAccessor());

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  static open(): void {
    if (!LoreIndexWizard._instance) {
      LoreIndexWizard._instance = new LoreIndexWizard();
    }
    LoreIndexWizard._instance.render({ force: true });
  }

  async close(options?: object): Promise<this> {
    LoreIndexWizard._instance = null;
    return super.close(options);
  }

  /** Hide all part containers except the active step after every render. */
  protected async _onRender(_context: WizardContext, _options: object): Promise<void> {
    for (const partId of Object.keys(LoreIndexWizard.PARTS)) {
      const el = this.element.querySelector(
        `[data-application-part="${partId}"]`,
      ) as HTMLElement | null;
      if (el) el.style.display = partId === this._step ? '' : 'none';
    }

    if (this._step === 'location') this._setupLocationBadge();
    if (this._step === 'chapters') this._setupChapterDragDrop();
    if (this._step === 'model') this._setupModelListeners();
    if (this._step === 'indexing' && this._runner.phase === 'overview') {
      void this._runIndexingOverview();
    }
    if (this._step === 'enriching' && this._enrichmentRunner.phase === 'pre_scene') {
      this._setupEnrichingImageListeners();
    }
  }

  // ---------------------------------------------------------------------------
  // Location step — live index-status badge
  // ---------------------------------------------------------------------------

  private _setupLocationBadge(): void {
    const select = this.element.querySelector<HTMLSelectElement>('#wizard-location');
    const badge = this.element.querySelector<HTMLElement>('#wizard-index-status');
    const continueBtn = this.element.querySelector<HTMLButtonElement>('#wizard-continue-btn');
    const enrichmentBtn = this.element.querySelector<HTMLButtonElement>('#wizard-enrichment-btn');
    if (!select) return;

    const hasGlobalIndex = enrichmentBtn?.dataset.hasGlobalIndex === 'true';

    const update = (): void => {
      const opt = select.options[select.selectedIndex];
      const hasValue = !!opt?.value;

      if (continueBtn) continueBtn.disabled = !hasValue;

      if (!hasValue) {
        if (badge) badge.innerHTML = '';
        if (enrichmentBtn && !hasGlobalIndex) enrichmentBtn.style.display = 'none';
        return;
      }

      const hasIndex = this._detectIndexStatusFor() === 'exists';

      if (badge) {
        badge.innerHTML = hasIndex
          ? `<div class="lw-alert lw-alert--info" style="margin-top:.75rem">` +
            `<i class="fas fa-circle-info"></i> Continuing will rebuild the existing index.</div>`
          : `<div class="lw-alert lw-alert--info" style="margin-top:.75rem">` +
            `<i class="fas fa-circle-info"></i> No lore index found. Continuing will build one.</div>`;
      }

      if (continueBtn) {
        continueBtn.innerHTML = hasIndex
          ? 'Rebuild <i class="fas fa-arrow-right"></i>'
          : 'Continue <i class="fas fa-arrow-right"></i>';
      }

      if (enrichmentBtn) {
        enrichmentBtn.style.display = hasIndex ? '' : 'none';
      }
    };

    select.addEventListener('change', update);
    update();
  }

  // ---------------------------------------------------------------------------
  // Chapters step — drag-and-drop reordering
  // ---------------------------------------------------------------------------

  private _setupChapterDragDrop(): void {
    const rows = Array.from(this.element.querySelectorAll<HTMLElement>('[data-chapter-id]'));
    let draggedId: string | null = null;

    for (const row of rows) {
      row.addEventListener('dragstart', (e) => {
        draggedId = row.dataset.chapterId ?? null;
        (e as DragEvent).dataTransfer?.setData('text/plain', draggedId ?? '');
        row.style.opacity = '0.4';
      });

      row.addEventListener('dragend', () => {
        row.style.opacity = '';
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.style.outline = '2px solid var(--color-border-highlight, #ff6400)';
      });

      row.addEventListener('dragleave', () => {
        row.style.outline = '';
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.style.outline = '';
        const targetId = row.dataset.chapterId;
        if (!draggedId || !targetId || draggedId === targetId) return;

        this._syncRolesFromDOM();

        const fromIdx = this._chapters.findIndex((c) => c.id === draggedId);
        const toIdx = this._chapters.findIndex((c) => c.id === targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = this._chapters.splice(fromIdx, 1);
          this._chapters.splice(toIdx, 0, moved);
          this.render({ force: true });
        }
        draggedId = null;
      });
    }
  }

  private _syncRolesFromDOM(): void {
    for (const chapter of this._chapters) {
      const checked = this.element?.querySelector(
        `input[name="chapter-role-${CSS.escape(chapter.id)}"]:checked`,
      ) as HTMLInputElement | null;
      if (checked) chapter.role = checked.value as ChapterRole;
    }
  }

  // ---------------------------------------------------------------------------
  // Model step — provider radio + model dropdown listeners
  // ---------------------------------------------------------------------------

  private _setupModelListeners(): void {
    const radios = Array.from(
      this.element.querySelectorAll<HTMLInputElement>('input[name="wizard-provider"]'),
    );
    for (const radio of radios) {
      radio.addEventListener('change', async () => {
        this._selectedProvider = radio.value as AiProvider;
        if (
          this._selectedProvider === 'local-ai' &&
          this._availableModels.length === 0 &&
          !this._modelFetchError
        ) {
          await this._fetchModels();
        }
        this.render({ force: true });
      });
    }

    const modelSelect = this.element.querySelector<HTMLSelectElement>('#wizard-model');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        this._selectedModel = modelSelect.value;
      });
    }

    const reasoningSelect = this.element.querySelector<HTMLSelectElement>('#wizard-reasoning-effort');
    if (reasoningSelect) {
      reasoningSelect.addEventListener('change', () => {
        this._selectedReasoningEffort = reasoningSelect.value;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Enriching step — image radio listeners
  // ---------------------------------------------------------------------------

  private _setupEnrichingImageListeners(): void {
    const radios = Array.from(
      this.element.querySelectorAll<HTMLInputElement>('input[name="enrichment-image"]'),
    );
    // Auto-select the first image
    if (radios.length > 0 && !radios.some((r) => r.checked)) {
      radios[0].checked = true;
      this._enrichmentSelectedImageUrl = radios[0].value;
    }
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        this._enrichmentSelectedImageUrl = radio.value;
        // Re-render to update disabled state of action buttons
        this.render({ force: true });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  async _prepareContext(_options: object): Promise<WizardContext> {
    const inputTokens = this._estimateInputTokens();
    const outputTokens = this._estimateOutputTokens();
    return {
      phaseTitle: this._phaseTitle(),
      hasAnyLoreIndex: this._hasAnyLoreIndex(),
      locationName: this._selectedLocation?.name ?? '',
      locationType: this._selectedLocation?.type ?? 'folder',
      locations: this._collectLocations(),
      mixedFolders: this._mixedFolders,
      mixedJournals: this._mixedJournals,
      chapters: this._chapters.map(
        (c): ChapterCandidateView => ({
          ...c,
          roleIsOverview: c.role === 'overview',
          roleIsChapter: c.role === 'chapter',
          roleIsSkip: c.role === 'skip',
          showOverviewOption: true,
        }),
      ),
      modelContext: this._modelContext,
      selectedProvider: this._selectedProvider,
      selectedModel: this._selectedModel,
      selectedReasoningEffort: this._selectedReasoningEffort,
      availableModels: this._availableModels,
      modelFetchError: this._modelFetchError,
      estimatedInputTokensFormatted: inputTokens.toLocaleString(),
      estimatedOutputTokensFormatted: outputTokens.toLocaleString(),
      claudeCostEstimate: this._claudeCostEstimate(inputTokens, outputTokens),
      estimatedEnrichmentScenes: this._estimatedEnrichmentScenes,
      visionImageTokensPerScene: LoreIndexWizard._VISION_IMAGE_TOKENS,
      visionTextTokensPerScene: LoreIndexWizard._VISION_TEXT_TOKENS,
      visionOutputTokensPerScene: LoreIndexWizard._VISION_OUTPUT_TOKENS,
      claudeVisionCostPerScene: this._claudeVisionCostPerScene(),
      claudeVisionCostEstimate: this._claudeVisionCostEstimate(this._estimatedEnrichmentScenes),
      hasClaudeApiKey: this._hasClaudeApiKey(),
      localAiUrl: this._localAiUrl(),
      indexing: this._buildIndexingCtx(),
      enrichment: this._buildEnrichmentCtx(),
    };
  }

  private _phaseTitle(): string {
    const name = this._selectedLocation?.name ?? '';
    const suffix = name ? `: ${name}` : '';
    if (this._step === 'location') return '';
    if (this._step === 'enriching' || (this._step === 'model' && this._modelContext === 'vision')) {
      return `Map Enrichment${suffix}`;
    }
    return `Indexing${suffix}`;
  }

  private _hasAnyLoreIndex(): boolean {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    if (!modFolder) return false;
    const loreFolder = (game.folders as any)?.find(
      (f: any) =>
        f.name === LORE_INDEX_JOURNAL_NAME &&
        f.type === 'JournalEntry' &&
        f.folder?.id === modFolder.id,
    );
    if (!loreFolder) return false;
    return !!(game.journal as any)?.some((j: any) => j.folder?.id === loreFolder.id);
  }

  private _buildIndexingCtx(): IndexingCtx {
    const r = this._runner;
    const phase = r.phase;
    return {
      phase,
      chapterName: r.currentChapter?.name ?? '',
      chapterTokensFormatted: (r.currentChapter?.tokens ?? 0).toLocaleString(),
      chapterIdx: r.currentIdx + 1,
      totalChapters: r.totalChapters,
      log: r.log,
      justCompleted: r.justCompleted,
      nextChapterName: r.nextChapter?.name ?? '',
      hasNextChapter: r.hasNextChapter,
      completedCount: r.completedCount,
      sceneCount: r.sceneCount,
      error: r.error,
      isPreChapter: phase === 'pre_chapter',
      isAlreadyIndexed: phase === 'already_indexed',
      isRunning: phase === 'running',
      isBetween: phase === 'between',
      isOverview: phase === 'overview',
      isComplete: phase === 'complete',
    };
  }

  private _buildEnrichmentCtx(): EnrichmentCtx {
    const r = this._enrichmentRunner;
    const scene = r.currentScene;
    return {
      phase: r.phase,
      sceneName: scene?.sceneName ?? '',
      chapterName: scene?.chapterName ?? '',
      images: scene?.images ?? [],
      hasConnections: scene?.hasConnections ?? false,
      sceneIdx: r.currentIdx + 1,
      totalScenes: r.totalScenes,
      log: r.log,
      enrichedCount: r.enrichedCount,
      error: r.error,
      selectedImageUrl: this._enrichmentSelectedImageUrl,
      hasSelectedImage: !!this._enrichmentSelectedImageUrl,
      isPreScene: r.phase === 'pre_scene',
      isRunning: r.phase === 'running',
      isComplete: r.phase === 'complete',
    };
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private _goToStep(step: WizardStep): void {
    this._step = step;
    this.render({ force: true });
  }

  // ---------------------------------------------------------------------------
  // Location helpers
  // ---------------------------------------------------------------------------

  private _collectLocations(): LocationItem[] {
    const folders: LocationItem[] = (
      (game.folders as any)?.filter((f: any) => f.type === 'JournalEntry' && !f.folder) ?? []
    ).map((f: any) => ({ id: f.id as string, name: f.name as string, type: 'folder' as const }));

    const journals: LocationItem[] = (
      (game.journal as any)?.filter((j: any) => !j.folder) ?? []
    ).map((j: any) => ({ id: j.id as string, name: j.name as string, type: 'journal' as const }));

    return [...folders, ...journals];
  }

  private _detectIndexStatusFor(): IndexStatus {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    if (!modFolder) return 'none';
    const loreFolder = (game.folders as any)?.find(
      (f: any) =>
        f.name === LORE_INDEX_JOURNAL_NAME &&
        f.type === 'JournalEntry' &&
        f.folder?.id === modFolder.id,
    );
    if (!loreFolder) return 'none';
    const hasJournals = (game.journal as any)?.some(
      (j: any) => j.folder?.id === loreFolder.id,
    );
    return hasJournals ? 'exists' : 'none';
  }

  private _resolveLocationName(id: string, type: 'folder' | 'journal'): string {
    if (type === 'folder') return (game.folders as any)?.get(id)?.name ?? id;
    return (game.journal as any)?.get(id)?.name ?? id;
  }

  // ---------------------------------------------------------------------------
  // Estimate helpers
  // ---------------------------------------------------------------------------

  private _estimateInputTokens(): number {
    return this._chapters.filter((c) => c.role !== 'skip').reduce((sum, c) => sum + c.tokens, 0);
  }

  private _estimateOutputTokens(): number {
    return this._chapters.filter((c) => c.role !== 'skip').length * 4096;
  }
  // Image: ~12 tiles × 1,601 tokens (large map ~2000×1500 resized to 1568×1176)
  // Scene text: full lore-index scene page, typically ~1,500 tokens
  // Output: max_tokens cap on connections block
  private static readonly _VISION_IMAGE_TOKENS = 20_000;
  private static readonly _VISION_TEXT_TOKENS = 1_500;
  private static readonly _VISION_OUTPUT_TOKENS = 1_024;

  private _claudeCostEstimate(inputTokens: number, outputTokens: number): string {
    return AiService.get('claude').estimateCost(inputTokens, outputTokens);
  }

  private _claudeVisionCostPerScene(): string {
    return AiService.get('claude').estimateCost(
      LoreIndexWizard._VISION_IMAGE_TOKENS + LoreIndexWizard._VISION_TEXT_TOKENS,
      LoreIndexWizard._VISION_OUTPUT_TOKENS,
    );
  }

  private _claudeVisionCostEstimate(sceneCount: number): string {
    if (sceneCount === 0) return '—';
    return AiService.get('claude').estimateCost(
      sceneCount * (LoreIndexWizard._VISION_IMAGE_TOKENS + LoreIndexWizard._VISION_TEXT_TOKENS),
      sceneCount * LoreIndexWizard._VISION_OUTPUT_TOKENS,
    );
  }

  // ---------------------------------------------------------------------------
  // Settings helpers
  // ---------------------------------------------------------------------------

  private _hasClaudeApiKey(): boolean {
    const key = (game.settings as any)?.get(NAMESPACE, SETTINGS.CLAUDE_API_KEY) as
      | string
      | undefined;
    return !!key?.trim();
  }

  private _localAiUrl(): string {
    return (
      ((game.settings as any)?.get(NAMESPACE, SETTINGS.LOCAL_AI_URL) as string) ||
      DEFAULTS.LOCAL_AI_URL
    );
  }

  // ---------------------------------------------------------------------------
  // Chapter detection
  // ---------------------------------------------------------------------------

  private _runChapterDetection(): void {
    if (!this._selectedLocation) return;

    const result = this._detector.detect(this._selectedLocation.id, this._selectedLocation.type);

    if (result.isMixed) {
      this._mixedFolders = result.subfolders;
      this._mixedJournals = result.journals;
      this._goToStep('mixed');
      return;
    }

    this._chapters = result.candidates;
    this._goToStep('chapters');
  }

  private _applyMixedChoice(candidates: ChapterCandidate[]): void {
    flagIntroCandidate(candidates);
    this._chapters = candidates;
    this._goToStep('chapters');
  }

  // ---------------------------------------------------------------------------
  // Model fetch
  // ---------------------------------------------------------------------------

  private async _fetchModels(): Promise<void> {
    this._modelFetchError = false;
    try {
      this._availableModels = await AiService.get(this._selectedProvider).fetchModels();
      if (this._selectedModel && !this._availableModels.includes(this._selectedModel)) {
        this._selectedModel = '';
      }
      if (!this._selectedModel && this._availableModels.length > 0) {
        this._selectedModel = this._availableModels[0];
      }
    } catch {
      this._modelFetchError = true;
      this._availableModels = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — navigation
  // ---------------------------------------------------------------------------

  static async _onContinueFromLocation(this: LoreIndexWizard): Promise<void> {
    const select = this.element.querySelector('#wizard-location') as HTMLSelectElement;
    const opt = select?.options[select.selectedIndex];
    if (!opt?.value) {
      ui.notifications.warn('Select an adventure location to continue.');
      return;
    }

    const type = (opt.dataset.type ?? 'folder') as 'folder' | 'journal';
    this._selectedLocation = {
      id: opt.value,
      type,
      name: this._resolveLocationName(opt.value, type),
    };
    this._indexStatus = this._detectIndexStatusFor();
    this._runChapterDetection();
  }

  static async _onBackToLocation(this: LoreIndexWizard): Promise<void> {
    this._goToStep('location');
  }

  static async _onUseMixedFolders(this: LoreIndexWizard): Promise<void> {
    this._applyMixedChoice(this._mixedFolders);
  }

  static async _onUseMixedJournals(this: LoreIndexWizard): Promise<void> {
    this._applyMixedChoice(this._mixedJournals);
  }

  static async _onUseMixedBoth(this: LoreIndexWizard): Promise<void> {
    this._applyMixedChoice([...this._mixedFolders, ...this._mixedJournals]);
  }

  static async _onConfirmChapters(this: LoreIndexWizard): Promise<void> {
    this._syncRolesFromDOM();

    const active = this._chapters.filter((c) => c.role !== 'skip');
    if (active.length === 0) {
      ui.notifications.warn('Select at least one chapter to index.');
      return;
    }

    this._selectedProvider =
      ((game.settings as any)?.get(NAMESPACE, SETTINGS.AI_PROVIDER) as AiProvider) ||
      DEFAULTS.AI_PROVIDER;

    if (
      this._selectedProvider === 'local-ai' &&
      this._availableModels.length === 0 &&
      !this._modelFetchError
    ) {
      await this._fetchModels();
    }

    this._goToStep('model');
  }

  static async _onBackToChapters(this: LoreIndexWizard): Promise<void> {
    this._goToStep('chapters');
  }

  static async _onRefreshModels(this: LoreIndexWizard): Promise<void> {
    await this._fetchModels();
    this.render({ force: true });
  }

  // ---------------------------------------------------------------------------
  // Actions — indexing pass
  // ---------------------------------------------------------------------------

  static async _onStartIndexing(this: LoreIndexWizard): Promise<void> {
    const queue = this._chapters.filter((c) => c.role === 'chapter');
    const overviewChapter = this._chapters.find((c) => c.role === 'overview') ?? null;

    if (queue.length === 0) {
      (ui as any).notifications.warn(
        'No chapters to index. Set at least one chapter role to "Chapter".',
      );
      return;
    }

    this._runner.start(queue, overviewChapter);
    this._goToStep('indexing');
  }

  static async _onIndexThisChapter(this: LoreIndexWizard): Promise<void> {
    const chapter = this._runner.currentChapter;
    if (!chapter) return;

    if (this._createBuilder().isChapterIndexed(chapter.name)) {
      this._runner.markAlreadyIndexed();
      this.render({ force: true });
      return;
    }

    await this._runChapterIndexing();
  }

  static async _onRebuildChapter(this: LoreIndexWizard): Promise<void> {
    await this._runChapterIndexing();
  }

  static async _onSkipThisChapter(this: LoreIndexWizard): Promise<void> {
    this._runner.skipCurrent();
    this.render({ force: true });
  }

  static async _onContinueIndexing(this: LoreIndexWizard): Promise<void> {
    this._runner.continueToNext();
    this.render({ force: true });
  }

  static async _onSkipNextChapter(this: LoreIndexWizard): Promise<void> {
    this._runner.skipNext();
    this.render({ force: true });
  }

  static _onCancelIndexing(this: LoreIndexWizard): void {
    this._abortController?.abort();
  }

  static async _onStopIndexing(this: LoreIndexWizard): Promise<void> {
    this._runner.stopEarly();
    this.render({ force: true });
  }

  static async _onGenerateOverview(this: LoreIndexWizard): Promise<void> {
    this._runner.startOverview();
    this.render({ force: true });
    // _runIndexingOverview is triggered in _onRender when phase === 'overview'
  }

  static async _onFinishWizard(this: LoreIndexWizard): Promise<void> {
    await this.close();
  }

  static async _onContinueToEnrichment(this: LoreIndexWizard): Promise<void> {
    this._enrichmentEntryPoint = 'indexing';
    await LoreIndexWizard._openVisionModelStep.call(this);
  }

  static async _onGoToEnrichmentFromLocation(this: LoreIndexWizard): Promise<void> {
    const select = this.element.querySelector<HTMLSelectElement>('#wizard-location');
    const opt = select?.options[select.selectedIndex];
    if (!opt?.value) return;
    const type = (opt.dataset.type ?? 'folder') as 'folder' | 'journal';
    this._selectedLocation = {
      id: opt.value,
      type,
      name: this._resolveLocationName(opt.value, type),
    };
    this._enrichmentEntryPoint = 'location';
    await LoreIndexWizard._openVisionModelStep.call(this);
  }

  private static async _openVisionModelStep(this: LoreIndexWizard): Promise<void> {
    this._modelContext = 'vision';
    this._selectedProvider =
      ((game.settings as any)?.get(NAMESPACE, SETTINGS.AI_PROVIDER) as AiProvider) ||
      DEFAULTS.AI_PROVIDER;
    if (
      this._selectedProvider === 'local-ai' &&
      this._availableModels.length === 0 &&
      !this._modelFetchError
    ) {
      await this._fetchModels();
    }
    try {
      const scenes = this._createBuilder().collectEnrichmentScenes(
        this._chapters,
        this._selectedLocation!.id,
        this._selectedLocation!.type,
      );
      this._estimatedEnrichmentScenes = scenes.length;
    } catch {
      this._estimatedEnrichmentScenes = 0;
    }
    this._goToStep('model');
  }

  static async _onBackFromVisionModel(this: LoreIndexWizard): Promise<void> {
    this._modelContext = 'indexing';
    this._goToStep(this._enrichmentEntryPoint === 'location' ? 'location' : 'indexing');
  }

  static async _onStartEnrichment(this: LoreIndexWizard): Promise<void> {
    if (!this._selectedLocation) {
      (ui as any).notifications.warn('No adventure location selected.');
      return;
    }
    const scenes = this._createBuilder().collectEnrichmentScenes(
      this._chapters,
      this._selectedLocation.id,
      this._selectedLocation.type,
    );
    this._enrichmentSelectedImageUrl = '';
    this._enrichmentRunner.start(scenes);
    this._goToStep('enriching');
  }

  static async _onEnrichReplaceScene(this: LoreIndexWizard): Promise<void> {
    await this._runSceneEnrichment('replace');
  }

  static async _onEnrichAddScene(this: LoreIndexWizard): Promise<void> {
    await this._runSceneEnrichment('add');
  }

  static async _onEnrichSkipScene(this: LoreIndexWizard): Promise<void> {
    this._enrichmentSelectedImageUrl = '';
    this._enrichmentRunner.skipCurrent();
    this.render({ force: true });
  }

  static async _onStopEnrichment(this: LoreIndexWizard): Promise<void> {
    this._enrichmentRunner.stopEarly();
    this.render({ force: true });
  }

  static async _onFinishEnrichment(this: LoreIndexWizard): Promise<void> {
    await this.close();
  }

  // ---------------------------------------------------------------------------
  // Indexing helpers
  // ---------------------------------------------------------------------------

  private _createBuilder(): LoreIndexBuilder {
    return new LoreIndexBuilder(game as any, AiService.create(game as any, this._selectedProvider));
  }

  private _indexingCallOptions(): CallOptions {
    const opts: CallOptions = { max_tokens: 6144 };
    if (this._selectedProvider === 'local-ai' && this._selectedModel) {
      opts.model = this._selectedModel;
    }
    if (this._selectedReasoningEffort) {
      opts.reasoning_effort = this._selectedReasoningEffort;
    }
    if (this._abortController) {
      opts.signal = this._abortController.signal;
    }
    return opts;
  }

  private async _runChapterIndexing(): Promise<void> {
    const chapter = this._runner.currentChapter;
    if (!chapter) return;

    this._abortController = new AbortController();
    this._runner.beginRun();
    this.render({ force: true });

    try {
      const sceneCount = await this._createBuilder().indexChapter(
        chapter,
        this._indexingCallOptions(),
        (line) => this._addLogLine(line),
      );
      this._runner.chapterComplete(sceneCount);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        this._runner.stopEarly();
      } else {
        this._runner.chapterFailed((err as Error).message);
      }
    } finally {
      this._abortController = null;
    }

    this.render({ force: true });
  }

  private async _runIndexingOverview(): Promise<void> {
    this._abortController = new AbortController();

    try {
      const builder = this._createBuilder();
      const overviewContent = this._runner.overviewChapter
        ? builder.collectChapterContent(this._runner.overviewChapter)
        : undefined;
      await builder.indexOverview(overviewContent, this._indexingCallOptions());
      this._runner.overviewComplete();
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        this._runner.stopEarly();
      } else {
        this._runner.overviewFailed((err as Error).message);
      }
    } finally {
      this._abortController = null;
    }

    this.render({ force: true });
  }

  /** Append a log line to the runner state and update the DOM directly (no full re-render). */
  private _addLogLine(line: string): void {
    this._runner.addLogLine(line);
    const logEl = this.element?.querySelector<HTMLElement>('#indexing-log');
    if (logEl) {
      const div = document.createElement('div');
      div.textContent = line;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  private async _runSceneEnrichment(mode: 'replace' | 'add'): Promise<void> {
    const scene = this._enrichmentRunner.currentScene;
    if (!scene) return;

    const imageUrl = this._enrichmentSelectedImageUrl;
    if (!imageUrl) {
      (ui as any).notifications.warn('Select an image before enriching.');
      return;
    }

    this._abortController = new AbortController();
    this._enrichmentRunner.beginRun();
    this.render({ force: true });

    try {
      await this._createBuilder().enrichSceneWithMap(
        scene.sceneName,
        imageUrl,
        mode,
        this._indexingCallOptions(),
        (line) => this._addEnrichmentLogLine(line),
      );
      this._enrichmentSelectedImageUrl = '';
      this._enrichmentRunner.sceneComplete();
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        this._enrichmentRunner.sceneFailed('Cancelled.');
      } else {
        this._enrichmentRunner.sceneFailed((err as Error).message);
      }
    } finally {
      this._abortController = null;
    }

    this.render({ force: true });
  }

  private _addEnrichmentLogLine(line: string): void {
    this._enrichmentRunner.addLogLine(line);
    const logEl = this.element?.querySelector<HTMLElement>('#enrichment-log');
    if (logEl) {
      const div = document.createElement('div');
      div.textContent = line;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
}
