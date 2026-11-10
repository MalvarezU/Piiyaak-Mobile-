"""DEPRECATED: usa IDs cmw6dy* que ya no existen. Ver scripts/generate-bundled-media-map.ts."""
#!/usr/bin/env python3
"""Genera assets/piiyaak.db pre-poblada desde /api/sync/seed.

Uso:
  API_BASE_URL=https://... ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 scripts/export-db.py

Requiere Python 3.8+ (sqlite3 y urllib en stdlib).
"""
import json
import os
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request

API_BASE = os.environ.get("API_BASE_URL", "https://diccionario-nasa-liart.vercel.app").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "piiyaak.db")

SCHEMA = """
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
"""


def normalize(text):
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode("ascii").lower().strip()


# Desactiva el seguimiento automático de redirecciones: el callback de
# NextAuth responde 302 con Set-Cookie y debemos capturar esa cookie
# (urllib por defecto sigue la redirección y pierde el Set-Cookie).
import http.client as _http_client


def http(method, path, data=None, cookie=None):
    # http.client en lugar de urllib: urllib seguía redirecciones y perdía
    # el Set-Cookie del 302 de NextAuth (CA-22). http.client no sigue
    # redirecciones por defecto, así que el 302 se captura completo.
    parsed = urllib.parse.urlparse(API_BASE)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    headers = {}
    body = None
    if data is not None:
        if isinstance(data, dict):
            body = urllib.parse.urlencode(data)
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = data
    if cookie:
        headers["Cookie"] = cookie
    body_bytes = body.encode() if isinstance(body, str) else body
    if body_bytes is not None:
        headers["Content-Length"] = str(len(body_bytes))
    conn = (
        _http_client.HTTPSConnection(host, port)
        if parsed.scheme == "https"
        else _http_client.HTTPConnection(host, port)
    )
    try:
        conn.request(method, path, body=body_bytes, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, resp.getheaders(), raw
    finally:
        conn.close()


def login():
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        print("ADMIN_EMAIL/ADMIN_PASSWORD no definidos; intentando seed sin auth (puede fallar).")
        return None
    status, headers, body = http("GET", "/api/auth/csrf")
    csrf = json.loads(body).get("csrfToken")
    if not csrf:
        print("No se obtuvo csrfToken", file=sys.stderr)
        sys.exit(1)
    # Capturar las cookies del GET (csrf-token, callback-url) para enviarlas
    # en el POST: NextAuth valida el csrf contra la cookie.
    csrf_cookies = []
    for name, value in headers:
        if name.lower() == "set-cookie":
            csrf_cookies.append(value.strip().split(";")[0])
    cookie = "; ".join(csrf_cookies) if csrf_cookies else None
    status, headers, body = http(
        "POST",
        "/api/auth/callback/credentials",
        {"csrfToken": csrf, "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        cookie=cookie,
    )
    # capture session cookie
    cookie = None
    for name, value in headers:
        if name.lower() == "set-cookie":
            v = value.strip()
            if v.startswith("next-auth.session-token=") or v.startswith("__Secure-next-auth.session-token="):
                cookie = v.split(";")[0]
                break
    if not cookie:
        print("Login falló: sin cookie de sesión", file=sys.stderr)
        sys.exit(1)
    print("Login OK")
    return cookie


def fetch_seed(cookie):
    words = []
    server_time = None
    content_version = None
    # Versión de contenido del bundle (B1): gate por igualdad exacta.
    # Endpoint público; el cookie se envía igual por si el backend lo exige.
    try:
        status, _headers, body = http("GET", "/api/sync/version", cookie=cookie)
        if status == 200:
            data = json.loads(body)
            if isinstance(data.get("contentVersion"), str) and data["contentVersion"]:
                content_version = data["contentVersion"]
                print(f"  contentVersion remota: {content_version}")
            else:
                print("  /api/sync/version sin contentVersion; el bundle quedará sin gate inicial.")
        else:
            print(f"  /api/sync/version -> {status}; el bundle quedará sin gate inicial.")
    except Exception as e:
        print(f"  no se pudo leer /api/sync/version ({e}); el bundle quedará sin gate inicial.")
    page = 1
    total_pages = 1
    while page <= total_pages:
        status, headers, body = http("GET", f"/api/sync/seed?page={page}&pageSize=500", cookie=cookie)
        if status != 200:
            print(f"seed page {page} -> {status}: {body[:200]}", file=sys.stderr)
            sys.exit(1)
        data = json.loads(body)
        words.extend(data.get("words", []))
        total_pages = data.get("totalPages", 1)
        server_time = data.get("serverTime")
        print(f"  página {page}/{total_pages}: +{len(data.get('words', []))} (total {len(words)})")
        page += 1
    return words, server_time, content_version


def main():
    cookie = login()
    print("Descargando seed...")
    words, server_time, content_version = fetch_seed(cookie)
    print(f"Total palabras: {len(words)}")

    out = os.path.abspath(OUT_PATH)
    if os.path.exists(out):
        os.remove(out)
    conn = sqlite3.connect(out)
    conn.executescript(SCHEMA)
    conn.commit()

    for w in words:
        conn.execute(
            """INSERT INTO words (id, spanish, nasaYuwe, pronunciation, audioUrl, illustrationUrl,
               culturalContext, category, examples, status, updatedAt, spanish_norm, nasaYuwe_norm)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                w["id"],
                w["spanish"],
                w["nasaYuwe"],
                w.get("pronunciation"),
                w.get("audioUrl"),
                w.get("illustrationUrl"),
                w.get("culturalContext"),
                w.get("category"),
                w.get("examples"),
                w.get("status"),
                w["updatedAt"],
                normalize(w["spanish"]),
                normalize(w["nasaYuwe"]),
            ),
        )
    if server_time:
        # Claves unificadas con prefijo (B1/R3): el gate las lee con prefijo.
        conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", ("piiyaak:lastSync", server_time))
        if content_version:
            conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", ("piiyaak:contentVersion", content_version))
        else:
            print("ADVERTENCIA: bundle sin piiyaak:contentVersion; la app hará una sync completa inicial.")
        conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", ("schemaVersion", "4"))
    conn.commit()
    conn.close()
    print(f"Escrito: {out} ({len(words)} palabras)")


if __name__ == "__main__":
    main()
