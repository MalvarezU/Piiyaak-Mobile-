import { describe, it, expect, afterEach } from "vitest";
import { openNodeSqlite, type NodeSqliteHandle } from "./node-sqlite-shim";
import { SQLiteWordStore, SCHEMA, SCHEMA_VERSION } from "../sqlite-store";
import type { WordRow } from "../types";

/**
 * Fase 1 — `SQLiteWordStore` contra SQLite real (no stubs).
 *
 * El test previo (`src/db/outbox.test.ts`) caracterizaba `addOutbox` contra un
 * doble de `SQLiteDatabase`: el SQL nunca se ejecutaba, así que una sintaxis
 * rota, una constraint violada o una migración mal aplicada solo se
 * descubrían en el dispositivo. Este archivo corre el SQL exacto de
 * producción contra `node:sqlite` mediante el shim `node-sqlite-shim.ts`.
 *
 * Reglas de esta suite:
 * - Una aserción por test, con nombres descriptivos en español.
 * - Nada de `it.skip` ni de tests triviales: cada caso falla si el SQL deja
 *   de comportarse como en el teléfono.
 */

/** Fila de palabra completa con valores por defecto sensatos. */
function word(id: string, spanish: string, extra?: Partial<WordRow>): WordRow {
  return {
    id,
    spanish,
    nasaYuwe: `ny-${id}`,
    pronunciation: null,
    audioUrl: null,
    illustrationUrl: null,
    culturalContext: null,
    category: null,
    examples: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** Abre una base en memoria con el store de palabras ya migrado. */
async function openStore(): Promise<{
  handle: NodeSqliteHandle;
  store: SQLiteWordStore;
}> {
  const handle = openNodeSqlite();
  const store = await SQLiteWordStore.open(handle.db);
  return { handle, store };
}

describe("SQLiteWordStore.open — esquema y migración", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("crea todas las tablas del esquema en una base vacía", async () => {
    handle = openNodeSqlite();
    await SQLiteWordStore.open(handle.db);

    const tablas = await handle.db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tablas.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "words",
        "kv",
        "courses",
        "modules",
        "lessons",
        "course_progress",
        "outbox",
        "history",
        "media_manifest",
      ])
    );
  });

  it("registra la versión de esquema en la tabla kv", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    expect(await store.getKV("schemaVersion")).toBe(SCHEMA_VERSION);
  });

  it("no altera la tabla words cuando ya tiene illustrationUrl y status", async () => {
    // Rama "columna presente": `SCHEMA` crea la tabla con ambas columnas, así
    // que el PRAGMA las encuentra y el `ALTER TABLE` no debe ejecutarse.
    const { handle: h, store } = await openStore();
    handle = h;

    const columnas = await h.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(words)"
    );
    const nombres = columnas.map((c) => c.name);
    expect(nombres).toContain("illustrationUrl");
    expect(nombres).toContain("status");

    // Si el `ALTER TABLE` se hubiera ejecutado sobre columnas existentes,
    // SQLite habría lanzado "duplicate column name" y `open` habría fallado.
    await expect(SQLiteWordStore.open(h.db)).resolves.toBeInstanceOf(
      SQLiteWordStore
    );
  });

  it("agrega illustrationUrl y status con ALTER TABLE cuando la tabla words es legacy", async () => {
    // Rama "columna ausente": base creada con el esquema anterior a B1
    // (commit 4c4d8b0), sin `illustrationUrl` ni `status`.
    handle = openNodeSqlite();
    await handle.db.execAsync(`
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        spanish TEXT NOT NULL,
        nasaYuwe TEXT NOT NULL,
        pronunciation TEXT,
        audioUrl TEXT,
        culturalContext TEXT,
        category TEXT,
        examples TEXT,
        updatedAt TEXT NOT NULL,
        spanish_norm TEXT NOT NULL DEFAULT '',
        nasaYuwe_norm TEXT NOT NULL DEFAULT ''
      );
    `);
    const antes = await handle.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(words)"
    );
    expect(antes.map((c) => c.name)).not.toContain("illustrationUrl");

    await SQLiteWordStore.open(handle.db);

    const despues = await handle.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(words)"
    );
    const nombres = despues.map((c) => c.name);
    expect(nombres).toContain("illustrationUrl");
    expect(nombres).toContain("status");
  });

  it("conserva los datos previos al migrar columnas legacy", async () => {
    handle = openNodeSqlite();
    await handle.db.execAsync(`
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        spanish TEXT NOT NULL,
        nasaYuwe TEXT NOT NULL,
        pronunciation TEXT,
        audioUrl TEXT,
        culturalContext TEXT,
        category TEXT,
        examples TEXT,
        updatedAt TEXT NOT NULL,
        spanish_norm TEXT NOT NULL DEFAULT '',
        nasaYuwe_norm TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO words (id, spanish, nasaYuwe, updatedAt, spanish_norm, nasaYuwe_norm)
      VALUES ('w1', 'Casa', 'Kasa', '2026-01-01', 'casa', 'kasa');
    `);

    const store = await SQLiteWordStore.open(handle.db);

    const fila = await store.getById("w1");
    expect(fila?.spanish).toBe("Casa");
    // Las columnas nuevas nacen en NULL: la migración es aditiva.
    expect(fila?.illustrationUrl).toBeNull();
  });

  it("falla con error de sintaxis real cuando el SQL es inválido", async () => {
    // Lo que el stub NO puede detectar: `node:sqlite` ejecuta y valida.
    const { handle: h } = await openStore();
    handle = h;

    await expect(h.db.execAsync("SELEC * FROM words")).rejects.toThrow(
      /syntax error/i
    );
  });

  it("rechaza un INSERT que viola la constraint NOT NULL de words.spanish", async () => {
    const { handle: h } = await openStore();
    handle = h;

    await expect(
      h.db.runAsync(
        "INSERT INTO words (id, spanish, nasaYuwe, updatedAt) VALUES (?, ?, ?, ?)",
        ["w1", null, "Kasa", "2026-01-01"]
      )
    ).rejects.toThrow(/NOT NULL constraint failed/i);
  });
});

