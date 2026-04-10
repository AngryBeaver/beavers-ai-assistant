import { AI_ASSISTANT_USER_NAME, NAMESPACE, SETTINGS } from './definitions.js';
import { Settings as ApiSettings } from './apps/settings/Settings.js';
import { AiGmWindow } from './apps/AiGmWindow.js';
import { ChatBubbleApi } from './modules/ChatBubbleApi.js';
import { JournalApi } from './modules/JournalApi.js';
import { SocketApi } from './api/SocketApi.js';

Hooks.once('init', async function () {
  game[NAMESPACE] = game[NAMESPACE] || {};
  game[NAMESPACE].Settings = new ApiSettings();

  game.keybindings!.register(NAMESPACE, 'openAiGmWindow', {
    name: 'Open AI GM Window',
    hint: 'Opens the AI GM Window panel (GM only)',
    editable: [],
    restricted: true,
    onDown: () => {
      AiGmWindow.open();
      return true;
    },
  });
});

Hooks.once('ready', async function () {
  console.log(`${NAMESPACE} | Ready`);
  if (game.user.isGM) {
    await ensureAiAssistantUser();
    SocketApi.start();
  }
});

async function ensureAiAssistantUser(): Promise<void> {
  let user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
  if (!user) {
    const password = foundry.utils.randomID(32);
    user = await User.create({
      name: AI_ASSISTANT_USER_NAME,
      role: CONST.USER_ROLES.ASSISTANT,
      password,
    });
    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, password);
  } else {
    const stored = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    if (!stored) {
      // User exists but password was lost — regenerate
      const password = foundry.utils.randomID(32);
      await user.update({ password });
      await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, password);
      console.log(`${NAMESPACE} | Regenerated ai-assistant password`);
    }
  }
}

// Scene control button — GM only.
// In v13 the hook receives Record<string, Control>, not an array.
Hooks.on(
  'getSceneControlButtons',
  (controls: Record<string, foundry.applications.ui.SceneControls.Control>) => {
    if (!game.user.isGM) return;
    const tokenLayer = controls['tokens'];
    if (!tokenLayer) return;
    tokenLayer.tools['ai-gm-window'] = {
      name: 'ai-gm-window',
      order: 99,
      title: 'AI GM Window',
      icon: 'bai-icon',
      button: true,
      visible: true,
      onChange: () => AiGmWindow.open(),
    };
  },
);

// socketlib: Foundry-internal RPC (other modules, macros, GM permission elevation).
// Always registered regardless of enabled state — these are general-purpose GM actions.
Hooks.once('socketlib.ready', () => {
  // @ts-ignore
  const socket = socketlib.registerModule(NAMESPACE);

  socket.register('chatBubble', ChatBubbleApi.showBubble.bind(ChatBubbleApi));
  socket.register('listJournals', JournalApi.listJournals.bind(JournalApi));
  socket.register('readJournal', JournalApi.readJournal.bind(JournalApi));
  socket.register('writeJournal', JournalApi.writeJournal.bind(JournalApi));
  socket.register('writeJournalPage', JournalApi.writeJournalPage.bind(JournalApi));
  socket.register('appendJournalPage', JournalApi.appendJournalPage.bind(JournalApi));

  // @ts-ignore
  game[NAMESPACE] = game[NAMESPACE] || {};
  // @ts-ignore
  game[NAMESPACE].socket = socket;

  console.log(`${NAMESPACE} | Socket methods registered`);
});
