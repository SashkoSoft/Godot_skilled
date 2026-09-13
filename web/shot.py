#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Скриншот-харнесс для веб-версии: кадр в PNG без участия человека.

То же правило, что было в Godot: не просить пользователя смотреть то, что
можно посмотреть самому. Поднимает статический сервер, запускает Chrome в
headless и снимает кадр; консоль браузера пишется рядом в .log, поэтому
ошибка компиляции шейдера видна в тексте, а не только чёрным экраном.

    python web/shot.py                       # общий ракурс
    python web/shot.py --view 2 --out C:/tmp/eye.png
    python web/shot.py --size 1600x900 --wait 9

Ракурсы — те же клавиши 1..4, что на странице: общий, с глаз, бордюр, сверху.
WebGL в headless идёт через программный ANGLE, поэтому кадр честный по
содержанию, но не по скорости: производительность так мерить нельзя.
"""

import argparse
import http.server
import functools
import os
import pathlib
import socketserver
import subprocess
import sys
import tempfile
import threading

ROOT = pathlib.Path(__file__).resolve().parents[1]

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome() -> str:
    for p in CHROME_CANDIDATES:
        if pathlib.Path(p).exists():
            return p
    raise SystemExit("Chrome не найден — правь CHROME_CANDIDATES в web/shot.py")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".glsl": "text/plain; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".glb": "model/gltf-binary",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def serve(port: int) -> socketserver.TCPServer:
    handler = functools.partial(Handler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--view", default="1", choices=["1", "2", "3", "4"],
                    help="ракурс: 1 общий, 2 с глаз, 3 бордюр, 4 сверху")
    ap.add_argument("--out", default=None, help="куда положить PNG")
    ap.add_argument("--size", default="1600x900")
    ap.add_argument("--wait", type=float, default=8.0,
                    help="сколько виртуальных секунд дать странице")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--debug", default="0", choices=["0", "1", "2"],
                    help="0 покрытие, 1 нормаль цветом, 2 поле высот")
    ap.add_argument("--no-bump", action="store_true")
    args = ap.parse_args()

    w, h = (int(x) for x in args.size.lower().split("x"))
    out = pathlib.Path(args.out) if args.out else ROOT / "web" / "shot.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    log = out.with_suffix(".log")

    # Страница читает начальное состояние из хеша — так харнесс не зависит от
    # эмуляции нажатий клавиш, которой в headless просто нет.
    frag = "#view=%s&debug=%s%s" % (args.view, args.debug,
                                    "&bump=0" if args.no_bump else "")
    url = "http://127.0.0.1:%d/web/%s" % (args.port, frag)

    srv = serve(args.port)
    profile = tempfile.mkdtemp(prefix="webshot-")
    cmd = [
        find_chrome(),
        "--headless=new",
        "--screenshot=" + str(out),
        "--window-size=%d,%d" % (w, h),
        "--virtual-time-budget=%d" % int(args.wait * 1000),
        "--hide-scrollbars",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-sandbox",
        # Программный WebGL: без него headless отдаёт чёрный кадр.
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--enable-logging=stderr",
        "--v=0",
        url,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           timeout=args.wait + 90)
    finally:
        srv.shutdown()

    # Оставляем только строки страницы: остальное — шум запуска Chrome.
    keep = [ln for ln in (r.stderr or "").splitlines()
            if "CONSOLE" in ln or "улица" in ln or "ERROR:" in ln.upper()]
    log.write_text("\n".join(keep), encoding="utf-8")

    if not out.exists():
        print("кадр НЕ снят; лог: %s" % log)
        print("\n".join(keep[-25:]))
        return 1
    print("кадр:  %s  (%d КБ)" % (out, out.stat().st_size // 1024))
    print("лог:   %s" % log)
    for ln in keep[-12:]:
        print("  " + ln.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
