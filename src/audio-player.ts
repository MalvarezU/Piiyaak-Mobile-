import { createAudioPlayer as createExpoAudioPlayer } from "expo-audio";

/**
 * Adaptador de audio (B4-02, R2): aísla `expo-audio` tras una interfaz para
 * que la migración SDK 55 solo cambie el `backend` inyectado, nunca la firma
 * consumida por ficha, Escucha y ListeningPlayer.
 */

export interface AudioPlayer {
  load(uri: string, onFinished?: () => void): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  unload(): Promise<void>;
}

/** Superficie mínima de `expo-audio` que usa el adaptador (sustituible). */
export interface AudioPlayerSound {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  remove(): void;
  addListener(
    event: "playbackStatusUpdate",
    cb: (status: { isLoaded: boolean; didJustFinish?: boolean }) => void
  ): { remove: () => void };
}

export interface AudioPlayerBackend {
  createSound(uri: string): Promise<AudioPlayerSound>;
}

const expoAudioBackend: AudioPlayerBackend = {
  async createSound(uri: string): Promise<AudioPlayerSound> {
    const player = createExpoAudioPlayer(uri);
    return player as unknown as AudioPlayerSound;
  },
};

export function createAudioPlayer(
  backend: AudioPlayerBackend = expoAudioBackend
): AudioPlayer {
  let current: AudioPlayerSound | null = null;
  let onFinished: (() => void) | null = null;
  let subscription: { remove: () => void } | null = null;

  const unloadCurrent = async (): Promise<void> => {
    const previous = current;
    const prevSub = subscription;
    current = null;
    onFinished = null;
    subscription = null;
    if (prevSub) {
      try {
        prevSub.remove();
      } catch {
        // best-effort
      }
    }
    if (previous) {
      try {
        previous.remove();
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
      subscription = sound.addListener("playbackStatusUpdate", (status) => {
        if (status.isLoaded && status.didJustFinish) onFinished?.();
      });
    },

    async play(): Promise<void> {
      if (!current) return;
      current.play();
    },

    async pause(): Promise<void> {
      if (!current) return;
      current.pause();
    },

    async seekTo(seconds: number): Promise<void> {
      if (!current) return;
      await current.seekTo(seconds);
    },

    async unload(): Promise<void> {
      await unloadCurrent();
    },
  };
}
