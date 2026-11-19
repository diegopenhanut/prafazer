# -*- coding: utf-8 -*-
"""Plugin do Flow Launcher para o topydo (executado no WSL). Só usa a stdlib."""
import json
import os
import subprocess
import sys
from urllib.parse import quote

TOPYDO = r"C:\Users\diego\AppData\Local\Python\pythoncore-3.15-64\Scripts\topydo.exe"
# o arquivo de tarefas vem de C:\Users\diego\.config\topydo\config
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW

# prafazer (PWA): 'td addp ...' = Pessoal, 'td addw ...' = Trabalho
PWA_URL = "https://diegopenhanut.github.io/prafazer/"
PWA_CTX = {"addp": ("pessoal", "Pessoal"), "addw": ("trabalho", "Trabalho")}


def topydo(*args):
    """Roda o topydo nativo do Windows (lista de argumentos, sem shell)."""
    cmd = [TOPYDO] + list(args)
    p = subprocess.run(cmd, capture_output=True, creationflags=NO_WINDOW)
    return p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace"), p.returncode


def tasks():
    out, _, _ = topydo("ls", "-x", "-f", "json")
    try:
        return json.loads(out)
    except ValueError:
        return []


def result(title, sub="", action=None, ctx=None, score=0):
    r = {"Title": title, "SubTitle": sub, "IcoPath": "icon.png", "Score": score}
    if action:
        r["JsonRPCAction"] = {"method": action[0], "parameters": list(action[1:])}
    if ctx is not None:
        r["ContextData"] = ctx
    return r


def sort_key(t):
    return (t["priority"] or "~", t["id"])


def query(text):
    text = text.strip()
    low = text.lower()
    if low == "cols":
        return [result("Abrir interface de colunas", "topydo columns", ("open_cols",))]
    kw = low.split(" ", 1)[0]
    if kw in PWA_CTX:
        ws, nome = PWA_CTX[kw]
        body = text[len(kw):].strip()
        if not body:
            return [result("Abrir nova tarefa no prafazer (%s)" % nome, "Digite o texto depois de 'td %s' para adicionar direto" % kw, ("pwa", ws, ""))]
        return [result("prafazer %s: %s" % (nome, body), "Abre o app no navegador e adiciona a tarefa", ("pwa", ws, body))]
    if low.startswith("add ") or low == "add":
        body = text[3:].strip()
        if not body:
            return [result("Adicionar tarefa", "Digite o texto da tarefa depois de 'td add'")]
        return [result("Adicionar: " + body, "topydo add", ("add_task", body))]

    items = tasks()
    words = low.split()
    out = []
    for t in sorted(items, key=sort_key):
        hay = t["source"].lower()
        if all(w in hay for w in words):
            pri = "(%s) " % t["priority"] if t["priority"] else ""
            projs = " ".join("+" + p for p in t["projects"])
            due = next((v for k, v in t["tags"] if k == "due"), "")
            sub = "  ".join(x for x in [projs, ("due:" + due) if due else "", "Enter = concluir"] if x)
            out.append(result(pri + t["text"], sub, ("do_task", t["id"]), ctx=t["id"]))
    if not out:
        out.append(result("Nenhuma tarefa encontrada", "Use 'td add <texto>' para criar"))
    return out


def context_menu(task_id):
    i = task_id
    return [
        result("Concluir", "do", ("do_task", i)),
        result("Apagar", "del", ("del_task", i)),
        result("Prioridade A", "pri A", ("run", "pri", str(i), "A")),
        result("Prioridade B", "pri B", ("run", "pri", str(i), "B")),
        result("Remover prioridade", "depri", ("run", "depri", str(i))),
        result("Adiar 1 dia", "postpone 1d", ("run", "postpone", str(i), "1d")),
    ]


def run(*args):
    topydo(*args)


def do_task(i):
    run("do", "-f", str(i))


def del_task(i):
    run("del", "-f", str(i))


def add_task(text):
    run("add", text)


def pwa(ws, body):
    url = PWA_URL + "?ws=" + ws + ("&add=" + quote(body, safe="") if body else "&quick=1")
    os.startfile(url)


def open_cols():
    subprocess.Popen(
        ["wt.exe", "--maximized", "--focus", "-p", "topydo"],
        creationflags=NO_WINDOW,
    )


METHODS = {
    "query": query, "context_menu": context_menu, "run": run,
    "do_task": do_task, "del_task": del_task, "add_task": add_task, "open_cols": open_cols, "pwa": pwa,
}

if __name__ == "__main__":
    req = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {"method": "query", "parameters": [""]}
    if isinstance(req, str):  # alguns lançadores entregam o JSON duplamente codificado
        req = json.loads(req)
    res = METHODS[req["method"]](*req.get("parameters", []))
    if isinstance(res, list):
        sys.stdout.write(json.dumps({"result": res}, ensure_ascii=False))
