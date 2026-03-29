declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
}

interface BeaversAiGame extends foundry.Game {
  'beavers-ai-assistant': {
    Settings: unknown;
    socket: unknown;
  };
}

declare const game: BeaversAiGame;

interface SettingConfig {
  'beavers-ai-assistant.aiAssistantPassword': string;
  'beavers-ai-assistant.voiceTranscriptEnabled': boolean;
  'beavers-ai-assistant.sessionJournalFolder': string;
  'beavers-ai-assistant.aiAssistantEnabled': boolean;
  'beavers-ai-assistant.claudeApiKey': string;
  'beavers-ai-assistant.claudeModel': string;
  'beavers-ai-assistant.sessionHistoryMessages': number;
  'beavers-ai-assistant.adventureJournalFolder': string;
  'beavers-ai-assistant.adventureIndexJournalName': string;
}