describe("SQLiteWordStore.upsertWords", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("inserta una palabra con todos sus campos", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", {
        pronunciation: "KA-sa",
        audioUrl: "https://cdn.test/a.mp3",
        illustrationUrl: "https://cdn.test/a.png",
        culturalContext: "Vivienda",
        category: "casa",
        examples: "la casa",
      }),
    ]);

    const fila = await store.getById("w1");
    expect(fila).toMatchObject({
      spanish: "Casa",
      nasaYuwe: "ny-w1",
      pronunciation: "KA-sa",
      audioUrl: "https://cdn.test/a.mp3",
      illustrationUrl: "https://cdn.test/a.png",
      culturalContext: "Vivienda",
      category: "casa",
      examples: "la casa",
    });
  });

  it("normaliza spanish y nasaYuwe para la búsqueda sin tildes", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Águila", { nasaYuwe: "Ñandú" })]);

    const fila = await h.db.getFirstAsync<{
      spanish_norm: string;
      nasaYuwe_norm: string;
    }>("SELECT spanish_norm, nasaYuwe_norm FROM words WHERE id = 'w1'");
    expect(fila?.spanish_norm).toBe("aguila");
    expect(fila?.nasaYuwe_norm).toBe("nandu");
  });

  it("actualiza los campos de una palabra existente en el upsert", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Casa", { category: "casa" })]);
    await store.upsertWords([word("w1", "Casita", { category: "vivienda" })]);

    const fila = await store.getById("w1");
    expect(fila?.spanish).toBe("Casita");
    expect(fila?.category).toBe("vivienda");
    expect(await store.count()).toBe(1);
  });

  it("conserva el audioUrl previo cuando el upsert trae audioUrl vacío", async () => {
    // El `COALESCE(NULLIF(excluded.audioUrl, ''), audioUrl)` del ON CONFLICT
    // preserva el audio embebido en el dispositivo cuando el servidor manda
    // una cadena vacía (fix 4d69fd3).
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/bundled.mp3" }),
    ]);
    await store.upsertWords([word("w1", "Casa", { audioUrl: "" })]);

    const fila = await store.getById("w1");
    expect(fila?.audioUrl).toBe("https://cdn.test/bundled.mp3");
  });

  it("conserva el illustrationUrl previo cuando el upsert trae illustrationUrl vacío", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { illustrationUrl: "https://cdn.test/bundled.png" }),
    ]);
    await store.upsertWords([word("w1", "Casa", { illustrationUrl: "" })]);

    const fila = await store.getById("w1");
    expect(fila?.illustrationUrl).toBe("https://cdn.test/bundled.png");
  });

  it("reemplaza el audioUrl cuando el upsert trae una URL distinta", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/viejo.mp3" }),
    ]);
    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/nuevo.mp3" }),
    ]);

    const fila = await store.getById("w1");
    expect(fila?.audioUrl).toBe("https://cdn.test/nuevo.mp3");
  });

  it("no escribe nada cuando la lista de palabras viene vacía", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([]);

    expect(await store.count()).toBe(0);
  });

  it("inserta varias palabras en una sola sentencia", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa"),
      word("w2", "Perro"),
      word("w3", "Zapote"),
    ]);

    expect(await store.count()).toBe(3);
    expect((await store.listAZ()).map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("no persiste la columna status: una palabra DRAFT queda visible", async () => {
    // FALLO DE PRODUCCIÓN (src/db/sqlite-store.ts:193-201) — ver informe bug #1.
    // El `INSERT ... ON CONFLICT` no incluye la columna `status` en la lista
    // de columnas ni en el `DO UPDATE SET`, así que el valor nunca llega a la
    // base. Como las consultas filtran por `(status IS NULL OR status !=
    // 'DRAFT')`, un NULL cuenta como visible: una palabra DRAFT que el
    // servidor mande se mostraría en el diccionario del usuario.
    // El backend sí envía `status` (`/api/sync` → `status: w.status`), así que
    // el contrato existe pero el store lo descarta.
    // Marcado con `it.fails`: cuando se corrija `sqlite-store.ts`, este test
    // pasará a fallar y avisará de que hay que quitar el marcador.
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Borrador", { status: "DRAFT" })]);

    const fila = await h.db.getFirstAsync<{ status: string | null }>(
      "SELECT status FROM words WHERE id = 'w1'"
    );
    expect(fila?.status).toBe("DRAFT");
  });
});

