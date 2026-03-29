export const NAMESPACE = 'beavers-ai-assistant';
export const SOCKET_NAME = `module.${NAMESPACE}`;
export const AI_ASSISTANT_USER_NAME = 'ai-assistant';

/** Fixed name for the summary journal inside the session folder. Not a setting. */
export const SUMMARY_JOURNAL_NAME = 'AI-Summary';

export const HOOKS = {
  VOICE_TRANSCRIPT_ENABLED_CHANGED: `${NAMESPACE}.voiceTranscriptEnabledChanged`,
} as const;

export const SETTINGS = {
  AI_ASSISTANT_PASSWORD: 'aiAssistantPassword',

  // Voice Transcript
  VOICE_TRANSCRIPT_ENABLED: 'voiceTranscriptEnabled',
  SESSION_JOURNAL_FOLDER: 'sessionJournalFolder',

  // AI Assistant
  AI_ASSISTANT_ENABLED: 'aiAssistantEnabled',
  CLAUDE_API_KEY: 'claudeApiKey',
  CLAUDE_MODEL: 'claudeModel',
  SESSION_HISTORY_MESSAGES: 'sessionHistoryMessages',
  ADVENTURE_JOURNAL_FOLDER: 'adventureJournalFolder',
  ADVENTURE_INDEX_JOURNAL_NAME: 'adventureIndexJournalName',
} as const;

export const DEFAULTS = {
  SESSION_JOURNAL_FOLDER: 'session',
  CLAUDE_MODEL: 'claude-sonnet-4-6',
  SESSION_HISTORY_MESSAGES: 30,
  ADVENTURE_INDEX_JOURNAL_NAME: 'AI Adventure Index',
} as const;
