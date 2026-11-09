import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryWordStore } from "./memory-store";
import {
  DISMISSED_UPDATE_KEY,
  LatestJsonSchema,
  metadataOrNull,
  fetchLatestJson,
  readDismissedVersion,
  writeDismissedVersion,
  clearDismissedVersion,
} from "./update-notice";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_LATEST = {
  contentVersion: "42",
  manifestUrl: "https://cdn.example.com/seed/42/manifest.json",
  zipUrl: "https://cdn.example.com/seed/42/piiyaak-seed.zip",
  bytesTotal: 12_400_000,
  files: 150,
  updatedAt: "2026-11-09T03:00:12.345Z",
};

/**
 * T-W2.2 — enganche `latest.json` + descarte kv (spec §W2.1, §W2.4,
 * casos §W2.6 2–3 y 5). `db-context.tsx` no se importa en Node
 * (módulos expo-*); su cableado se fija por contrato estático
 * (precedente: `seed-progress.test.ts`) y los helpers se prueban reales.
 */
describe("latest.json (borde validado)", () => {
  it("válido y coincidente con remote → bytesTotal/files", () => {
    expect(LatestJsonSchema.safeParse(VALID_LATEST).success).toBe(true);
    expect(metadataOrNull(VALID_LATEST, "42")).toEqual({
      bytesTotal: 12_400_000,
      files: 150,
    });
  });

  it("inválido (campo ausente / tipos mal) → nulls, el gate manda", () => {
    expect(metadataOrNull({ ...VALID_LATEST, files: "150" }, "42")).toEqual({
      bytesTotal: null,
      files: null,
    });
    expect(metadataOrNull({ contentVersion: "42" }, "42")).toEqual({
      bytesTotal: null,
      files: null,
    });
    expect(metadataOrNull(null, "42")).toEqual({ bytesTotal: null, files: null });
  });

  it("divergente (contentVersion !== remote del gate) → nulls", () => {
    expect(metadataOrNull({ ...VALID_LATEST, contentVersion: "41" }, "42")).toEqual({
      bytesTotal: null,
      files: null,
    });
  });
});

describe("fetchLatestJson (tolerancia de red)", () => {
  const jsonOk = (body: unknown) =>
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

  it("404 (latest.json aún no publicado) → null sin lanzar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response)
    );
    await expect(fetchLatestJson("https://cdn.example.com")).resolves.toBeNull();
  });

  it("200 con JSON válido → el cuerpo crudo (la validación la hace metadataOrNull)", async () => {
    const fetchMock = jsonOk(VALID_LATEST);
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLatestJson("https://cdn.example.com/")).resolves.toEqual(VALID_LATEST);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(calledUrl).toBe("https://cdn.example.com/seed/latest.json");
  });

  it("sin red → lanza (el catch vigente del provider lo cubre: sin aviso)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network request failed");
      })
    );
    await expect(fetchLatestJson("https://cdn.example.com")).rejects.toThrow();
  });
});

describe("descarte kv (piiyaak:dismissedUpdate)", () => {
  it("usa la clave exacta del spec", () => {
    expect(DISMISSED_UPDATE_KEY).toBe("piiyaak:dismissedUpdate");
  });

  it("round-trip write → read preserva la versión byte a byte", async () => {
    const store = new MemoryWordStore();
    await expect(readDismissedVersion(store)).resolves.toBeNull();
    await writeDismissedVersion(store, "42");
    await expect(readDismissedVersion(store)).resolves.toBe("42");
    expect(await store.getKV("piiyaak:dismissedUpdate")).toBe("42");
  });

  it("clear deja lápida vacía que se lee como ausente (patrón seed-expo)", async () => {
    const store = new MemoryWordStore();
    await writeDismissedVersion(store, "42");
    await clearDismissedVersion(store);
    await expect(readDismissedVersion(store)).resolves.toBeNull();
  });
});

describe("db-context (contrato estático del enganche)", () => {
  const ctx = () => src("src/db-context.tsx");

  it("expone updateAvailable/dismissUpdate/acceptUpdate sin cambiar el gate", () => {
    expect(ctx()).toContain("updateAvailable");
    expect(ctx()).toContain("dismissUpdate");
    expect(ctx()).toContain("acceptUpdate");
    expect(ctx()).toContain("decideNotice");
    expect(ctx()).toContain("compareVersions");
  });

  it("consulta latest.json post-gate y aplica descarte persistido", () => {
    expect(ctx()).toContain("latest.json");
    expect(ctx()).toContain("metadataOrNull");
    expect(ctx()).toContain("readDismissedVersion");
    expect(ctx()).toContain("writeDismissedVersion");
    expect(ctx()).toContain("clearDismissedVersion");
    expect(ctx()).toContain("fetchLatestJson");
  });

  it("ante remote > local ya NO descarga de inmediato: espera la decisión", () => {
    // La llamada directa del efecto con los valores del gate desaparece;
    // `runSeedInternal` solo se invoca desde accept/retry (args del request
    // guardado, nunca `move.remote` directo).
    expect(ctx()).not.toContain("await runSeedInternal(baseUrl, move.remote, remote.serverTime);");
  });

  it("los caminos skip/noop/catch no muestran aviso", () => {
    // skip y noop retornan antes de decidir; el catch resuelve a none.
    expect(ctx()).toContain('status: "none"');
  });
});
