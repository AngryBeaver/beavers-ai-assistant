export const NAMESPACE = 'beavers-ai-assistant';
export const SOCKET_NAME = `module.${NAMESPACE}`;
export const AI_ASSISTANT_USER_NAME = 'ai-assistant';

export const SETTINGS = {
  AI_ASSISTANT_PASSWORD: 'aiAssistantPassword',

  // AI GM Window
  CLAUDE_API_KEY: 'claudeApiKey',
  CLAUDE_MODEL: 'claudeModel',
  ADVENTURE_JOURNAL_FOLDER: 'adventureJournalFolder',
  SESSION_JOURNAL_FOLDER: 'sessionJournalFolder',
  SESSION_HISTORY_MESSAGES: 'sessionHistoryMessages',
  SUMMARY_JOURNAL_NAME: 'summaryJournalName',
  LORE_INDEX_JOURNAL_NAME: 'loreIndexJournalName',
} as const;

export const DEFAULTS = {
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  SESSION_HISTORY_MESSAGES: 30,
  SUMMARY_JOURNAL_NAME: 'AI Session Summary',
  LORE_INDEX_JOURNAL_NAME: 'AI Lore Index',
} as const;
