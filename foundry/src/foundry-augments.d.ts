declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
}

interface BeaversAiGame extends foundry.Game {
  "beavers-ai-assistant": {
    Settings: unknown;
    socket: unknown;
  };
}

declare const game: BeaversAiGame;

interface SettingConfig {
  "beavers-ai-assistant.aiAssistantPassword": string;
}
