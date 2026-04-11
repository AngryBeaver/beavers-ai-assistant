import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import type { JournalData, JournalPageData } from './types.js';

export type { JournalData, JournalPageData };

const SOCKET_NAME = 'module.beavers-ai-assistant';

interface ClientOptions {
  /** Foundry base URL, e.g. "http://localhost:30000" */
  url: string;
  /** Bot-Control user ID (from module Connection Info) */
  userId: string;
  /** Bot-Control password (from module Connection Info) */
  password: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

export class BeaversClient {
  readonly #url: string;
  readonly #userId: string;
  readonly #password: string;
  readonly #timeout: number;
  #socket: Socket | null = null;

  constructor({ url, userId, password, timeout = 10_000 }: ClientOptions) {
    this.#url = url.replace(/\/$/, '');
    this.#userId = userId;
    this.#password = password;
    this.#timeout = timeout;
  }

  // ── Auth & connection ───────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.#socket?.connected) return;

    // 1. Get initial session cookie
    const initRes = await fetch(`${this.#url}/join`);
    const initCookie = initRes.headers.get('set-cookie')?.split(';')[0].trim();
    if (!initCookie) throw new Error('Could not obtain initial session from /join.');

    // 2. Authenticate
    const loginRes = await fetch(`${this.#url}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: initCookie },
      body: JSON.stringify({ userid: this.#userId, password: this.#password, action: 'join' }),
      redirect: 'manual',
    });
    const body = await loginRes.json().catch(() => ({}));
    if ((body as { status?: string }).status !== 'success') {
      throw new Error(`Login failed: ${(body as { message?: string }).message ?? loginRes.status}`);
    }

    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0].trim() ?? initCookie;
    const sessionId = cookie.split('=')[1];

    // 3. Connect socket.io using session ID as query param (mirrors Foundry's Game.connect())
    this.#socket = await new Promise<Socket>((resolve, reject) => {
      const socket = io(this.#url, {
        path: '/socket.io',
        transports: ['websocket'],
        upgrade: false,
        query: { session: sessionId },
        withCredentials: false,
      });

      const timer = setTimeout(() => reject(new Error('Socket connect timed out.')), this.#timeout);

      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('connect', () => {
        socket.once('session', (session: { sessionId?: string } | null) => {
          clearTimeout(timer);
          if (!session?.sessionId) {
            reject(new Error('Authentication failed — Foundry returned a null session.'));
          } else {
            resolve(socket);
          }
        });
      });
    });
  }

  async disconnect(): Promise<void> {
    this.#socket?.disconnect();
    this.#socket = null;
  }

  get connected(): boolean {
    return this.#socket?.connected ?? false;
  }

  // ── API methods ─────────────────────────────────────────────────────────────

  /** List journals and subfolders. Omit folder to list root. */
  async listJournals(folder?: string): Promise<unknown> {
    return this.#request('listJournals', folder ? [folder] : []);
  }

  /** Read a journal entry by name or ID. */
  async readJournal(identifier: string): Promise<JournalData> {
    return this.#request('readJournal', [identifier]);
  }

  /** Create or update a journal entry. */
  async writeJournal(data: JournalData): Promise<JournalData> {
    return this.#request('writeJournal', [data]);
  }

  /** Create or update a page inside a journal entry. */
  async writeJournalPage(
    journalIdentifier: string,
    pageData: JournalPageData,
  ): Promise<JournalPageData> {
    return this.#request('writeJournalPage', [journalIdentifier, pageData]);
  }

  /** Display a speech bubble on a token without sending a chat message. */
  async chatBubble(
    actorOrTokenName: string,
    message: string,
    options: { emote?: boolean } = {},
  ): Promise<void> {
    return this.#request('chatBubble', [actorOrTokenName, message, options]);
  }

  /**
   * Append a transcribed line to today's session journal.
   * Resolves speaker from nameOrId (token name / GM / nameOrId fallback).
   */
  async transcribeJournal(msg: string, nameOrId: string): Promise<void> {
    return this.#request('transcribeJournal', [msg, nameOrId]);
  }

  /** Check whether a Foundry GM session is currently active. */
  async gmPresent(): Promise<boolean> {
    const result = await this.#request<{ present: boolean }>('gmPresent', []);
    return result.present;
  }

  /**
   * Append HTML to a transcript page. Auto-rotates to a new page when the
   * current one exceeds maxPageBytes (default 50 KB). Pages are named
   * "<pageName>", "<pageName> (2)", "<pageName> (3)", etc.
   */
  async appendJournalPage(
    journalIdentifier: string,
    pageName: string,
    html: string,
    maxPageBytes?: number,
  ): Promise<void> {
    return this.#request('appendJournalPage', [journalIdentifier, pageName, html, maxPageBytes]);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async #request<T>(action: string, args: unknown[]): Promise<T> {
    if (!this.#socket?.connected)
      throw new Error(
        `Not connected — socket is ${this.#socket ? 'disconnected' : 'not initialised'}. Call connect() first.`,
      );

    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Request "${action}" timed out — socket connected but no Foundry response (GM may not be present).`,
            ),
          ),
        this.#timeout,
      );

      const handler = (data: { id: string; error?: string; data?: T }) => {
        if (data?.id !== id) return;
        clearTimeout(timer);
        this.#socket!.off(SOCKET_NAME, handler);
        if (data.error) reject(new Error(data.error));
        else resolve(data.data as T);
      };

      this.#socket!.on(SOCKET_NAME, handler);
      this.#socket!.emit(SOCKET_NAME, { id, action, args });
    });
  }
}
