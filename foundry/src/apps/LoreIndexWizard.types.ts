import type { AiProvider } from '../definitions.js';
import type { ParsedChapter, ChapterRole, ParserFormField } from '../modules/AdventureParser.js';
import type { JournalChapterData } from '../modules/JournalParser/index.js';
import type { IndexingPhase } from '../modules/IndexingPassRunner.js';
import type { EnrichmentPhase, NamedImage } from '../modules/MapEnrichment/index.js';

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

export type WizardStep = 'location' | 'chapters' | 'scenes' | 'model' | 'indexing' | 'enriching';
export type IndexStatus = 'none' | 'exists';
export type ModelContext = 'indexing' | 'vision';
export type SceneRole = 'include' | 'overview' | 'skip';

// ---------------------------------------------------------------------------
// Lore index — structured machine-readable record written after indexing
// ---------------------------------------------------------------------------

export interface LoreChapter {
  sourceId: string;
  sourceName: string;
  sourceType: 'folder' | 'journal' | 'page' | 'header';
  role: 'chapter' | 'overview' | 'skip';
  loreJournalId: string;
  loreJournalName: string;
}

export interface LoreScene {
  name: string;
  role: SceneRole;
  lorePageId: string;
  /** Source heading texts that were mapped to this scene during pre-detection. */
  headings: string[];
}

export interface LoreIndex {
  builtAt: string;
  /** sourceId → chapter metadata */
  chapters: LoreChapter[];
  /** chapterId (loreJournalId) → scenes */
  scenes: Record<string, LoreScene[]>;
}

// ---------------------------------------------------------------------------
// Scene pre-detection (heading candidates within a chapter)
// ---------------------------------------------------------------------------

export interface HeadingCandidate {
  text: string;
  level: number;
  role: SceneRole;
}

/** Per-chapter scene selections: heading text → role */
export type WizardSceneSelections = Record<string, Record<string, SceneRole>>;

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

export interface EnrichmentSceneView {
  sceneName: string;
  sceneIdx: number;
  hasConnections: boolean;
  images: NamedImage[];
  /** Currently selected image URL for this scene (empty = scene will be skipped). */
  selectedImageUrl: string;
}

export interface EnrichmentCtx {
  phase: EnrichmentPhase;
  chapterName: string;
  chapterIdx: number;
  totalChapters: number;
  /** All scenes in the current chapter (populated during pre_chapter phase). */
  scenes: EnrichmentSceneView[];
  log: string[];
  enrichedCount: number;
  error: string | null;
  /** Name of the scene currently being enriched (running phase). */
  runningSceneName: string;
  /** 1-based index of the running scene within the chapter run queue. */
  runningIdx: number;
  /** Total scenes queued for enrichment in the current chapter. */
  runningTotal: number;
  isPreChapter: boolean;
  isRunning: boolean;
  isPostChapter: boolean;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Full wizard context (passed to all step templates)
// ---------------------------------------------------------------------------

export interface SceneChapterView {
  chapterId: string;
  chapterName: string;
  headings: (HeadingCandidate & { isInclude: boolean; isOverview: boolean; isSkip: boolean })[];
}

export interface WizardContext {
  phaseTitle: string;
  hasAnyLoreIndex: boolean;
  locationName: string;
  // Location step
  parserFields: ParserFormField[];
  parserFormValues: Record<string, string>;
  // Chapters step
  chapters: ChapterCandidateView[];
  // Scenes step
  sceneChapters: SceneChapterView[];
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
