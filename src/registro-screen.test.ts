import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { REGISTRATION_DISABLED_MESSAGE } from "./api";

/**
 * La pantalla /registro es informativa (Fase 3 APK): no renderiza
 * formulario ni dispara POST a /register. Sin renderer RN en entorno
 * node, se verifica sobre el fuente: no debe importar auth/register
 * ni referenciar el endpoint, y debe mostrar el aviso compartido.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app", "registro.tsx"), "utf8");

describe("registro screen (Google-first, sin POST)", () => {
  it("shows the shared disabled-registration message", () => {
    expect(REGISTRATION_DISABLED_MESSAGE).toContain("web con Google");
    expect(source).toContain("REGISTRATION_DISABLED_MESSAGE");
  });

  it("has no registration POST path", () => {
    expect(source).not.toContain("/api/auth/register");
    expect(source).not.toContain("registerRequest");
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain("SecureStore");
    expect(source).not.toMatch(/method:\s*["']POST["']/);
    expect(source).not.toContain("TextInput");
  });

  it("offers volver / entrar navigation", () => {
    expect(source).toContain("router.back()");
    expect(source).toContain('router.replace("/ajustes")');
  });
});
