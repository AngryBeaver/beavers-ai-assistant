export interface ChatBubbleOptions {
  emote?: boolean;
}

export class ChatBubbleApi {
  /**
   * Display a speech bubble on a token without sending a chat message.
   * The token is resolved by actor name, token name, or token/actor ID.
   */
  static async showBubble(
    actorOrTokenName: string,
    message: string,
    options: ChatBubbleOptions = {},
  ): Promise<void> {
    const token = ChatBubbleApi.resolveToken(actorOrTokenName);
    if (token) {
      await canvas.hud.bubbles.say(token, message, { emote: options.emote ?? false });
    }
  }

  private static resolveToken(nameOrId: string): Token | undefined {
    const tokens: Token[] = canvas.tokens.placeables;

    // Try direct matches first: token/actor id, token name, actor name
    const direct =
      tokens.find((t) => t.id === nameOrId) ??
      tokens.find((t) => t.actor?.id === nameOrId) ??
      tokens.find((t) => t.name === nameOrId) ??
      tokens.find((t) => t.actor?.name === nameOrId);
    if (direct) return direct;

    // Fall back: find a user whose name matches, then look for their character's token
    const user = (game.users as any).find(
      (u: any) => u.name === nameOrId,
    );
    if (!user?.character) return undefined;
    return tokens.find((t) => t.actor?.id === user.character.id);
  }
}