describe("SQLiteWordStore.removeWords", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("borra las palabras indicadas por id", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Casa"), word("w2", "Perro")]);
    await store.removeWords(["w1"]);

    expect(await store.count()).toBe(1);
    expect(await store.getById("w1")).toBeNull();
  });

  it("no borra nada cuando la lista de ids viene vacía", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Casa")]);
    await store.removeWords([]);

    expect(await store.count()).toBe(1);
  });
});

describe("SQLiteWordStore.search", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("devuelve vacío para una consulta de menos de dos caracteres", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Casa")]);

    expect(await store.search("c")).toEqual([]);
  });

  it("encuentra palabras ignorando tildes y mayúsculas", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Águila")]);

    expect((await store.search("aguila")).map((w) => w.id)).toEqual(["w1"]);
  });

  it("ordena por rango: la coincidencia exacta va primero", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Pájaro"),
      word("w2", "Pájaro casero"),
      word("w3", "Capa"),
    ]);

    expect((await store.search("pajaro")).map((w) => w.id)).toEqual([
      "w1",
      "w2",
    ]);
  });

  it("excluye las palabras con status DRAFT", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    // Inserción directa para aislar el filtro de la query (el `upsertWords`
    // de producción no escribe `status`: ver bug #1).
    await h.db.runAsync(
      `INSERT INTO words (id, spanish, nasaYuwe, status, updatedAt, spanish_norm, nasaYuwe_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["w1", "Casa", "Kasa", "DRAFT", "2026-01-01", "casa", "kasa"]
    );

    expect((await store.search("casa")).map((w) => w.id)).toEqual([]);
  });

  it("respeta el límite de resultados", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa"),
      word("w2", "Casita"),
      word("w3", "Casona"),
    ]);

    expect((await store.search("cas", 2)).length).toBe(2);
  });
});

describe("SQLiteWordStore.listAZ", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("lista todas las palabras ordenadas alfabéticamente", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Zapote"),
      word("w2", "Casa"),
      word("w3", "Perro"),
    ]);

    expect((await store.listAZ()).map((w) => w.spanish)).toEqual([
      "Casa",
      "Perro",
      "Zapote",
    ]);
  });

  it("filtra por categoría cuando se pasa una", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { category: "casa" }),
      word("w2", "Perro", { category: "animal" }),
    ]);

    expect((await store.listAZ("animal")).map((w) => w.id)).toEqual(["w2"]);
  });

  it("aplica offset y limit sobre el resultado", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "A"),
      word("w2", "B"),
      word("w3", "C"),
      word("w4", "D"),
    ]);

    expect((await store.listAZ(null, 2, 1)).map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("ordena las palabras con el criterio de español, no con el binario de SQLite", async () => {
    // FALLO DE PRODUCCIÓN (src/db/sqlite-store.ts:232 y :237) — ver informe bug #3.
    // `ORDER BY spanish` usa la collation BINARY de SQLite: los caracteres
    // acentuados (á, é, ñ) se comparan por su byte UTF-8 y quedan AL FINAL,
    // después de la Z. La web ordena con `localeCompare(spanish, "es")`
    // (`src/app/api/dictionary/search/route.ts:116`) y `MemoryWordStore` con
    // `localeCompare(a, b, "es")` (`src/db/memory-store.ts:55`): las tres
    // implementaciones deberían coincidir.
    // Impacto en la app: la pantalla "Índice Alfabético" (`src/app/explorar.tsx`)
    // agrupa por `letterOf()`, que SÍ ignora las tildes → la letra "A" de
    // "Águila" queda en un grupo tardío, desordenada respecto de la web.
    // Marcado con `it.fails`: cuando se corrija `sqlite-store.ts`, este test
    // pasará a fallar y avisará de que hay que quitar el marcador.
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Águila"),
      word("w2", "Casa"),
      word("w3", "Zapote"),
    ]);

    expect((await store.listAZ()).map((w) => w.spanish)).toEqual([
      "Águila",
      "Casa",
      "Zapote",
    ]);
  });

  it("excluye las palabras con status DRAFT", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await h.db.runAsync(
      `INSERT INTO words (id, spanish, nasaYuwe, status, updatedAt, spanish_norm, nasaYuwe_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["w1", "Borrador", "Bor", "DRAFT", "2026-01-01", "borrador", "bor"]
    );

    expect(await store.listAZ()).toEqual([]);
  });
});

