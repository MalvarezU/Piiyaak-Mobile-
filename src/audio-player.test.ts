import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-audio", () => {
  interface FakeState {
    uri: string;
    played: number;
    paused: number;
    removed: number;
    statusCb: ((s: { isLoaded: boolean; didJustFinish?: boolean }) => void) | null;
  }
  const players: FakeState[] = [];
  const createAudioPlayer = vi.fn((source: string) => {
    const state: FakeState = {
      uri: source,
      played: 0,
      paused: 0,
      removed: 0,
      statusCb: null,
    };
    players.push(state);
    const player = {
      play() {
        state.played++;
      },
      pause() {
        state.paused++;
      },
      remove() {
        state.removed++;
      },
      addListener(
        _event: string,
        cb: (s: { isLoaded: boolean; didJustFinish?: boolean }) => void
      ) {
        state.statusCb = cb;
        return { remove: vi.fn() };
      },
    };
    return player;
  });
  return { createAudioPlayer, __testPlayers: players };
});

import { createAudioPlayer as mockCreate } from "expo-audio";
import { createAudioPlayer, type AudioPlayerBackend } from "./audio-player";

const mockedCreate = mockCreate as unknown as ReturnType<typeof vi.fn>;
const { __testPlayers } = (await import("expo-audio")) as unknown as {
  __testPlayers: Array<{
    uri: string;
    played: number;
    paused: number;
    removed: number;
    statusCb: ((s: { isLoaded: boolean; didJustFinish?: boolean }) => void) | null;
  }>;
};

beforeEach(() => {
  mockedCreate.mockClear();
  __testPlayers.length = 0;
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
    expect(mockedCreate.mock.calls[0]![0]).toBe("https://cdn.example.com/a.mp3");
    await player.play();
    await player.pause();
    await player.unload();
    expect(__testPlayers[0]!.played).toBe(1);
    expect(__testPlayers[0]!.paused).toBe(1);
    expect(__testPlayers[0]!.removed).toBe(1);
  });

  it("load reemplaza el sonido anterior con unload previo", async () => {
    const player = createAudioPlayer();
    await player.load("https://cdn.example.com/a.mp3");
    await player.load("https://cdn.example.com/b.mp3");
    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(__testPlayers[0]!.removed).toBe(1);
    expect(__testPlayers[1]!.uri).toBe("https://cdn.example.com/b.mp3");
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
          play() {
            calls.push("play");
          },
          pause() {
            calls.push("pause");
          },
          remove() {
            calls.push("unload");
          },
          addListener() {
            return { remove: () => {} };
          },
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
    __testPlayers[0]!.statusCb?.({ isLoaded: true, didJustFinish: true });
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
