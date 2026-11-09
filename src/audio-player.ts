import { Audio } from "expo-av";

/**
 * Adaptador de audio (B4-02, R2): aísla `expo-av` tras una interfaz para
 * no migrar a `expo-audio` en este change. `expo-av` 16 permanece como
 * backend por defecto; la sustitución futura solo cambia el `backend`
 * inyectado, nunca la firma consumida por ficha y ListeningPlayer.
 */

export interface AudioPlayer {
  load(uri: string, onFinished?: () => void): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  unload(): Promise<void>;
}

/** Superficie mínima de `expo-av` que usa el adaptador (sustituible). */
export interface AudioPlayerSound {
  playAsync(): Promise<unknown>;
  pauseAsync(): Promise<unknown>;
  unloadAsync(): Promise<unknown>;
  setOnPlaybackStatusUpdate(
    cb: (status: { isLoaded: boolean; didJustFinish?: boolean }) => void
  ): void;
}

export interface AudioPlayerBackend {
  createSound(uri: string): Promise<AudioPlayerSound>;
}

const expoAvBackend: AudioPlayerBackend = {
  async createSound(uri: string): Promise<AudioPlayerSound> {
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false }
    );
    return sound as unknown as AudioPlayerSound;
  },
};

export function createAudioPlayer(
  backend: AudioPlayerBackend = expoAvBackend
): AudioPlayer {
  let current: AudioPlayerSound | null = null;
  let onFinished: (() => void) | null = null;

  const unloadCurrent = async (): Promise<void> => {
    const previous = current;
    current = null;
    onFinished = null;
    if (previous) {
      try {
        await previous.unloadAsync();
      } catch {
        // best-effort: descargar dos veces no debe lanzar
      }
    }
  };

  return {
    async load(uri: string, finished?: () => void): Promise<void> {
      await unloadCurrent();
      const sound = await backend.createSound(uri);
      current = sound;
      onFinished = finished ?? null;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) onFinished?.();
      });
    },

    async play(): Promise<void> {
      if (!current) return;
      await current.playAsync();
    },

    async pause(): Promise<void> {
      if (!current) return;
      await current.pauseAsync();
    },

    async unload(): Promise<void> {
      await unloadCurrent();
    },
  };
}
