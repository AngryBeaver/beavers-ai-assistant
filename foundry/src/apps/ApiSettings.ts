import { AI_ASSISTANT_USER_NAME, NAMESPACE, SETTINGS } from "../definitions.js";

class AiAssistantApp extends foundry.applications.api.ApplicationV2<{ userId: string; password: string }> {
  static DEFAULT_OPTIONS = {
    id: "beavers-ai-assistant-settings",
    window: {
      title: "Beavers AI Assistant — Connection Info",
      resizable: false,
    },
    position: { width: 460 },
    actions: {
      copyUserId: AiAssistantApp._onCopyUserId,
      copyPassword: AiAssistantApp._onCopyPassword,
      regenerate: AiAssistantApp._onRegenerate,
    },
  };

  async _prepareContext(_options: object): Promise<{ userId: string; password: string }> {
    // @ts-ignore
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    // @ts-ignore
    const password = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    return { userId: user?.id ?? "—", password };
  }

  async _renderHTML(context: { userId: string; password: string }, _options: object): Promise<HTMLElement> {
    const el = document.createElement("div");
    el.style.cssText = "padding:1rem 1rem .75rem";
    el.innerHTML = `
            <p style="margin-bottom:.75rem">
                Use these credentials in your external tool's <code>.env</code> file.
            </p>
            <label style="display:block;margin-bottom:.25rem;font-weight:bold">FOUNDRY_USER (User ID)</label>
            <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
                <input type="text" value="${context.userId}" readonly
                    style="flex:1;font-family:monospace;font-size:.85em" />
                <button type="button" data-action="copyUserId">
                    <i class="fas fa-copy"></i> Copy
                </button>
            </div>
            <label style="display:block;margin-bottom:.25rem;font-weight:bold">FOUNDRY_PASS</label>
            <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
                <input type="text" value="${context.password}" readonly
                    style="flex:1;font-family:monospace;font-size:.85em" />
                <button type="button" data-action="copyPassword">
                    <i class="fas fa-copy"></i> Copy
                </button>
            </div>
            <button type="button" data-action="regenerate" style="width:100%">
                <i class="fas fa-sync"></i> Regenerate Password
            </button>
        `;
    return el;
  }

  _replaceHTML(result: HTMLElement, content: HTMLElement, _options: object): void {
    content.replaceChildren(result);
  }

  static async _onCopyUserId(this: AiAssistantApp): Promise<void> {
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    if (!user) return;
    await navigator.clipboard.writeText(user.id);

    ui.notifications.info("User ID copied to clipboard.");
  }

  static async _onCopyPassword(this: AiAssistantApp): Promise<void> {
    const password = game.settings.get(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD) as string;
    await navigator.clipboard.writeText(password);
    ui.notifications.info("Password copied to clipboard.");
  }

  static async _onRegenerate(this: AiAssistantApp): Promise<void> {
    const user = game.users.find((u: any) => u.name === AI_ASSISTANT_USER_NAME);
    if (!user) return;
    const newPassword = foundry.utils.randomID(32);
    await user.update({ password: newPassword });
    await game.settings.set(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, newPassword);
    await this.render({ force: true });
  }
}

export class ApiSettings {
  constructor() {
    this.registerSettings();
  }

  registerSettings() {
    game.settings.register(NAMESPACE, SETTINGS.AI_ASSISTANT_PASSWORD, {
      scope: "world",
      config: false,
      type: String,
      default: "",
    });

    game.settings.registerMenu(NAMESPACE, "aiAssistant", {
      name: "AI Assistant",
      label: "Connection Info",
      hint: "Show the credentials your external tool needs to connect.",
      icon: "fas fa-robot",
      type: AiAssistantApp,
      restricted: true,
    });
  }
}
