import * as FileSystem from "expo-file-system";

/**
 * Ilustraciones offline (F4): cache bajo documentDirectory/illustrations/.
 */
const ILL_DIR = `${FileSystem.documentDirectory}illustrations/`;

export async function ensureIllustrationDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ILL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ILL_DIR, { intermediates: true });
  }
}

export function localIllustrationPath(wordId: string, url: string): string {
  const ext = url.split("?")[0]?.split(".").pop() ?? "png";
  return `${ILL_DIR}${wordId}.${ext}`;
}

export async function downloadIllustration(wordId: string, url: string): Promise<string> {
  await ensureIllustrationDir();
  const dest = localIllustrationPath(wordId, url);
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) return dest;
  const dl = await FileSystem.downloadAsync(url, dest);
  return dl.uri;
}

export async function removeIllustration(wordId: string, url: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(localIllustrationPath(wordId, url), { idempotent: true });
  } catch {
    // best-effort
  }
}

export async function illustrationExists(wordId: string, url: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localIllustrationPath(wordId, url));
  return info.exists;
}
