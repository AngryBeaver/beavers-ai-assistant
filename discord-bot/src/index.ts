import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { joinAndListen, leave } from './voice.js';
import * as foundry from './foundry.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[Bot] Logged in as ${c.user.tag}`);
  await foundry.connect();

  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID!);
  const channel = await guild.channels.fetch(process.env.DISCORD_CHANNEL_ID!);

  if (!channel?.isVoiceBased()) {
    console.error('[Bot] DISCORD_CHANNEL_ID is not a voice channel');
    process.exit(1);
  }

  await joinAndListen(channel);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const [cmd, ...args] = message.content.trim().split(/\s+/);

  if (cmd === '!join') {
    const channelId = args[0]?.replace(/[<#>]/g, '');
    if (!channelId) return void message.reply('Usage: `!join <#channel>`');

    const channel = await message.guild!.channels.fetch(channelId).catch(() => null);
    if (!channel?.isVoiceBased()) return void message.reply('Not a valid voice channel.');

    leave();
    await joinAndListen(channel);
    void message.reply(`Joined **${channel.name}**`);
  }

  if (cmd === '!leave') {
    leave();
    void message.reply('Left the voice channel.');
  }
});

void client.login(process.env.DISCORD_TOKEN);
