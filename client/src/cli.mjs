#!/usr/bin/env node
/**
 * CLI for beavers-voice-transcript-client.
 *
 * Usage (with .env file):
 *   node --env-file=.env ./src/cli.mjs <action> [args...]
 *
 * Or if installed globally / via npx:
 *   beavers-client listJournals
 *   beavers-client listJournals "My Folder"
 *   beavers-client readJournal "My Journal"
 *   beavers-client writeJournal '{"name":"Test","content":"hello"}'
 *   beavers-client writeJournalPage "My Journal" '{"name":"p1","text":{"content":"<p>hi</p>"}}'
 */

import { BeaversClient } from "./index.mjs";

const url      = process.env.FOUNDRY_URL  ?? "http://localhost:30000";
const userId   = process.env.FOUNDRY_USER ?? "";
const password = process.env.FOUNDRY_PASS ?? "";
const [, , action = "listJournals", ...rawArgs] = process.argv;

const args = rawArgs.map((a) => {
  try { return JSON.parse(a); } catch { return a; }
});

const client = new BeaversClient({ url, userId, password });

try {
  await client.connect();
  console.log("Connected.");

  let result;
  switch (action) {
    case "listJournals":    result = await client.listJournals(args[0]); break;
    case "readJournal":     result = await client.readJournal(args[0]); break;
    case "writeJournal":    result = await client.writeJournal(args[0]); break;
    case "writeJournalPage":  result = await client.writeJournalPage(args[0], args[1]); break;
    case "appendJournalPage": result = await client.appendJournalPage(args[0], args[1], args[2]); break;
    default: throw new Error(`Unknown action: ${action}`);
  }

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await client.disconnect();
}