describe("SQLiteWordStore.listCategories", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("devuelve las categorías distintas y ordenadas", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { category: "casa" }),
      word("w2", "Casita", { category: "casa" }),
      word("w3", "Perro", { category: "animal" }),
    ]);

    expect(await store.listCategories()).toEqual(["animal", "casa"]);
  });

  it("omite las palabras sin categoría", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Sin categoría", { category: null })]);

    expect(await store.listCategories()).toEqual([]);
  });
});

describe("SQLiteWordStore.getById, count y countWordsWithAudio", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("getById devuelve null cuando la palabra no existe", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    expect(await store.getById("no-existe")).toBeNull();
  });

  it("count cuenta todas las palabras almacenadas", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([word("w1", "Casa"), word("w2", "Perro")]);

    expect(await store.count()).toBe(2);
  });

  it("countWordsWithAudio cuenta solo las palabras con audio no vacío", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/a.mp3" }),
      word("w2", "Perro", { audioUrl: "" }),
      word("w3", "Zapote"),
    ]);

    expect(await store.countWordsWithAudio()).toBe(1);
  });
});

describe("SQLiteWordStore.listWithAudio y listRandom", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("listWithAudio devuelve solo las palabras con audio", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/a.mp3" }),
      word("w2", "Perro", { audioUrl: "" }),
      word("w3", "Zapote", { audioUrl: "https://cdn.test/c.mp3" }),
    ]);

    expect((await store.listWithAudio()).map((w) => w.id)).toEqual(["w1", "w3"]);
  });

  it("listWithAudio aplica el límite indicado", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertWords([
      word("w1", "Casa", { audioUrl: "https://cdn.test/a.mp3" }),
      word("w2", "Perro", { audioUrl: "https://cdn.test/b.mp3" }),
    ]);

    expect((await store.listWithAudio(1)).length).toBe(1);
  });

  it("listRandom extrae del diccionario completo, no solo del tramo alfabético", async () => {
    // El pool de los juegos de escucha: antes leía `listAZ(null, 50, 0)` y
    // siempre devolvía las mismas 50 primeras. Con 60 palabras, la muestra
    // debe traer las 60 (el diccionario entero) y en un orden que NO es el
    // alfabético: si fuera un recorte de `listAZ`, el orden coincidiría.
    const { handle: h, store } = await openStore();
    handle = h;

    const palabras = Array.from({ length: 60 }, (_, i) =>
      word(`w${String(i).padStart(2, "0")}`, `Palabra ${String(i).padStart(2, "0")}`)
    );
    await store.upsertWords(palabras);

    const muestra = await store.listRandom(60);

    expect(muestra).toHaveLength(60);
    expect(new Set(muestra.map((w) => w.id)).size).toBe(60);
    // El orden aleatorio difiere del alfabético de `listAZ` (probabilidad de
    // coincidencia: 1/60!, prácticamente imposible).
    const alfabetico = (await store.listAZ(null, 60)).map((w) => w.id);
    expect(muestra.map((w) => w.id)).not.toEqual(alfabetico);
  });
});

