import type { AiProvider } from '../definitions.js';
import type { ChapterCandidate } from '../modules/ChapterDetector.js';
import type { IndexingPhase } from '../modules/IndexingPassRunner.js';
import type { EnrichmentPhase, NamedImage } from '../modules/EnrichmentPassRunner.js';

// ---------------------------------------------------------------------------
// Location step
// ---------------------------------------------------------------------------

export interface LocationItem {
  id: string;
  name: string;
  type: 'folder' | 'journal';
}

// ---------------------------------------------------------------------------
// Chapters step
// ---------------------------------------------------------------------------

/** ChapterCandidate extended with pre-computed booleans for Handlebars. */
export interface ChapterCandidateView extends ChapterCandidate {
  roleIsOverview: boolean;
  roleIsChapter: boolean;
  roleIsSkip: boolean;
  showOverviewOption: boolean;
}

// ---------------------------------------------------------------------------
// Wizard navigation
// ---------------------------------------------------------------------------

export type WizardStep = 'location' | 'mixed' | 'chapters' | 'model' | 'indexing' | 'enriching';
export type IndexStatus = 'none' | 'exists';
export type ModelContext = 'indexing' | 'vision';

// ---------------------------------------------------------------------------
// Indexing step view model
// ---------------------------------------------------------------------------

/** Read-only view model passed to indexing.hbs. Built from IndexingPassRunner state. */
export interface IndexingCtx {
  phase: IndexingPhase;
  chapterName: string;
  chapterTokensFormatted: string;
  chapterIdx: number;
  totalChapters: number;
  log: string[];
  justCompleted: string;
  nextChapterName: string;
  hasNextChapter: boolean;
  completedCount: number;
  sceneCount: number;
  error: string | null;
  // Phase booleans for Handlebars {{#if}} conditionals
  isPreChapter: boolean;
  isAlreadyIndexed: boolean;
  isRunning: boolean;
  isBetween: boolean;
  isOverview: boolean;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Enrichment step view model
// ---------------------------------------------------------------------------

export interface EnrichmentCtx {
  phase: EnrichmentPhase;
  sceneName: string;
  chapterName: string;
  images: NamedImage[];
  hasConnections: boolean;
  sceneIdx: number;
  totalScenes: number;
  log: string[];
  enrichedCount: number;
  error: string | null;
  selectedImageUrl: string;
  hasSelectedImage: boolean;
  isPreScene: boolean;
  isRunning: boolean;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Full wizard context (passed to all step templates)
// ---------------------------------------------------------------------------

export interface WizardContext {
  // Common
  phaseTitle: string; // "Indexing: Adventure Name" or "Map Enrichment: Adventure Name"
  hasAnyLoreIndex: boolean; // true if the lore index journal exists with any pages
  locationName: string;
  locationType: 'folder' | 'journal';
  // Location step
  locations: LocationItem[];
  // Mixed step
  mixedFolders: ChapterCandidate[];
  mixedJournals: ChapterCandidate[];
  // Chapters step
  chapters: ChapterCandidateView[];
  // Model step
  modelContext: ModelContext;
  selectedProvider: AiProvider;
  selectedModel: string;
  selectedReasoningEffort: string;
  availableModels: string[];
  modelFetchError: boolean;
  estimatedInputTokensFormatted: string;
  estimatedOutputTokensFormatted: string;
  claudeCostEstimate: string;
  estimatedEnrichmentScenes: number;
  visionImageTokensPerScene: number;
  visionTextTokensPerScene: number;
  visionOutputTokensPerScene: number;
  claudeVisionCostPerScene: string;
  claudeVisionCostEstimate: string;
  hasClaudeApiKey: boolean;
  localAiUrl: string;
  // Indexing step
  indexing: IndexingCtx;
  // Enrichment step
  enrichment: EnrichmentCtx;
}
