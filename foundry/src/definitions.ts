export const NAMESPACE = 'beavers-ai-assistant';
export const SOCKET_NAME = `module.${NAMESPACE}`;
export const AI_ASSISTANT_USER_NAME = 'ai-assistant';

/** Fixed folder structure for beavers-ai-assistant. All journals live here. */
export const MODULE_FOLDER_NAME = 'beavers-ai-assistant';

/** Fixed folder inside MODULE_FOLDER_NAME where session journals are stored. */
export const SESSION_FOLDER_NAME = 'session';

/** Fixed journal name for session summaries inside SESSION_FOLDER_NAME. */
export const SUMMARY_JOURNAL_NAME = 'AI-Summary';

/** Fixed journal name for the lore index inside MODULE_FOLDER_NAME. */
export const LORE_INDEX_JOURNAL_NAME = 'lore-index';

export const SETTINGS = {
  AI_ASSISTANT_PASSWORD: 'aiAssistantPassword',

  // AI Assistant
  AI_ASSISTANT_ENABLED: 'aiAssistantEnabled',
  AI_PROVIDER: 'aiProvider',
  CLAUDE_API_KEY: 'claudeApiKey',
  CLAUDE_MODEL: 'claudeModel',
  LOCAL_MODEL: 'localModel',
  LOCAL_AI_URL: 'localAiUrl',
  SESSION_HISTORY_MESSAGES: 'sessionHistoryMessages',
  ADVENTURE_JOURNAL_FOLDER: 'adventureJournalFolder',

  // Lore Index Wizard — persisted selections (client-scoped)
  WIZARD_LOCATION: 'wizardLocation',
  WIZARD_CHAPTERS: 'wizardChapters',
  WIZARD_SCENES: 'wizardScenes',
  WIZARD_INDEXING_PROVIDER: 'wizardIndexingProvider',
  WIZARD_INDEXING_MODEL: 'wizardIndexingModel',
  WIZARD_INDEXING_REASONING: 'wizardIndexingReasoning',
} as const;

export type AiProvider = 'claude' | 'local-ai';

export const DEFAULTS = {
  AI_PROVIDER: 'claude' as AiProvider,
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  LOCAL_MODEL: 'qwen3.5-9b',
  LOCAL_AI_URL: 'http://127.0.0.1:8080',
  SESSION_HISTORY_MESSAGES: 30,
} as const;
