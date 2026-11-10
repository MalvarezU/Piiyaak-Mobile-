"""DEPRECATED: usa IDs cmw6dy* que ya no existen. Ver scripts/generate-bundled-media-map.ts."""
import sqlite3, os, shutil

DB = "assets/piiyaak.db"
ILL_SRC = "/home/mario/Descargas/drive-download-20261021T151037Z-1-001"
ILL_DEST = "assets/illustrations"

# Mapping: file name -> list of word IDs in the DB
mapping = {
    "TUPA.png": ["cmw6dy15t007hckroxprab2l1"],   # Araña (Tupa)
    "TXITE.png": ["cmw6dy175007uckroq5y1nsvd"],   # Flor (Txite)
    "YAT.png": ["cmw6dy1bv0099ckrot1ow9upo"],     # Casa (Yat)
    "A TE.png": ["cmw6dy0g4000dckrof1d9p730"],    # Limpio (Ate)
}

os.makedirs(ILL_DEST, exist_ok=True)
for fname, ids in mapping.items():
    src = os.path.join(ILL_SRC, fname)
    # Normalize filename for destination (no spaces)
    safe_name = fname.replace(" ", "_")
    dst = os.path.join(ILL_DEST, safe_name)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print("Copiado: " + fname + " -> " + dst)
    else:
        print("FALTA: " + src)

conn = sqlite3.connect(DB)
updated = 0
for fname, ids in mapping.items():
    safe_name = fname.replace(" ", "_")
    ill_url = "illustrations/" + safe_name
    for wid in ids:
        conn.execute("UPDATE words SET illustrationUrl = ? WHERE id = ?", (ill_url, wid))
        updated += 1
conn.commit()

count = conn.execute("SELECT COUNT(*) FROM words WHERE illustrationUrl IS NOT NULL AND illustrationUrl != ''").fetchone()[0]
print("")
print("Words updated: " + str(updated))
print("Words with illustrationUrl: " + str(count))
print("")
for fname, ids in mapping.items():
    for wid in ids:
        row = conn.execute("SELECT spanish, nasaYuwe FROM words WHERE id = ?", (wid,)).fetchone()
        print("  " + fname + " -> " + row[0] + " (" + row[1] + ")")
conn.close()
