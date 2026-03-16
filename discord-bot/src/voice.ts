import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  VoiceConnection,
  VoiceReceiver,
} from '@discordjs/voice';
import * as prism from 'prism-media';
import { VoiceBasedChannel } from 'discord.js';
import { transcribe } from './whisper';
import { appendTranscript } from './foundry';

const SILENCE_TIMEOUT_MS = 1000;

let connection: VoiceConnection | null = null;

export async function joinAndListen(channel: VoiceBasedChannel): Promise<void> {
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log(`[Voice] Joined channel: ${channel.name}`);

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    const user = channel.guild.members.cache.get(userId)?.displayName ?? userId;
    console.log(`[Voice] ${user} started speaking`);
    listenToUser(receiver, userId, user);
  });
}

function listenToUser(receiver: VoiceReceiver, userId: string, displayName: string): void {
  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_TIMEOUT_MS },
  });

  const pcmStream = opusStream.pipe(
    new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 }),
  );

  buildWavBuffer(pcmStream, async (buffer) => {
    if (buffer.length < 4096) return;

    try {
      const transcript = await transcribe(buffer);
      if (!transcript) return;

      console.log(`[${displayName}]: ${transcript}`);
      await appendTranscript(displayName, transcript);
    } catch (err) {
      console.error(`[Voice] Processing error for ${displayName}: ${(err as Error).message}`);
    }
  });
}

interface WavOptions {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

function buildWavBuffer(
  pcmStream: NodeJS.ReadableStream,
  onComplete: (buffer: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  pcmStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  pcmStream.on('end', () => {
    const pcm = Buffer.concat(chunks);
    onComplete(pcmToWav(pcm, { sampleRate: 48000, channels: 1, bitDepth: 16 }));
  });
}

function pcmToWav(pcm: Buffer, { sampleRate, channels, bitDepth }: WavOptions): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function leave(): void {
  if (connection) {
    connection.destroy();
    connection = null;
    console.log('[Voice] Left voice channel');
  }
}