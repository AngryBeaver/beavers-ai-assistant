export interface ActorSummary {
  id: string;
  name: string;
  img: string;
}

export class ActorApi {
  static async listCompendiumActors(packId?: string): Promise<ActorSummary[]> {
    const results: ActorSummary[] = [];
    const allPacks = (game.packs as any).contents as any[];

    for (const pack of allPacks) {
      if (packId && pack.collection !== packId) continue;
      if (pack.metadata?.type !== 'Actor') continue;
      try {
        const index = await pack.getIndex();
        for (const entry of (index as any)) {
          results.push({
            id: `Compendium.${pack.collection}.Actor.${entry._id}`,
            name: entry.name ?? '',
            img: entry.img ?? '',
          });
        }
      } catch {
        // skip unavailable packs
      }
    }

    return results;
  }

  static async queryCompendiumActor(
    name: string,
    packId?: string,
  ): Promise<Record<string, unknown> | null> {
    const nameLower = name.toLowerCase();
    const allPacks = (game.packs as any).contents as any[];

    for (const pack of allPacks) {
      if (packId && pack.collection !== packId) continue;
      if (pack.metadata?.type !== 'Actor') continue;
      try {
        const index = await pack.getIndex();
        const entry = (index as any).find((e: any) => e.name?.toLowerCase() === nameLower);
        if (!entry) continue;
        const doc = (await pack.getDocument(entry._id)) as any;
        if (!doc) continue;
        return doc.toObject() as Record<string, unknown>;
      } catch {
        // skip unavailable packs
      }
    }
    return null;
  }

  static async readWorldActor(nameOrId: string): Promise<Record<string, unknown> | null> {
    let actor = (game.actors as any).get(nameOrId) as any;
    if (!actor) {
      actor = (game.actors as any).find((a: any) => a.name === nameOrId);
    }
    if (!actor) return null;
    return actor.toObject() as Record<string, unknown>;
  }

  static async deleteWorldActor(nameOrId: string): Promise<boolean> {
    let actor = (game.actors as any).get(nameOrId) as any;
    if (!actor) {
      actor = (game.actors as any).find((a: any) => a.name === nameOrId);
    }
    if (!actor) return false;
    await actor.delete();
    return true;
  }
}
