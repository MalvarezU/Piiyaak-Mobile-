/**
 * Genera la semilla (seed) de la APK desde un dump SQL de MariaDB (prod).
 *
 * Reemplaza el flujo `seed-content.yml` para builds locales:
 *   1. Parse del dump → assets/piiyaak.db (schema v4 de sqlite-store.ts,
 *      solo PUBLISHED, normalización idéntica a src/normalize.ts).
 *   2. Descarga los medios únicos referenciados (words, coverImage,
 *      lesson content) desde R2 → dist/seed/media/<sha256>.<ext>.
 *   3. Copia los medios a assets/audios|illustrations con el basename
 *      exacto de la URL (contrato de los puentes offline: sufijo audio,
 *      equality case-insensitive ilustración).
 *   4. Empaqueta dist/seed/piiyaak-seed.zip (piiyaak.db + media/) y
 *      dist/seed/manifest.json (contrato piiyaak-seed/1, validado contra
 *      src/db/seed-manifest.ts con el Zod de la app).
 *   5. Escribe dist/seed/latest.json (contrato de update-notice.ts).
 *
 * Uso:
 *   npx tsx scripts/build-seed-from-sql.ts --sql "/ruta/dump.sql"
 *
 * Env opcional: R2_PUBLIC_BASE_URL (default bucket test conocido).
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSeedManifest } from "../src/db/seed-manifest";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const DIST_SEED = join(ROOT, "dist", "seed");

/** Schema EXACTO de src/db/sqlite-store.ts (no importable: arrastra expo-sqlite). */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  spanish TEXT NOT NULL,
  nasaYuwe TEXT NOT NULL,
  pronunciation TEXT,
  audioUrl TEXT,
  illustrationUrl TEXT,
  culturalContext TEXT,
  category TEXT,
  examples TEXT,
  status TEXT,
  updatedAt TEXT NOT NULL,
  spanish_norm TEXT NOT NULL DEFAULT '',
  nasaYuwe_norm TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_words_spanish ON words(spanish_norm);
CREATE INDEX IF NOT EXISTS idx_words_updated ON words(updatedAt);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  coverImage TEXT,
  sequential INTEGER NOT NULL DEFAULT 1,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL,
  title TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  moduleId TEXT NOT NULL,
  title TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  lessonNumber TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (moduleId) REFERENCES modules(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS course_progress (
  lessonId TEXT PRIMARY KEY,
  completed INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  lastVisitedAt TEXT NOT NULL,
  completedAt TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  syncedAt TEXT
);
CREATE TABLE IF NOT EXISTS history (
  wordId TEXT PRIMARY KEY,
  viewedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_manifest (
  word_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio','illustration')),
  url TEXT NOT NULL,
  sha256 TEXT,
  local_uri TEXT NOT NULL,
  PRIMARY KEY (word_id, kind)
);
`;

/** Normalización idéntica a src/normalize.ts. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Parser SQL (dump MariaDB: INSERT INTO `T` (cols) VALUES\n(row),\n(row);
// ---------------------------------------------------------------------------

/** Escanea tuplas respetando comillas simples y escapes de MySQL.
 * Los escapes se resuelven EN PASADA ÚNICA (los valores salen ya unescaped). */
function parseInsertTuples(block: string): string[][] {
  const tuples: string[][] = [];
  let i = 0;
  const n = block.length;
  while (i < n) {
    // Buscar el inicio de una tupla: '(' a nivel superior
    if (block[i] !== "(") {
      i++;
      continue;
    }
    i++; // saltar '('
    let depth = 1;
    let cur = "";
    let inStr = false;
    let sawQuote = false;
    const fields: string[] = [];
    while (i < n && depth > 0) {
      const c = block[i];
      if (inStr) {
        if (c === "\\") {
          cur += unescapeChar(block[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "'") {
          if (block[i + 1] === "'") {
            cur += "'"; // '' escapado estilo MySQL
            i += 2;
            continue;
          }
          inStr = false;
          i++;
          continue;
        }
        cur += c;
        i++;
        continue;
      }
      if (c === "'") {
        inStr = true; // la comilla NO entra al valor
        sawQuote = true;
        cur = cur.trimStart(); // el espacio tras la coma es separador
        i++;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") {
        depth--;
        if (depth === 0) {
          fields.push(sawQuote ? cur : cur.trim());
          break;
        }
      }
      if (c === "," && depth === 1) {
        fields.push(sawQuote ? cur : cur.trim());
        cur = "";
        sawQuote = false;
        i++;
        continue;
      }
      cur += c;
      i++;
    }
    tuples.push(fields);
  }
  return tuples;
}

/** Escape de MySQL después de '\\' — pasada única. */
function unescapeChar(d: string): string {
  switch (d) {
    case "'": return "'";
    case '"': return '"';
    case "\\": return "\\";
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "0": return "\0";
    case "Z": return "\u001a";
    case "b": return "\b";
    default: return d;
  }
}

/** Literal SQL ya unescaped por el scanner; solo mapea NULL. */
function unescapeSql(raw: string | null): string | null {
  if (raw === null || raw === "NULL") return null;
  return raw;
}

/** Extrae el bloque completo de INSERTs de una tabla (hasta el ';' final). */
function extractInsertBlocks(sql: string, table: string): string {
  const out: string[] = [];
  const re = /INSERT INTO `([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1] !== table) continue;
    // desde el match, hasta el '; ' a nivel de sentencia (los strings no
    // contienen ";\n" en este dump) — escaneamos respetando comillas.
    let i = m.index;
    let inStr = false;
    let end = i;
    while (i < sql.length) {
      const c = sql[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") inStr = !inStr;
      if (c === ";" && !inStr) {
        end = i;
        break;
      }
      i++;
    }
    out.push(sql.slice(m.index, end));
  }
  return out.join("\n");
}

interface ParsedTable {
  cols: string[];
  rows: string[][];
}

function parseTable(sql: string, table: string): ParsedTable {
  const block = extractInsertBlocks(sql, table);
  if (!block) return { cols: [], rows: [] };
  const head = /INSERT INTO `[^`]+` \(([^)]+)\) VALUES/.exec(block);
  if (!head) throw new Error(`cabecera INSERT de ${table} no reconocida`);
  const cols = head[1].split(",").map((c) => c.trim().replace(/`/g, ""));
  const body = block.slice(head.index + head[0].length);
  const rows = parseInsertTuples(body).map((fields) =>
    fields.map(unescapeSql)
  );
  for (const r of rows) {
    if (r.length !== cols.length) {
      throw new Error(`fila de ${table} con ${r.length} campos, esperaba ${cols.length}`);
    }
  }
  return { cols, rows };
}

