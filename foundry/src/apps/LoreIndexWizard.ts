import { LORE_INDEX_JOURNAL_NAME, MODULE_FOLDER_NAME, NAMESPACE } from '../definitions.js';

interface LocationItem {
  id: string;
  name: string;
  type: 'folder' | 'journal';
}

type WizardStep = 'location' | 'status';
type IndexStatus = 'none' | 'exists';

interface WizardContext {
  step: WizardStep;
  // location step
  locations: LocationItem[];
  // status step
  locationName: string;
  locationType: 'folder' | 'journal';
  indexStatus: IndexStatus;
  inputTokens: number;
  inputTokensFormatted: string;
  claudeCostEstimate: string;
}

/**
 * Guided wizard for building and maintaining the lore index.
 * Handles text indexing (Phase 1) and map enrichment (Phase 2) in a single
 * incremental flow. No indexing or vision model choices are stored as settings —
 * the wizard asks each run.
 */
export class LoreIndexWizard extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: 'beavers-lore-index-wizard',
    window: { title: 'Lore Index Wizard', resizable: false },
    position: { width: 520 },
    actions: {
      continueFromLocation: LoreIndexWizard._onContinueFromLocation,
      backToLocation: LoreIndexWizard._onBackToLocation,
      startBuild: LoreIndexWizard._onStartBuild,
      startRebuild: LoreIndexWizard._onStartRebuild,
      startEnrichment: LoreIndexWizard._onStartEnrichment,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${NAMESPACE}/templates/lore-index-wizard.hbs`,
    },
  };

  private static _instance: LoreIndexWizard | null = null;

  // Wizard state — persists across step transitions within one wizard session
  private _step: WizardStep = 'location';
  private _selectedLocation: LocationItem | null = null;
  private _indexStatus: IndexStatus = 'none';
  private _inputTokens: number = 0;

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

  async _prepareContext(_options: object): Promise<WizardContext> {
    return {
      step: this._step,
      locations: this._collectLocations(),

      locationName: this._selectedLocation?.name ?? '',
      locationType: this._selectedLocation?.type ?? 'folder',
      indexStatus: this._indexStatus,
      inputTokens: this._inputTokens,
      inputTokensFormatted: this._inputTokens.toLocaleString(),
      claudeCostEstimate: this._claudeCostEstimate(),
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
  // Data helpers
  // ---------------------------------------------------------------------------

  /**
   * Collect all root-level JournalEntry folders and root-level journals
   * (those with no parent folder) as selectable adventure locations.
   */
  private _collectLocations(): LocationItem[] {
    const folders: LocationItem[] = (
      (game.folders as any)?.filter(
        (f: any) => f.type === 'JournalEntry' && !f.folder,
      ) ?? []
    ).map((f: any) => ({ id: f.id as string, name: f.name as string, type: 'folder' as const }));

    const journals: LocationItem[] = (
      (game.journal as any)?.filter((j: any) => !j.folder) ?? []
    ).map((j: any) => ({ id: j.id as string, name: j.name as string, type: 'journal' as const }));

    return [...folders, ...journals];
  }

  /**
   * Check whether a lore index already exists for the current adventure location.
   * Returns 'none' if the index journal is absent or empty, 'exists' otherwise.
   * Granular partial/full detection is deferred to Task 0.3 (chapter detection).
   */
  private _detectIndexStatus(): IndexStatus {
    const modFolder = (game.folders as any)?.find(
      (f: any) => f.name === MODULE_FOLDER_NAME && f.type === 'JournalEntry',
    );
    if (!modFolder) return 'none';

    const indexJournal = (game.journal as any)?.find(
      (j: any) => j.folder?.id === modFolder.id && j.name === LORE_INDEX_JOURNAL_NAME,
    );
    if (!indexJournal || indexJournal.pages.size === 0) return 'none';

    return 'exists';
  }

  private _resolveLocationById(id: string, type: 'folder' | 'journal'): string {
    if (type === 'folder') {
      return (game.folders as any)?.get(id)?.name ?? id;
    }
    return (game.journal as any)?.get(id)?.name ?? id;
  }

  /**
   * Walk the selected location and count plain-text characters across all
   * journal pages. HTML tags are stripped before counting so they don't inflate
   * the estimate.
   */
  private _estimateInputTokens(): number {
    if (!this._selectedLocation) return 0;
    const chars =
      this._selectedLocation.type === 'folder'
        ? this._charsFromFolder(this._selectedLocation.id)
        : this._charsFromJournal(this._selectedLocation.id);
    return Math.ceil(chars / 4);
  }

  private _charsFromFolder(folderId: string): number {
    let total = 0;
    const journals =
      (game.journal as any)?.filter((j: any) => j.folder?.id === folderId) ?? [];
    for (const j of journals) total += this._charsFromJournal(j.id);

    const subfolders =
      (game.folders as any)?.filter(
        (f: any) => f.folder?.id === folderId && f.type === 'JournalEntry',
      ) ?? [];
    for (const sf of subfolders) total += this._charsFromFolder(sf.id);
    return total;
  }

  private _charsFromJournal(journalId: string): number {
    const journal = (game.journal as any)?.get(journalId);
    if (!journal) return 0;
    let total = 0;
    for (const page of journal.pages.contents) {
      const raw: string = page.text?.content ?? '';
      total += raw.replace(/<[^>]*>/g, '').length;
    }
    return total;
  }

  /**
   * Estimate Claude Sonnet input cost for this indexing run.
   * Rate: $3/1M input tokens (Sonnet 4.x, approximate).
   * Output cost varies by chapter count and is shown per-chapter during the indexing pass.
   */
  private _claudeCostEstimate(): string {
    if (this._inputTokens === 0) return '—';
    const inputCost = (this._inputTokens / 1_000_000) * 3;
    if (inputCost < 0.01) return '< $0.01';
    return `~$${inputCost.toFixed(2)}`;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  static async _onContinueFromLocation(this: LoreIndexWizard): Promise<void> {
    const select = this.element.querySelector('#wizard-location') as HTMLSelectElement;

    const selectedOption = select?.options[select.selectedIndex];
    if (!selectedOption?.value) {
      ui.notifications.warn('Select an adventure location to continue.');
      return;
    }

    const id = selectedOption.value;
    const type = (selectedOption.dataset.type ?? 'folder') as 'folder' | 'journal';
    const name = this._resolveLocationById(id, type);

    this._selectedLocation = { id, name, type };
    this._indexStatus = this._detectIndexStatus();
    this._inputTokens = this._estimateInputTokens();
    this._goToStep('status');
  }

  static async _onBackToLocation(this: LoreIndexWizard): Promise<void> {
    this._goToStep('location');
  }

  static async _onStartBuild(this: LoreIndexWizard): Promise<void> {
    // Implemented in Task 0.3 (chapter detection)
    ui.notifications.info('Chapter detection — coming in Task 0.3.');
  }

  static async _onStartRebuild(this: LoreIndexWizard): Promise<void> {
    // Implemented in Task 0.3 (chapter detection)
    ui.notifications.info('Chapter detection — coming in Task 0.3.');
  }

  static async _onStartEnrichment(this: LoreIndexWizard): Promise<void> {
    // Implemented in Task 0.6 (map enrichment pass)
    ui.notifications.info('Map enrichment — coming in Task 0.6.');
  }
}