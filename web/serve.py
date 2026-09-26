#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный статический сервер для веб-версии.

Отдаёт КОРЕНЬ репозитория, а не папку `web/`: страница лежит в `/web/`, а
модели и текстуры — в `/game/assets/`, и копировать 41 модель и 161 текстуру
во вторую папку значило бы завести второй источник правды ровно того сорта,
на котором проект уже один раз сломался.

    python web/serve.py            # http://127.0.0.1:8080/web/
    python web/serve.py 9000       # другой порт
    python web/serve.py --lan      # видно из сети (телефон по Wi-Fi/Tailscale)

--lan открывает весь репозиторий на чтение каждому в той же сети — дома это
нормально, в чужом Wi-Fi не включать.

Кэш выключен: правка шейдера должна быть видна по F5, а не после чистки кэша.
"""

import functools
import http.server
import pathlib
import socketserver
import sys
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parents[1]
LAN = "--lan" in sys.argv
_args = [a for a in sys.argv[1:] if a != "--lan"]
PORT = int(_args[0]) if _args else 8080


def lan_addresses() -> list:
    """IPv4 этой машины, кроме петли — по ним заходят с телефона."""
    import socket
    out = []
    for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        ip = info[4][0]
        if not ip.startswith(("127.", "169.254.")) and ip not in out:
            out.append(ip)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    # `.glsl` в стандартной таблице нет, а без явного типа Chrome ругается.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".glsl": "text/plain; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else ""
        if str(code).startswith(("4", "5")):
            sys.stderr.write("  %s %s\n" % (code, args[0]))


def main() -> int:
    handler = functools.partial(Handler, directory=str(ROOT))
    # ThreadingTCPServer, а не TCPServer: одна сцена тянет десятки файлов
    # параллельно (модели и по три текстуры на каждую), и однопоточный сервер
    # часть соединений просто отбивает. Симптом обманчивый — каждый раз
    # падают РАЗНЫЕ файлы, и это выглядит как битые ассеты, а не как сервер.
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0" if LAN else "127.0.0.1", PORT), handler) as srv:
        url = "http://127.0.0.1:%d/web/" % PORT
        print("корень:  %s" % ROOT)
        print("страница: %s" % url)
        if LAN:
            for ip in lan_addresses():
                print("из сети:  http://%s:%d/web/" % (ip, PORT))
        print("Ctrl+C — остановить")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nостановлен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
