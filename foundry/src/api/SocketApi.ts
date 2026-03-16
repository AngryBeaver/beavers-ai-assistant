import { NAMESPACE, SOCKET_NAME } from "../definitions.js";
import { JournalApi } from "../modules/JournalApi.js";
import { JournalData, JournalPageData } from "../types";

interface SocketRequest {
  id: string;
  action: string;
  args: unknown[];
}

interface SocketResponse {
  id: string;
  data?: unknown;
  error?: string;
}

/**
 * Socket API for external tools using socket.io-client.
 *
 * External tool flow:
 *   1. GET  http://localhost:30000/join  → parse Bot-Control userId from users list
 *   2. POST http://localhost:30000/join  { userid, password, action:"join" }  → set-cookie
 *   3. Connect socket.io-client with that cookie
 *   4. Emit SOCKET_NAME with { id: uuid, action, args }
 *   5. Listen on SOCKET_NAME; resolve when response.id matches
 *
 * Also used by other Foundry modules directly via socketlib.
 */
export class SocketApi {
  private static readonly handler = (data: SocketRequest) => SocketApi.onRequest(data);

  static start(): void {
    game.socket.on(SOCKET_NAME, SocketApi.handler);
    console.log(`${NAMESPACE} | Socket API started`);
  }

  static stop(): void {
    game.socket.off(SOCKET_NAME, SocketApi.handler);
  }

  private static async onRequest(data: SocketRequest): Promise<void> {
    if (!data?.id || !data?.action) return;

    let result: unknown;
    let error: string | undefined;

    try {
      switch (data.action) {
        case "listJournals":
          result = await JournalApi.listJournals(data.args[0] as string | undefined);
          break;
        case "readJournal":
          result = await JournalApi.readJournal(data.args[0] as string);
          break;
        case "writeJournal":
          result = await JournalApi.writeJournal(data.args[0] as JournalData);
          break;
        case "writeJournalPage":
          result = await JournalApi.writeJournalPage(data.args[0] as string, data.args[1] as JournalPageData);
          break;
        case "appendJournalPage":
          result = await JournalApi.appendJournalPage(
            data.args[0] as string,
            data.args[1] as string,
            data.args[2] as string,
            data.args[3] as number | undefined,
          );
          break;
        default:
          throw new Error(`Unknown action: ${data.action}`);
      }
    } catch (e: unknown) {
      error = (e as Error).message;
    }

    const response: SocketResponse = error ? { id: data.id, error } : { id: data.id, data: result };
    game.socket.emit(SOCKET_NAME, response);
  }
}
