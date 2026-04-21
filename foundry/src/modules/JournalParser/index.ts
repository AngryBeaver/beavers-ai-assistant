export { JournalParser } from './JournalParser.js';
export type { JournalChapterData } from './JournalParser.js';

export { ChapterDetector, flagIntroCandidate, INTRO_KEYWORDS } from './ChapterDetector.js';
export type {
  ChapterCandidate,
  ChapterRole,
  DetectionResult,
  GameAccessor,
  FolderLike,
  JournalLike,
  PageLike,
} from './ChapterDetector.js';

export { ChapterContentParser } from './ChapterContentParser.js';
