"""DEPRECATED: usa IDs cmw6dy* que ya no existen. Ver scripts/generate-bundled-media-map.ts."""
import sqlite3, os, shutil

DB = "assets/piiyaak.db"
AUDIO_SRC = "/home/mario/Descargas/audiosnasa"
AUDIO_DEST = "assets/audios"

mapping = {
    "Buk": ["cmw6dy0gx000lckroy1ql94r2"],
    "Kupe": ["cmw6dy0r7003fckroxp3tjnxb"],
    "Les": ["cmw6dy0sy003wckro9mltsvv3"],
    "Nxusxa": ["cmw6dy0xk0053ckroxjdyhv4t", "cmw6dy0xn0054ckropcaklc5f"],
    "Peennxi": ["cmw6dy0yt005hckrogux5blgx"],
    "Pukat": ["cmw6dy10f005xckrol2fz01du"],
    "Taul": ["cmw6dy1490071ckrofza36a8c"],
    "Tupa": ["cmw6dy15t007hckroxprab2l1"],
    "Uh": ["cmw6dy1830084ckroi5qpkkrl"],
    "Vxlxilx": ["cmw6dy1a3008qckrosg2g8y7l", "cmw6dy1a6008rckrouvdvgsun"],
    "Zik": ["cmw6dy1d6009nckros4yf8ynq"],
}

os.makedirs(AUDIO_DEST, exist_ok=True)
for name in mapping:
    src = os.path.join(AUDIO_SRC, name + ".mp3")
    dst = os.path.join(AUDIO_DEST, name + ".mp3")
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print("Copiado: " + name + ".mp3 -> " + dst)
    else:
        print("FALTA: " + src)

conn = sqlite3.connect(DB)
updated = 0
for name, ids in mapping.items():
    audio_url = "audios/" + name + ".mp3"
    for wid in ids:
        conn.execute("UPDATE words SET audioUrl = ? WHERE id = ?", (audio_url, wid))
        updated += 1
conn.commit()

count = conn.execute("SELECT COUNT(*) FROM words WHERE audioUrl IS NOT NULL AND audioUrl != ''").fetchone()[0]
print("")
print("Words updated: " + str(updated))
print("Words with audioUrl: " + str(count))
print("")
print("Matched words:")
for name, ids in mapping.items():
    for wid in ids:
        row = conn.execute("SELECT spanish, nasaYuwe FROM words WHERE id = ?", (wid,)).fetchone()
        print("  " + name + ".mp3 -> " + row[0] + " (" + row[1] + ")")
conn.close()
