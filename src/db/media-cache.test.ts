import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-file-system", () => import("./__mocks__/expo-file-system"));

import * as FileSystem from "expo-file-system";
import { __reset, __listAll } from "./__mocks__/expo-file-system";

beforeEach(() => {
  __reset();
});

/**
 * B3-01 (CA5 infraestructura, R6): mock en memoria de `expo-file-system`.
 * Ningún test de medios toca disco real.
 */
describe("mock expo-file-system en memoria (B3-01)", () => {
  it("ciclo escribir→existe→listar→eliminar sin tocar disco", async () => {
    const dir = `${FileSystem.documentDirectory}audios/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const dest = `${dir}abc123.mp3`;
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
    const dl = await FileSystem.downloadAsync(
      "https://cdn.example.com/a.mp3",
      dest
    );
    expect(dl.uri).toBe(dest);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
    const entries = await FileSystem.readDirectoryAsync(dir);
    expect(entries.some((e) => dest.endsWith(String(e)))).toBe(true);
    await FileSystem.deleteAsync(dest, { idempotent: true });
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
    expect(__listAll()).not.toContain(dest);
  });
});