function byName(row: string[], cols: string[], name: string): string | null {
  return row[cols.indexOf(name)];
}

/** 'YYYY-MM-DD HH:MM:SS.mmm' (UTC del dump) → ISO 8601 con Z. */
function toIso(mysqlDt: string | null): string {
  if (!mysqlDt) return new Date().toISOString();
  return mysqlDt.replace(" ", "T") + "Z";
}

// ---------------------------------------------------------------------------
// Medios
// ---------------------------------------------------------------------------

const R2_BASE =
  process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  "https://pub-cc9e53869548453a91a0d518d085a6c4.r2.dev";

function mimeFor(url: string): string {
  const ext = extname(url.split("?")[0]).toLowerCase();
  const map: Record<string, string> = {
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
  };
  return map[ext] ?? "application/octet-stream";
}

function downloadTo(url: string, dest: string): void {
  execFileSync(
    "curl",
    ["-fsSL", "--retry", "3", "--max-time", "60", "-o", dest, url],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`falta --${name}`);
  return process.argv[i + 1] as string;
}

async function main(): Promise<void> {
  const sqlPath = arg("sql");
  const sql = readFileSync(sqlPath, "utf8");

  // 1. Parsear tablas
  const words = parseTable(sql, "DictionaryWord");
  const courses = parseTable(sql, "Course");
  const modules = parseTable(sql, "Module");
  const lessons = parseTable(sql, "Lesson");
  const cv = parseTable(sql, "ContentVersion");

  const published = words.rows.filter(
    (r) => byName(r, words.cols, "status") === "PUBLISHED"
  );
  const courseRows = courses.rows.filter(
    (r) => byName(r, courses.cols, "status") === "PUBLISHED"
  );
  const moduleRows = modules.rows.filter((r) => !byName(r, modules.cols, "deletedAt"));
  const lessonRows = lessons.rows.filter((r) => !byName(r, lessons.cols, "deletedAt"));
  const contentVersion = byName(cv.rows[0] ?? [], cv.cols, "version") ?? "1";

  console.log(
    `dump: ${published.length} words PUBLISHED (de ${words.rows.length}), ` +
      `${courseRows.length} curso(s), ${moduleRows.length} módulos, ${lessonRows.length} lecciones, contentVersion=${contentVersion}`
  );

  // 2. Recolectar URLs de medios únicos (words + coverImage + lesson content)
  const urlKind = new Map<string, "audio" | "illustration">();
  const addUrl = (u: string | null) => {
    if (!u) return;
    urlKind.set(u, u.includes("/audios/") ? "audio" : "illustration");
  };
  for (const r of published) {
    addUrl(byName(r, words.cols, "audioUrl"));
    addUrl(byName(r, words.cols, "illustrationUrl"));
  }
  for (const r of courseRows) {
    addUrl(byName(r, courses.cols, "coverImage"));
  }
  for (const r of lessonRows) {
    const content = byName(r, lessons.cols, "content") ?? "";
    for (const u of content.match(/https:\/\/pub-[a-z0-9]+\.r2\.dev[^"\\ ,)}\]]+/g) ?? []) {
      urlKind.set(u, u.includes("/audios/") ? "audio" : "illustration");
    }
  }
  console.log(`medios únicos referenciados: ${urlKind.size}`);

  // 3. Descargar a dist/seed/media/<sha256>.<ext>
  rmSync(DIST_SEED, { recursive: true, force: true });
  mkdirSync(join(DIST_SEED, "media"), { recursive: true });
  const files: Array<{
    objectKey: string;
    sha256: string;
    size: number;
    mimeType: string;
    localPath: string;
  }> = [];
  let bytesAudio = 0;
  let bytesImage = 0;
  for (const [url, kind] of urlKind) {
    const tmp = join(DIST_SEED, "media", `__tmp_${files.length}`);
    downloadTo(url, tmp);
    const sha256 = createHash("sha256").update(readFileSync(tmp)).digest("hex");
    const ext = extname(url.split("?")[0]).toLowerCase().slice(1) || "bin";
    const localPath = `media/${sha256}.${ext}`;
    const dest = join(DIST_SEED, localPath);
    if (statSync(tmp).size === 0) throw new Error(`descarga vacía: ${url}`);
    // Deduplicación por contenido: dos URLs con mismo sha → un solo archivo
    if (files.some((f) => f.sha256 === sha256)) {
      rmSync(tmp);
      continue;
    }
    execFileSync("mv", [tmp, dest]);
    const size = statSync(dest).size;
    const base = url.split("?")[0].split("/").pop() as string;
    // objectKey convención propia: audios/<base> | illustrations/<base>
    const objectKey = kind === "audio" ? `audios/${base}` : `illustrations/${base}`;
    files.push({ objectKey, sha256, size, mimeType: mimeFor(url), localPath });
    if (kind === "audio") bytesAudio += size;
    else bytesImage += size;
  }
  files.sort((a, b) => (a.objectKey < b.objectKey ? -1 : 1));
  console.log(`descargados: ${files.length} (sin duplicados por sha256)`);

  // 4. Copiar a assets/ con basename exacto (reemplaza los viejos)
  for (const dir of ["assets/audios", "assets/illustrations"]) {
    const abs = join(ROOT, dir);
    for (const f of readdirSync(abs)) {
      if (!f.startsWith(".")) rmSync(join(abs, f), { force: true });
    }
  }
  for (const f of files) {
    const kindDir = f.objectKey.startsWith("audios/") ? "assets/audios" : "assets/illustrations";
    const base = f.objectKey.split("/").pop() as string;
    copyFileSync(join(DIST_SEED, f.localPath), join(ROOT, kindDir, base));
  }
  console.log(`assets actualizados: audios=${files.filter((f) => f.objectKey.startsWith("audios/")).length}, illustrations=${files.filter((f) => f.objectKey.startsWith("illustrations/")).length}`);

  // 5. Construir SQLite
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = join(DIST_SEED, "piiyaak.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const insertWord = db.prepare(
    `INSERT INTO words (id, spanish, nasaYuwe, pronunciation, audioUrl, illustrationUrl,
       culturalContext, category, examples, status, updatedAt, spanish_norm, nasaYuwe_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of published) {
    const spanish = byName(r, words.cols, "spanish") as string;
    const nasaYuwe = byName(r, words.cols, "nasaYuwe") as string;
    insertWord.run(
      byName(r, words.cols, "id"),
      spanish,
      nasaYuwe,
      byName(r, words.cols, "pronunciation"),
      byName(r, words.cols, "audioUrl"),
      byName(r, words.cols, "illustrationUrl"),
      byName(r, words.cols, "culturalContext"),
      byName(r, words.cols, "category"),
      byName(r, words.cols, "examples") ?? "[]",
      byName(r, words.cols, "status"),
      toIso(byName(r, words.cols, "updatedAt")),
      normalize(spanish),
      normalize(nasaYuwe)
    );
  }
  const insertCourse = db.prepare(
    `INSERT INTO courses (id, title, description, status, coverImage, sequential, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of courseRows) {
    insertCourse.run(
      byName(r, courses.cols, "id"),
      byName(r, courses.cols, "title"),
      byName(r, courses.cols, "description"),
      byName(r, courses.cols, "status"),
      byName(r, courses.cols, "coverImage"),
      byName(r, courses.cols, "sequential") === "1" ? 1 : 0,
      toIso(byName(r, courses.cols, "updatedAt"))
    );
  }
  const insertModule = db.prepare(
    `INSERT INTO modules (id, courseId, title, "order") VALUES (?, ?, ?, ?)`
  );
  for (const r of moduleRows) {
    insertModule.run(
      byName(r, modules.cols, "id"),
      byName(r, modules.cols, "courseId"),
      byName(r, modules.cols, "title"),
      Number(byName(r, modules.cols, "order") ?? 0)
    );
  }
  const insertLesson = db.prepare(
    `INSERT INTO lessons (id, moduleId, title, "order", lessonNumber, content)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const r of lessonRows) {
    insertLesson.run(
      byName(r, lessons.cols, "id"),
      byName(r, lessons.cols, "moduleId"),
      byName(r, lessons.cols, "title"),
      Number(byName(r, lessons.cols, "order") ?? 0),
      byName(r, lessons.cols, "lessonNumber"),
      byName(r, lessons.cols, "content") ?? "{}"
    );
  }
  const cvUpdatedAt = toIso(byName(cv.rows[0] ?? [], cv.cols, "updatedAt"));
  const kvPairs: Array<[string, string]> = [
    ["piiyaak:contentVersion", contentVersion],
    ["piiyaak:lastSync", cvUpdatedAt],
    ["schemaVersion", "4"],
  ];
  const insertKv = db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?)`);
  for (const [k, v] of kvPairs) insertKv.run(k, v);
  // sanity: conteos + integridad
  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  const integrity = (db.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string }).integrity_check;
  if (integrity !== "ok") throw new Error(`integrity_check: ${integrity}`);
  const wCount = count("words");
  const cCount = count("courses");
  const lCount = count("lessons");
  db.close();
  if (wCount !== published.length || cCount !== courseRows.length || lCount !== lessonRows.length) {
    throw new Error("conteos divergentes tras insertar");
  }

  // 6. Copiar la DB a assets/ (misma bytes que el zip)
  copyFileSync(dbPath, join(ROOT, "assets", "piiyaak.db"));

  // 7. Zip (piiyaak.db en raíz + media/)
  const zipBytes = (() => {
    const out = join(DIST_SEED, "piiyaak-seed.zip");
    execFileSync("zip", ["-q", "-r", out, "piiyaak.db", "media/"], { cwd: DIST_SEED });
    return statSync(out).size;
  })();

  // 8. Manifest (contrato piiyaak-seed/1) + validación con el Zod de la app
  const dbBytes = statSync(dbPath).size;
  const dbSha256 = createHash("sha256").update(readFileSync(dbPath)).digest("hex");
  const bytesTotal = dbBytes + files.reduce((a, f) => a + f.size, 0);
  const manifest = {
    format: "piiyaak-seed/1",
    contentVersion,
    createdAt: new Date().toISOString(),
    dbSha256,
    dbBytes,
    zipBytes,
    files,
    counts: {
      words: wCount,
      courses: cCount,
      modules: moduleRows.length,
      lessons: lCount,
      mediaFiles: files.length,
    },
    bytesTotal,
    bytesAudio,
    bytesImage,
  };
  parseSeedManifest(manifest); // falla cerrado si el contrato no se cumple
  writeFileSync(join(DIST_SEED, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 9. latest.json (contrato de update-notice.ts)
  const latest = {
    contentVersion,
    manifestUrl: `${R2_BASE}/seed/${contentVersion}/manifest.json`,
    zipUrl: `${R2_BASE}/seed/${contentVersion}/piiyaak-seed.zip`,
    bytesTotal,
    files: files.length,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(DIST_SEED, "latest.json"), JSON.stringify(latest, null, 2));

  console.log("");
  console.log(`✔ assets/piiyaak.db actualizado (${wCount} words, v${contentVersion})`);
  console.log(`✔ dist/seed/piiyaak-seed.zip (${(zipBytes / 1e6).toFixed(2)} MB) + manifest.json + latest.json`);
  console.log(`  db: ${(dbBytes / 1e6).toFixed(2)} MB · medios: ${files.length} archivos (${(bytesAudio / 1e6).toFixed(2)} MB audio, ${(bytesImage / 1e6).toFixed(2)} MB imágenes)`);
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
