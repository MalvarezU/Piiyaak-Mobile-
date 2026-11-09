import { describe, it, expect } from "vitest";
import {
  initialUpdateNoticeState,
  decideNotice,
  dismissNotice,
  acceptNotice,
  settleNotice,
} from "./update-notice";

/**
 * T-W2.1 — máquina de 5 estados del aviso (spec §W2.3, casos §W2.6 1–4).
 * Lógica pura, sin imports expo-*.
 */
describe("update-notice (máquina pura)", () => {
  it("nace en checking", () => {
    expect(initialUpdateNoticeState).toEqual({ status: "checking" });
  });

  it("remote == local → none, sin aviso", () => {
    expect(
      decideNotice({
        local: "42",
        remote: "42",
        serverTime: "2026-11-09T03:00:12.345Z",
        dismissed: null,
        metadata: { bytesTotal: 12_400_000, files: 150 },
      })
    ).toEqual({ status: "none" });
  });

  it("remote < local (noop) → none, sin aviso", () => {
    expect(
      decideNotice({
        local: "43",
        remote: "42",
        serverTime: "2026-11-09T03:00:12.345Z",
        dismissed: null,
        metadata: { bytesTotal: null, files: null },
      })
    ).toEqual({ status: "none" });
  });

  it("remote > local → available con los metadatos recibidos", () => {
    expect(
      decideNotice({
        local: "41",
        remote: "42",
        serverTime: "2026-11-09T03:00:12.345Z",
        dismissed: null,
        metadata: { bytesTotal: 12_400_000, files: 150 },
      })
    ).toEqual({
      status: "available",
      update: {
        remote: "42",
        serverTime: "2026-11-09T03:00:12.345Z",
        bytesTotal: 12_400_000,
        files: 150,
      },
    });
  });

  it("dismissUpdate() → dismissed; el mismo remote no re-avisa", () => {
    const available = decideNotice({
      local: "41",
      remote: "42",
      serverTime: "2026-11-09T03:00:12.345Z",
      dismissed: null,
      metadata: { bytesTotal: null, files: null },
    });
    const dismissed = dismissNotice(available);
    expect(dismissed).toEqual({ status: "dismissed", remote: "42" });

    // El gate vuelve a clasificar seed para el mismo remote descartado.
    expect(
      decideNotice({
        local: "41",
        remote: "42",
        serverTime: "2026-11-09T03:00:12.345Z",
        dismissed: "42",
        metadata: { bytesTotal: null, files: null },
      })
    ).toEqual({ status: "dismissed", remote: "42" });
  });

  it("un remote nuevo sí avisa aunque haya un descarte previo", () => {
    expect(
      decideNotice({
        local: "42",
        remote: "43",
        serverTime: "2026-11-09T03:00:12.345Z",
        dismissed: "42",
        metadata: { bytesTotal: 13_000_000, files: 151 },
      })
    ).toEqual({
      status: "available",
      update: {
        remote: "43",
        serverTime: "2026-11-09T03:00:12.345Z",
        bytesTotal: 13_000_000,
        files: 151,
      },
    });
  });

  it("available → downloading al aceptar; downloading → none al instalar", () => {
    const available = decideNotice({
      local: "41",
      remote: "42",
      serverTime: "2026-11-09T03:00:12.345Z",
      dismissed: null,
      metadata: { bytesTotal: null, files: null },
    });
    expect(acceptNotice(available)).toEqual({ status: "downloading" });
    expect(settleNotice({ status: "downloading" })).toEqual({ status: "none" });
  });

  it("dismiss/accept/settle son no-op fuera de su estado de origen", () => {
    expect(dismissNotice({ status: "none" })).toEqual({ status: "none" });
    expect(acceptNotice({ status: "none" })).toEqual({ status: "none" });
    expect(settleNotice({ status: "none" })).toEqual({ status: "none" });
  });
});
