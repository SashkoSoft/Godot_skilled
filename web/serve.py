#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный статический сервер для веб-версии.

Отдаёт КОРЕНЬ репозитория, а не папку `web/`: страница лежит в `/web/`, а
модели и текстуры — в `/game/assets/`, и копировать 41 модель и 161 текстуру
во вторую папку значило бы завести второй источник правды ровно того сорта,
на котором проект уже один раз сломался.

    python web/serve.py            # http://127.0.0.1:8080/web/
    python web/serve.py 9000       # другой порт

Кэш выключен: правка шейдера должна быть видна по F5, а не после чистки кэша.
"""

import functools
import http.server
import pathlib
import socketserver
import sys
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parents[1]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


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
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler) as srv:
        url = "http://127.0.0.1:%d/web/" % PORT
        print("корень:  %s" % ROOT)
        print("страница: %s" % url)
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