describe("SQLiteWordStore — KV y lastSync", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("getKV devuelve null para una clave inexistente", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    expect(await store.getKV("inexistente")).toBeNull();
  });

  it("setKV guarda el valor y getKV lo lee", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.setKV("seedPage", "3");

    expect(await store.getKV("seedPage")).toBe("3");
  });

  it("setKV sobrescribe el valor previo de la misma clave", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.setKV("seedPage", "3");
    await store.setKV("seedPage", "7");

    expect(await store.getKV("seedPage")).toBe("7");
  });

  it("getLastSync devuelve null antes de la primera sincronización", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    expect(await store.getLastSync()).toBeNull();
  });

  it("setLastSync guarda la marca de tiempo y getLastSync la devuelve", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.setLastSync("2026-02-03T10:00:00.000Z");

    expect(await store.getLastSync()).toBe("2026-02-03T10:00:00.000Z");
  });

  it("setLastSync no pisa la clave schemaVersion del kv", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.setLastSync("2026-02-03T10:00:00.000Z");

    expect(await store.getKV("schemaVersion")).toBe(SCHEMA_VERSION);
  });
});

describe("SQLiteWordStore — outbox", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("addOutbox encola una entrada con id autoincremental y createdAt", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addOutbox("favorite", "favorite.set", JSON.stringify({ wordId: "w1" }));

    const pendientes = await store.pendingOutbox();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({
      entity: "favorite",
      op: "favorite.set",
      payload: JSON.stringify({ wordId: "w1" }),
      syncedAt: null,
    });
    expect(pendientes[0]?.id).toBeGreaterThan(0);
    expect(pendientes[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pendingOutbox devuelve las entradas en orden FIFO por id", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w3" }));

    const pendientes = await store.pendingOutbox();
    expect(pendientes.map((p) => p.id)).toEqual([...pendientes.map((p) => p.id)].sort((a, b) => a - b));
    expect(pendientes.map((p) => JSON.parse(p.payload).wordId)).toEqual([
      "w1",
      "w2",
      "w3",
    ]);
  });

  it("markOutboxSynced saca la entrada del pendiente y fija syncedAt", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w1" }));
    const pendiente = (await store.pendingOutbox())[0];
    await store.markOutboxSynced(pendiente!.id);

    expect(await store.pendingOutbox()).toEqual([]);
    const fila = await h.db.getFirstAsync<{ syncedAt: string | null }>(
      "SELECT syncedAt FROM outbox WHERE id = ?",
      [pendiente!.id]
    );
    expect(fila?.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("SQLiteWordStore — historial", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("addHistory registra la visita de una palabra", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addHistory("w1", "2026-01-01T00:00:00.000Z");

    expect(await store.listHistory()).toEqual(["w1"]);
  });

  it("listHistory ordena por viewedAt descendente", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addHistory("w1", "2026-01-01T00:00:00.000Z");
    await store.addHistory("w2", "2026-01-03T00:00:00.000Z");
    await store.addHistory("w3", "2026-01-02T00:00:00.000Z");

    expect(await store.listHistory()).toEqual(["w2", "w3", "w1"]);
  });

  it("listHistory aplica el límite indicado", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addHistory("w1", "2026-01-01T00:00:00.000Z");
    await store.addHistory("w2", "2026-01-02T00:00:00.000Z");

    expect(await store.listHistory(1)).toEqual(["w2"]);
  });

  it("addHistory actualiza la fecha si la palabra ya fue vista", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addHistory("w1", "2026-01-01T00:00:00.000Z");
    await store.addHistory("w1", "2026-02-01T00:00:00.000Z");

    expect(await store.listHistory()).toEqual(["w1"]);
  });

  it("clearHistory vacía el historial", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.addHistory("w1", "2026-01-01T00:00:00.000Z");
    await store.clearHistory();

    expect(await store.listHistory()).toEqual([]);
  });
});

