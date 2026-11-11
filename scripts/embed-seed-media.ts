/**
 * Embebe los medios del seed en assets/: media/<sha>.<ext> → assets/audios|images
 * con el nombre original (basename del objectKey del manifest). Después,
 * generate-bundled-media-map.ts regenera el mapa de require().
 *
 * Uso: bun run scripts/embed-seed-media.ts --manifest <path> --media <dir>
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

interface ManifestFile {
  objectKey: string;
  sha256: string;
  size: number;
  mimeType: string;
  localPath: string;
}
interface Manifest {
  format: string;
  contentVersion: number | string;
  files: ManifestFile[];
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`falta --${name}`);
  return process.argv[i + 1] as string;
}

const manifestPath = arg("manifest");
const mediaDir = arg("media");
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.format !== "piiyaak-seed/1") throw new Error(`formato inesperado: ${manifest.format}`);

const assetsDir = join(process.cwd(), "assets");
let copied = 0;
for (const f of manifest.files) {
  const src = join(mediaDir, basename(f.localPath));
  if (!existsSync(src)) throw new Error(`falta el medio del seed: ${src}`);
  // Destino: assets/audios/<basename> o assets/illustrations/<basename> (por el objectKey)
  const kind = f.objectKey.startsWith("audios/")
    ? "audios"
    : f.objectKey.startsWith("illustrations/")
      ? "illustrations"
      : "images";
  const destDir = join(assetsDir, kind);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(f.objectKey));
  copyFileSync(src, dest);
  copied++;
  console.log(`embebido: ${kind}/${basename(f.objectKey)}`);
}

// Verificación: cada archivo embebido coincide con su sha256
const verify = (p: string): string => {
  const h = createHash("sha256");
  h.update(readFileSync(p));
  return h.digest("hex");
};
for (const f of manifest.files) {
  const kind = f.objectKey.startsWith("audios/") ? "audios" : "images";
  const p = join(assetsDir, kind, basename(f.objectKey));
  const got = verify(p);
  if (got !== f.sha256) throw new Error(`hash mismatch: ${p}`);
}
console.log(`embebidos y verificados: ${copied} (sha256 ok)`);
