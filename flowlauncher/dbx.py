# -*- coding: utf-8 -*-
"""Grava tarefas direto no Dropbox (mesmos arquivos que o PraFazer sincroniza). Só stdlib.

Uso único, num terminal:  python dbx.py auth
Guarda a chave do app e o refresh token em config.json (fora do git)."""
import base64
import calendar
import datetime
import hashlib
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "config.json")
PATHS = {"pessoal": "/todo.txt", "trabalho": "/trabalho.txt"}
_tok = {"v": None, "exp": 0}


def load():
    try:
        with open(CFG, encoding="utf-8") as f:
            c = json.load(f)
        return c if c.get("key") and c.get("refresh") else None
    except (OSError, ValueError):
        return None


def _post(url, data, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read(), r.headers


def _token_req(params):
    try:
        _, body, _ = _post("https://api.dropboxapi.com/oauth2/token", urllib.parse.urlencode(params).encode(),
                           {"Content-Type": "application/x-www-form-urlencoded"})
    except urllib.error.HTTPError as e:
        raise RuntimeError("token: " + e.read().decode("utf-8", "replace")[:200])
    return json.loads(body)


def _access(cfg):
    if _tok["v"] and time.time() < _tok["exp"]:
        return _tok["v"]
    j = _token_req({"grant_type": "refresh_token", "refresh_token": cfg["refresh"], "client_id": cfg["key"]})
    _tok["v"], _tok["exp"] = j["access_token"], time.time() + j.get("expires_in", 3600) - 60
    return _tok["v"]


def _arg(d):  # cabeçalho Dropbox-API-Arg: JSON em ASCII
    return json.dumps(d, ensure_ascii=True)


def _download(cfg, path):
    try:
        _, body, h = _post("https://content.dropboxapi.com/2/files/download", b"",
                           {"Authorization": "Bearer " + _access(cfg), "Dropbox-API-Arg": _arg({"path": path})})
    except urllib.error.HTTPError as e:
        if e.code == 409 and b"not_found" in e.read():
            return "", ""
        raise
    return body.decode("utf-8"), json.loads(h.get("dropbox-api-result", "{}")).get("rev", "")


def _upload(cfg, path, text, rev):
    mode = {".tag": "update", "update": rev} if rev else "overwrite"
    _, body, _ = _post("https://content.dropboxapi.com/2/files/upload", text.encode("utf-8"),
                       {"Authorization": "Bearer " + _access(cfg), "Content-Type": "application/octet-stream",
                        "Dropbox-API-Arg": _arg({"path": path, "mode": mode, "mute": True})})
    j = json.loads(body)
    if j.get("path_display", path).lower() != path.lower():
        raise RuntimeError("o Dropbox salvou uma cópia em " + j["path_display"])


def append(ws, line):
    """Acrescenta uma linha ao todo.txt do contexto. Repete se o arquivo mudou no meio."""
    cfg = load()
    if not cfg:
        raise RuntimeError("sem config.json (rode: python dbx.py auth)")
    path = PATHS[ws]
    for _ in range(3):
        text, rev = _download(cfg, path)
        eol = "\r\n" if "\r\n" in text else "\n"
        if text and not text.endswith("\n"):
            text += eol
        try:
            _upload(cfg, path, text + line + eol, rev)
            return
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
    raise RuntimeError("o arquivo mudou várias vezes; tente de novo")


# ---- monta a linha como o PraFazer (addTask + normalizeInput) ----
def _add_period(d, n, u):
    if u == "d":
        return d + datetime.timedelta(days=n)
    if u == "w":
        return d + datetime.timedelta(days=7 * n)
    if u in "my":
        months = d.year * 12 + d.month - 1 + (n if u == "m" else 12 * n)
        y, m = divmod(months, 12)
        return d.replace(year=y, month=m + 1, day=min(d.day, calendar.monthrange(y, m + 1)[1]))
    s, k = (1 if n >= 0 else -1), abs(n)  # dias úteis
    while k:
        d += datetime.timedelta(days=s)
        if d.weekday() < 5:
            k -= 1
    return d


_WD = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
       "seg": 0, "ter": 1, "qua": 2, "qui": 3, "sex": 4, "sab": 5, "sáb": 5, "dom": 6}


def _rel(v, today):
    s = v.lower()
    if s in ("tod", "today", "hoje"):
        return today
    if s in ("tom", "tomorrow", "amanha", "amanhã"):
        return today + datetime.timedelta(days=1)
    m = re.match(r"^([+-]?\d+)([dwmyb])$", s)
    if m:
        return _add_period(today, int(m.group(1)), m.group(2))
    if s in _WD:
        return today + datetime.timedelta(days=((_WD[s] - today.weekday()) % 7) or 7)
    return None


def make_line(text, today=None):
    today = today or datetime.date.today()
    text = text.strip()

    def fix(m):
        r = _rel(m.group(3), today)
        return "%s%s:%s" % (m.group(1), m.group(2), r.isoformat()) if r else m.group(0)
    text = re.sub(r"(^|\s)(due|t):(\S+)", fix, text)
    if re.search(r"(^|\s)time:([01]?\d|2[0-3]):[0-5]\d(\s|$)", text) and not re.search(r"(^|\s)due:\S+", text):
        text += " due:" + today.isoformat()
    pri = ""
    m = re.match(r"^\(([A-Za-z])\)\s+", text)
    if m:
        pri, text = "(%s) " % m.group(1).upper(), text[m.end():]
    if not re.match(r"^\d{4}-\d{2}-\d{2} ", text):
        text = today.isoformat() + " " + text
    return pri + text


# ---- autorização única (PKCE, sem redirect: o Dropbox mostra o código) ----
def auth():
    key = input("App key do Dropbox (a mesma do PraFazer): ").strip()
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    chal = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    print("\nAbra este endereço, autorize e copie o código:\n\nhttps://www.dropbox.com/oauth2/authorize?" + urllib.parse.urlencode({
        "client_id": key, "response_type": "code", "code_challenge": chal,
        "code_challenge_method": "S256", "token_access_type": "offline"}) + "\n")
    code = input("Código: ").strip()
    j = _token_req({"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": key})
    with open(CFG, "w", encoding="utf-8") as f:
        json.dump({"key": key, "refresh": j["refresh_token"]}, f)
    print("Pronto: config.json gravado.")


if __name__ == "__main__":
    if sys.argv[1:] == ["auth"]:
        try:
            auth()
        except Exception as e:
            print("Erro:", e)
        input("Enter para fechar")
    else:
        print(__doc__)
