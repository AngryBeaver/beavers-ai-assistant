import type { AiProvider } from '../definitions.js';
import type { ParsedChapter, ChapterRole, ParserFormField } from '../modules/AdventureParser.js';
import type { JournalChapterData } from '../modules/JournalParser/index.js';
import type { IndexingPhase } from '../modules/IndexingPassRunner.js';
import type { EnrichmentPhase, NamedImage } from '../modules/EnrichmentPassRunner.js';

// ---------------------------------------------------------------------------
// Location step
// ---------------------------------------------------------------------------

export type { ParserFormField };

// ---------------------------------------------------------------------------
// Chapters step
// ---------------------------------------------------------------------------

/** ParsedChapter extended with pre-computed booleans for Handlebars. */
export interface ChapterCandidateView extends ParsedChapter<JournalChapterData> {
  roleIsOverview: boolean;
  roleIsChapter: boolean;
  roleIsSkip: boolean;
  showOverviewOption: boolean;
  /** Source type extracted from data — for icon display in the template. */
  sourceType: string;
}

// ---------------------------------------------------------------------------
// Wizard navigation
// ---------------------------------------------------------------------------

export type WizardStep = 'location' | 'chapters' | 'model' | 'indexing' | 'enriching';
export type IndexStatus = 'none' | 'exists';
export type ModelContext = 'indexing' | 'vision';

// ---------------------------------------------------------------------------
// Indexing step view model
// ---------------------------------------------------------------------------

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
  phaseTitle: string;
  hasAnyLoreIndex: boolean;
  locationName: string;
  // Location step
  parserFields: ParserFormField[];
  parserFormValues: Record<string, string>;
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
