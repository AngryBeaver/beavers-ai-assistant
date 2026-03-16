declare module 'prism-media' {
  import { Transform } from 'stream';
  export namespace opus {
    class Decoder extends Transform {
      constructor(options: { rate: number; channels: number; frameSize: number });
    }
  }
}

declare module 'beavers-ai-assistant-client' {
  export class BeaversClient {
    constructor(options: { url: string; userId?: string; password?: string });
    connect(): Promise<void>;
    writeJournal(options: { name: string; folder: string }): Promise<{ _id: string }>;
    writeJournalPage(journalId: string, options: { content: string }): Promise<void>;
  }
}