declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
}

interface BeaversAiGame extends foundry.Game {
  "beavers-voice-transcript": {
    Settings: unknown;
    socket: unknown;
  };
}

declare const game: BeaversAiGame;

interface SettingConfig {
  "beavers-voice-transcript.aiAssistantPassword": string;
}
