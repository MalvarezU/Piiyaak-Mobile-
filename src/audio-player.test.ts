import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-av", () => {
  interface FakeState {
    uri: string;
    played: number;
    paused: number;
    unloaded: number;
    statusCb: ((s: { isLoaded: boolean; didJustFinish?: boolean }) => void) | null;
  }
  const sounds: FakeState[] = [];
  const createAsync = vi.fn(async (source: { uri: string }) => {
    const state: FakeState = {
      uri: source.uri,
      played: 0,
      paused: 0,
      unloaded: 0,
      statusCb: null,
    };
    sounds.push(state);
    const sound = {
      async playAsync() {
        state.played++;
      },
      async pauseAsync() {
        state.paused++;
      },
      async unloadAsync() {
        state.unloaded++;
      },
      setOnPlaybackStatusUpdate(
        cb: (s: { isLoaded: boolean; didJustFinish?: boolean }) => void
      ) {
        state.statusCb = cb;
      },
    };
    return { sound, status: { isLoaded: true } };
  });
  return { Audio: { Sound: { createAsync } }, __testSounds: sounds };
});

import { Audio } from "expo-av";
import { createAudioPlayer, type AudioPlayerBackend } from "./audio-player";

const mockedCreate = Audio.Sound.createAsync as unknown as ReturnType<typeof vi.fn>;
const { __testSounds } = (await import("expo-av")) as unknown as {
  __testSounds: Array<{
    uri: string;
    played: number;
    paused: number;
    unloaded: number;
    statusCb: ((s: { isLoaded: boolean; didJustFinish?: boolean }) => void) | null;
  }>;
};

beforeEach(() => {
  mockedCreate.mockClear();
  __testSounds.length = 0;
});

/**
 * B4-02 (R2): `AudioPlayer` aísla `expo-av` tras una interfaz para no
 * migrar a expo-audio en este change. RED primero: el módulo no existe.
 */
describe("AudioPlayer (B4-02)", () => {
  it("expone load/play/pause/unload y delega en expo-av", async () => {
    const player = createAudioPlayer();
    await player.load("https://cdn.example.com/a.mp3");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0]![0]).toEqual({
      uri: "https://cdn.example.com/a.mp3",
    });
    await player.play();
    await player.pause();
    await player.unload();
    expect(__testSounds[0]!.played).toBe(1);
    expect(__testSounds[0]!.paused).toBe(1);
    expect(__testSounds[0]!.unloaded).toBe(1);
  });

  it("load reemplaza el sonido anterior con unload previo", async () => {
    const player = createAudioPlayer();
    await player.load("https://cdn.example.com/a.mp3");
    await player.load("https://cdn.example.com/b.mp3");
    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(__testSounds[0]!.unloaded).toBe(1);
    expect(__testSounds[1]!.uri).toBe("https://cdn.example.com/b.mp3");
  });

  it("play/pause/unload sin load previo no lanzan", async () => {
    const player = createAudioPlayer();
    await expect(player.play()).resolves.toBeUndefined();
    await expect(player.pause()).resolves.toBeUndefined();
    await expect(player.unload()).resolves.toBeUndefined();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("la sustitución del backend no cambia la firma del adaptador", async () => {
    const calls: string[] = [];
    const backend: AudioPlayerBackend = {
      async createSound(uri: string) {
        calls.push(`create:${uri}`);
        return {
          async playAsync() {
            calls.push("play");
          },
          async pauseAsync() {
            calls.push("pause");
          },
          async unloadAsync() {
            calls.push("unload");
          },
          setOnPlaybackStatusUpdate() {},
        };
      },
    };
    const player = createAudioPlayer(backend);
    await player.load("https://cdn.example.com/x.mp3");
    await player.play();
    await player.pause();
    await player.unload();
    expect(calls).toEqual([
      "create:https://cdn.example.com/x.mp3",
      "play",
      "pause",
      "unload",
    ]);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("invoca onFinished al terminar la reproducción", async () => {
    const player = createAudioPlayer();
    const finished = vi.fn();
    await player.load("https://cdn.example.com/a.mp3", finished);
    __testSounds[0]!.statusCb?.({ isLoaded: true, didJustFinish: true });
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
