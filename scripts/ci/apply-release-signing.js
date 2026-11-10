/**
 * Aplica la config de firma release a android/app/build.gradle DESPUÉS de
 * `expo prebuild` (que regenera android/ desde cero y borraría ediciones
 * manuales). Uso en CI: `node scripts/ci/apply-release-signing.js`.
 * Idempotente: si ya está aplicado, no toca nada.
 */
const fs = require("node:fs");
const path = require("node:path");

const gradlePath = path.join(
  __dirname,
  "..",
  "..",
  "android",
  "app",
  "build.gradle"
);

const ANCHOR_DEBUG_CLOSE = `            keyPassword 'android'
        }
    }`;
const RELEASE_BLOCK = `            keyPassword 'android'
        }
        // CI release: keystore real vía variables de entorno (inyectadas por
        // el workflow desde secrets). Local: cae al debug.keystore.
        release {
            if (System.getenv("KEYSTORE_FILE") && System.getenv("KEYSTORE_PASSWORD")
                    && System.getenv("KEY_ALIAS") && System.getenv("KEY_PASSWORD")) {
                storeFile file(System.getenv("KEYSTORE_FILE"))
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`;

const ANCHOR_VERSION = `        versionCode 1
        versionName "0.1.0"`;
const RELEASE_VERSION = `        // CI: versionCode/Name llegan por propiedades (-PversionCode=...).
        // Local: fallback estático (0.1.0 / 1).
        versionCode project.findProperty('versionCode')?.toInteger() ?: 1
        versionName project.findProperty('versionName') ?: "0.1.0"`;

let s = fs.readFileSync(gradlePath, "utf8");
let changed = false;

function once(haystack, needle, replacement, label, marker) {
  if (haystack.includes(marker)) return haystack;
  if (!haystack.includes(needle)) {
    console.error(`ancla no encontrada: ${label}`);
    process.exit(1);
  }
  changed = true;
  return haystack.replace(needle, replacement);
}

const MARK_RELEASE = 'System.getenv("KEYSTORE_FILE")';
const MARK_VERSION = "project.findProperty('versionCode')";

s = once(s, ANCHOR_DEBUG_CLOSE, RELEASE_BLOCK, "signingConfigs", MARK_RELEASE);
s = once(s, ANCHOR_VERSION, RELEASE_VERSION, "versionCode", MARK_VERSION);

if (changed) {
  fs.writeFileSync(gradlePath, s);
  console.log("signing release aplicado a build.gradle");
} else {
  console.log("signing release ya estaba aplicado; sin cambios");
}
