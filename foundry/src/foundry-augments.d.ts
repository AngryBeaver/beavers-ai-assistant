declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
  namespace applications {
    namespace api {
      class ApplicationV2<TContext = object> {
        element: HTMLElement;
        render(options?: { force?: boolean }): Promise<this>;
        close(options?: object): Promise<this>;
        // v14 rename of _replaceHTML
        _replaceContent(result: HTMLElement, content: HTMLElement, options: object): void;
      }

      /**
       * Mixin that adds Handlebars template rendering to ApplicationV2.
       * Declare `static PARTS` with template paths; the mixin owns _renderHTML,
       * _replaceHTML, and _replaceContent — do not override those in subclasses.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function HandlebarsApplicationMixin(Base: typeof ApplicationV2): typeof ApplicationV2;
    }
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
