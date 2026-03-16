import { io } from "socket.io-client";
import { randomUUID } from "crypto";

const SOCKET_NAME = "module.beavers-voice-transcript";

export class BeaversClient {
  #url;
  #userId;
  #password;
  #timeout;
  #socket = null;

  /**
   * @param {object} options
   * @param {string} options.url        Foundry base URL, e.g. "http://localhost:30000"
   * @param {string} options.userId     Bot-Control user ID (from module Connection Info)
   * @param {string} options.password   Bot-Control password (from module Connection Info)
   * @param {number} [options.timeout]  Request timeout in ms (default: 10000)
   */
  constructor({ url, userId, password, timeout = 10_000 }) {
    this.#url = url.replace(/\/$/, "");
    this.#userId = userId;
    this.#password = password;
    this.#timeout = timeout;
  }

  // ── Auth & connection ───────────────────────────────────────────────────────

  async connect() {
    if (this.#socket?.connected) return;

    // 1. Get initial session cookie
    const initRes = await fetch(`${this.#url}/join`);
    const initCookie = initRes.headers.get("set-cookie")?.split(";")[0].trim();
    if (!initCookie) throw new Error("Could not obtain initial session from /join.");

    // 2. Authenticate
    const loginRes = await fetch(`${this.#url}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": initCookie },
      body: JSON.stringify({ userid: this.#userId, password: this.#password, action: "join" }),
      redirect: "manual",
    });
    const body = await loginRes.json().catch(() => ({}));
    if (body.status !== "success") {
      throw new Error(`Login failed: ${body.message ?? loginRes.status}`);
    }

    const cookie = loginRes.headers.get("set-cookie")?.split(";")[0].trim() ?? initCookie;
    const sessionId = cookie.split("=")[1];

    // 3. Connect socket.io using session ID as query param (mirrors Foundry's Game.connect())
    this.#socket = await new Promise((resolve, reject) => {
      const socket = io(this.#url, {
        path: "/socket.io",
        transports: ["websocket"],
        upgrade: false,
        query: { session: sessionId },
        cookie: false,
      });

      const timer = setTimeout(() => reject(new Error("Socket connect timed out.")), this.#timeout);

      socket.once("connect_error", (err) => { clearTimeout(timer); reject(err); });
      socket.once("connect", () => {
        socket.once("session", (session) => {
          clearTimeout(timer);
          if (!session?.sessionId) {
            reject(new Error("Authentication failed — Foundry returned a null session."));
          } else {
            resolve(socket);
          }
        });
      });
    });
  }

  async disconnect() {
    this.#socket?.disconnect();
    this.#socket = null;
  }

  // ── API methods ─────────────────────────────────────────────────────────────

  /** List journals and subfolders. Omit folder to list root. */
  async listJournals(folder) {
    return this.#request("listJournals", folder ? [folder] : []);
  }

  /** Read a journal entry by name or ID. */
  async readJournal(identifier) {
    return this.#request("readJournal", [identifier]);
  }

  /** Create or update a journal entry. */
  async writeJournal(data) {
    return this.#request("writeJournal", [data]);
  }

  /** Create or update a page inside a journal entry. */
  async writeJournalPage(journalIdentifier, pageData) {
    return this.#request("writeJournalPage", [journalIdentifier, pageData]);
  }

  /**
   * Append HTML to a transcript page. Auto-rotates to a new page when the
   * current one exceeds maxPageBytes (default 50 KB). Pages are named
   * "<pageName>", "<pageName> (2)", "<pageName> (3)", etc.
   *
   * @param {string} journalIdentifier - Journal name or ID
   * @param {string} pageName         - Base page name
   * @param {string} html             - HTML to append
   * @param {number} [maxPageBytes]   - Rotate threshold in bytes (default 50000)
   */
  async appendJournalPage(journalIdentifier, pageName, html, maxPageBytes) {
    return this.#request("appendJournalPage", [journalIdentifier, pageName, html, maxPageBytes]);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async #request(action, args) {
    if (!this.#socket?.connected) throw new Error("Not connected. Call connect() first.");

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Request "${action}" timed out.`)), this.#timeout);

      this.#socket.on(SOCKET_NAME, (data) => {
        if (data?.id !== id) return;
        clearTimeout(timer);
        this.#socket.off(SOCKET_NAME, this);
        if (data.error) reject(new Error(data.error));
        else resolve(data.data);
      });

      this.#socket.emit(SOCKET_NAME, { id, action, args });
    });
  }
}
