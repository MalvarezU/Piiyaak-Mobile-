/**
 * W3 — esquema `manifest.json` + verificación en el dispositivo (spec §2.6, §4.4).
 *
 * Decisión §4.4: NO se recalcula `sha256` por archivo en el dispositivo
 * (sin lector de bytes en la frontera; decenas de MB en el hilo JS
 * compiten con ANR en gama media/baja). Cobertura por capas:
 * HTTPS (transporte) + CRC32 del unzip nativo + existencia/size por
 * archivo + `dbSha256` verificado en CI (§3.2 paso 8) + integrity_check
 * + schemaVersion + contentVersion conjunta + conteos.
 */
import { z } from "zod";

export const SEED_FORMAT = "piiyaak-seed/1";
export const SEED_SCHEMA_VERSION = "4";

const HEX64 = z.string().regex(/^[0-9a-f]{64}$/);
const NONNEG = z.number().int().nonnegative();
const CANONICAL_VERSION = z.string().regex(/^\d+$/);

const SeedManifestFileSchema = z.object({
  objectKey: z.string().min(1),
  sha256: HEX64,
  size: NONNEG,
  mimeType: z.string().min(1),
  localPath: z.string().regex(/^media\/[0-9a-f]{64}\.[a-z0-9]{1,5}$/),
});
export type SeedManifestFile = z.infer<typeof SeedManifestFileSchema>;

const SeedCountsSchema = z.object({
  words: NONNEG,
  courses: NONNEG,
  modules: NONNEG,
  lessons: NONNEG,
  mediaFiles: NONNEG,
});

export const SeedManifestSchema = z
  .object({
    format: z.literal(SEED_FORMAT),
    contentVersion: CANONICAL_VERSION,
    createdAt: z.string().datetime(),
    dbSha256: HEX64,
    dbBytes: NONNEG,
    zipBytes: NONNEG,
    files: z.array(SeedManifestFileSchema),
    counts: SeedCountsSchema,
    bytesTotal: NONNEG,
    bytesAudio: NONNEG,
    bytesImage: NONNEG,
  })
  .refine(
    (m) => {
      const keys = m.files.map((f) => f.objectKey);
      const sorted = [...keys].sort();
      return keys.every((k, i) => k === sorted[i]) && new Set(keys).size === keys.length;
    },
    { message: "files debe venir ordenado por objectKey asc, sin duplicados" }
  )
  .refine((m) => m.counts.mediaFiles === m.files.length, {
    message: "counts.mediaFiles debe coincidir con files.length",
  })
  .refine((m) => m.bytesTotal === m.dbBytes + m.files.reduce((acc, f) => acc + f.size, 0), {
    message: "bytesTotal debe ser dbBytes + Σ files[].size",
  });

export type SeedManifest = z.infer<typeof SeedManifestSchema>;

/** Manifiesto inválido (schema Zod en el borde): sin swap, error + reintento. */
export function parseSeedManifest(json: unknown): SeedManifest {
  return SeedManifestSchema.parse(json);
}

/** Frontera FS mínima para verificar (producción: `expo-file-system`). */
export interface SeedVerifyFs {
  fileInfo(uri: string): Promise<{ exists: boolean; size: number | null }>;
  freeDiskBytes(): Promise<number>;
}

/** Lectura mínima sobre la db temporal (producción: `expo-sqlite`). */
export interface SeedVerifyDb {
  integrityCheck(): Promise<string>;
  getKV(key: string): Promise<string | null>;
  count(table: "words" | "courses" | "lessons"): Promise<number>;
}

export class SeedVerifyError extends Error {
  constructor(
    public readonly reason: string,
    detail?: string
  ) {
    super(detail ? `[seed-verify] ${reason}: ${detail}` : `[seed-verify] ${reason}`);
    this.name = "SeedVerifyError";
  }
}

/**
 * Verificación §4.4 en orden. Cualquier fallo lanza `SeedVerifyError`
 * y el llamador NO avanza al swap (la db viva queda intacta).
 */
export async function verifySeedDir(opts: {
  fs: SeedVerifyFs;
  db: SeedVerifyDb;
  tmpDir: string;
  manifest: SeedManifest;
  remote: string;
  uncompressedBytes: number;
}): Promise<void> {
  const { fs, db, tmpDir, manifest, remote, uncompressedBytes } = opts;

  const free = await fs.freeDiskBytes();
  if (free < uncompressedBytes + manifest.dbBytes) {
    throw new SeedVerifyError(
      "espacio insuficiente",
      `libre ${free} < requerido ${uncompressedBytes + manifest.dbBytes}`
    );
  }

  for (const file of manifest.files) {
    const info = await fs.fileInfo(`${tmpDir}${file.localPath}`);
    if (!info.exists) {
      throw new SeedVerifyError("archivo faltante", file.localPath);
    }
    if (info.size !== null && info.size !== file.size) {
      throw new SeedVerifyError(
        "tamaño distinto",
        `${file.localPath}: esperado ${file.size}, real ${info.size}`
      );
    }
  }

  const integrity = (await db.integrityCheck()).trim().toLowerCase();
  if (integrity !== "ok") {
    throw new SeedVerifyError("integrity_check fallido", integrity);
  }

  const schemaVersion = await db.getKV("schemaVersion");
  if (schemaVersion !== SEED_SCHEMA_VERSION) {
    throw new SeedVerifyError(
      "schemaVersion incompatible",
      `esperado ${SEED_SCHEMA_VERSION}, real ${JSON.stringify(schemaVersion)}`
    );
  }

  const dbVersion = await db.getKV("piiyaak:contentVersion");
  if (dbVersion !== remote) {
    throw new SeedVerifyError(
      "contentVersion divergente",
      `db ${JSON.stringify(dbVersion)} !== remoto ${JSON.stringify(remote)}`
    );
  }

  const expected: Record<"words" | "courses" | "lessons", number> = {
    words: manifest.counts.words,
    courses: manifest.counts.courses,
    lessons: manifest.counts.lessons,
  };
  for (const table of ["words", "courses", "lessons"] as const) {
    const real = await db.count(table);
    if (real !== expected[table]) {
      throw new SeedVerifyError(
        "conteo divergente",
        `${table}: esperado ${expected[table]}, real ${real}`
      );
    }
  }
}
