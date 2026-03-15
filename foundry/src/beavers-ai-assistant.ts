import { AI_ASSISTANT_USER_NAME, NAMESPACE, SETTINGS } from "./definitions.js";
import { ApiSettings } from "./apps/ApiSettings.js";
import { JournalApi } from "./modules/JournalApi.js";
import { SocketApi } from "./api/SocketApi.js";

Hooks.once("init", async function () {
  // @ts-ignore
  game[NAMESPACE] = game[NAMESPACE] || {};
  // @ts-ignore
  game[NAMESPACE].Settings = new ApiSettings();
});

Hooks.once("ready", async function () {
  console.log(`${NAMESPACE} | Ready`);
  // @ts-ignore
  if (game.user.isGM) {
    await ensureAiAssistantUser();
  }
  SocketApi.start();
});

async function ensureAiAssistantUser(): Promise<void> {
  // @ts-ignore
  let user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
  if (!user) {
    const password = foundry.utils.randomID(32);
    // @ts-ignore
    user = await User.create({
      name: AI_ASSISTANT_USER_NAME,
      // @ts-ignore
      role: CONST.USER_ROLES.ASSISTANT,
      password,
    });
    // @ts-ignore
    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, password);
    console.log(`${NAMESPACE} | Created AI-Assistant user`);
  } else {
    // @ts-ignore
    const stored = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    if (!stored) {
      // User exists but password was lost — regenerate
      const password = foundry.utils.randomID(32);
      await user.update({ password });
      // @ts-ignore
      await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, password);
      console.log(`${NAMESPACE} | Regenerated AI-Assistant password`);
    }
  }
}

// socketlib: Foundry-internal RPC (other modules, macros, GM permission elevation)
Hooks.once("socketlib.ready", () => {
  // @ts-ignore
  const socket = socketlib.registerModule(NAMESPACE);

  socket.register("listJournals", JournalApi.listJournals.bind(JournalApi));
  socket.register("readJournal", JournalApi.readJournal.bind(JournalApi));
  socket.register("writeJournal", JournalApi.writeJournal.bind(JournalApi));
  socket.register("writeJournalPage", JournalApi.writeJournalPage.bind(JournalApi));

  // @ts-ignore
  game[NAMESPACE] = game[NAMESPACE] || {};
  // @ts-ignore
  game[NAMESPACE].socket = socket;

  console.log(`${NAMESPACE} | Socket methods registered`);
});