describe("SQLiteWordStore — manifiesto de medios", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("upsertManifest guarda la fila y listManifest la devuelve mapeada", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.test/a.mp3",
      sha256: "abc",
      localUri: "file:///doc/audios/abc.mp3",
    });

    expect(await store.listManifest()).toEqual([
      {
        wordId: "w1",
        kind: "audio",
        url: "https://cdn.test/a.mp3",
        sha256: "abc",
        localUri: "file:///doc/audios/abc.mp3",
      },
    ]);
  });

  it("upsertManifest actualiza la fila existente del mismo word_id y kind", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.test/viejo.mp3",
      sha256: null,
      localUri: "file:///doc/viejo.mp3",
    });
    await store.upsertManifest({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.test/nuevo.mp3",
      sha256: "def",
      localUri: "file:///doc/nuevo.mp3",
    });

    const manifiesto = await store.listManifest();
    expect(manifiesto).toHaveLength(1);
    expect(manifiesto[0]?.url).toBe("https://cdn.test/nuevo.mp3");
    expect(manifiesto[0]?.localUri).toBe("file:///doc/nuevo.mp3");
  });

  it("clearManifestStale borra las filas que ya no son vigentes", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.test/a.mp3",
      sha256: null,
      localUri: "file:///doc/a.mp3",
    });
    await store.upsertManifest({
      wordId: "w2",
      kind: "audio",
      url: "https://cdn.test/b.mp3",
      sha256: null,
      localUri: "file:///doc/b.mp3",
    });

    const resultado = await store.clearManifestStale(["w1|audio"], []);

    expect(resultado.removed).toBe(1);
    expect((await store.listManifest()).map((r) => r.wordId)).toEqual(["w1"]);
  });

  it("clearManifestStale conserva las palabras favoritas", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.test/a.mp3",
      sha256: null,
      localUri: "file:///doc/a.mp3",
    });

    const resultado = await store.clearManifestStale([], ["w1"]);

    expect(resultado.removed).toBe(0);
    expect((await store.listManifest()).map((r) => r.wordId)).toEqual(["w1"]);
  });

  it("clearManifestStale conserva los recursos de cursos y lecciones", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "lesson:l1",
      kind: "audio",
      url: "https://cdn.test/l.mp3",
      sha256: null,
      localUri: "file:///doc/l.mp3",
    });
    await store.upsertManifest({
      wordId: "course:c1",
      kind: "illustration",
      url: "https://cdn.test/c.png",
      sha256: null,
      localUri: "file:///doc/c.png",
    });

    const resultado = await store.clearManifestStale([], []);

    expect(resultado.removed).toBe(0);
    expect((await store.listManifest()).length).toBe(2);
  });

  it("clearManifestStale escapa las comillas simples de las claves", async () => {
    // El prune arma el IN por concatenación de strings: una clave con `'` debe
    // escaparse o rompería la sentencia (el stub no lo detectaría).
    const { handle: h, store } = await openStore();
    handle = h;

    await store.upsertManifest({
      wordId: "w'1",
      kind: "audio",
      url: "https://cdn.test/a.mp3",
      sha256: null,
      localUri: "file:///doc/a.mp3",
    });

    const resultado = await store.clearManifestStale(["w'1|audio"], []);

    expect(resultado.removed).toBe(0);
    expect((await store.listManifest()).map((r) => r.wordId)).toEqual(["w'1"]);
  });

  it("upsertManifest viola el CHECK del kind si el medio no es audio ni ilustración", async () => {
    const { handle: h, store } = await openStore();
    handle = h;

    await expect(
      store.upsertManifest({
        wordId: "w1",
        kind: "video" as unknown as "audio",
        url: "https://cdn.test/v.mp4",
        sha256: null,
        localUri: "file:///doc/v.mp4",
      })
    ).rejects.toThrow(/CHECK constraint failed/i);
  });
});

describe("SQLiteWordStore — el schema como contrato", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("declara la columna status en el schema aunque el upsert no la escriba", async () => {
    const { handle: h } = await openStore();
    handle = h;

    const columnas = await h.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(words)"
    );
    expect(columnas.map((c) => c.name)).toContain("status");
  });

  it("el esquema publica la tabla kv con clave primaria", async () => {
    const { handle: h } = await openStore();
    handle = h;

    await expect(
      h.db.runAsync("INSERT INTO kv (key, value) VALUES (?, ?)", ["dup", "1"])
    ).resolves.toBeTruthy();
    await expect(
      h.db.runAsync("INSERT INTO kv (key, value) VALUES (?, ?)", ["dup", "2"])
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("el SCHEMA exportado incluye la tabla media_manifest aditiva de B1", () => {
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS media_manifest");
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS history");
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS outbox");
  });
});
