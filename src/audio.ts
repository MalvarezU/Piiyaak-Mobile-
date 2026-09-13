import * as FileSystem from "expo-file-system";

/**
 * Audios offline (B3.3): solo favoritas. Directorio de documentos de la app.
 */
const AUDIO_DIR = `${FileSystem.documentDirectory}audios/`;

export async function ensureAudioDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

export function localAudioPath(wordId: string, audioUrl: string): string {
  const ext = audioUrl.split("?")[0]?.split(".").pop() ?? "mp3";
  return `${AUDIO_DIR}${wordId}.${ext}`;
}

export async function downloadAudio(wordId: string, audioUrl: string): Promise<string> {
  await ensureAudioDir();
  const dest = localAudioPath(wordId, audioUrl);
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) return dest;
  const dl = await FileSystem.downloadAsync(audioUrl, dest);
  return dl.uri;
}

export async function removeAudio(wordId: string, audioUrl: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(localAudioPath(wordId, audioUrl), { idempotent: true });
  } catch {
    // best-effort
  }
}

export async function audioExists(wordId: string, audioUrl: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localAudioPath(wordId, audioUrl));
  return info.exists;
}
