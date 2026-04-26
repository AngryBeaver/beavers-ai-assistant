declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
  namespace applications {
    namespace api {
      class ApplicationV2<TContext = object> {
        element: HTMLElement;
        render(options?: { force?: boolean; parts?: string[] }): Promise<this>;
        close(options?: object): Promise<this>;
        _configureRenderOptions(options: { parts?: string[]; [key: string]: unknown }): void;
        // v14 rename of _replaceHTML
        _replaceContent(result: HTMLElement, content: HTMLElement, options: object): void;
      }

      /**
       * Mixin that adds Handlebars template rendering to ApplicationV2.
       * Declare `static PARTS` with template paths; the mixin owns _renderHTML,
       * _replaceHTML, and _replaceContent.
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
  'beavers-ai-assistant.aiAssistantEnabled': boolean;
  'beavers-ai-assistant.aiProvider': string;
  'beavers-ai-assistant.claudeApiKey': string;
  'beavers-ai-assistant.claudeModel': string;
  'beavers-ai-assistant.localModel': string;
  'beavers-ai-assistant.localAiUrl': string;
  'beavers-ai-assistant.sessionHistoryMessages': number;
  'beavers-ai-assistant.adventureJournalFolder': string;
  'beavers-ai-assistant.wizardLocation': string;
  'beavers-ai-assistant.wizardChapters': string;
  'beavers-ai-assistant.wizardScenes': string;
  'beavers-ai-assistant.wizardIndexingProvider': string;
  'beavers-ai-assistant.wizardIndexingModel': string;
  'beavers-ai-assistant.wizardIndexingReasoning': string;
}
