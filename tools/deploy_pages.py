"""Выкладка веба на GitHub Pages (ветка gh-pages, рабочая копия рядом с репозиторием).

Что выкладывать из game/ — не списком, а замером: поднимается сервер, который
записывает каждый отданный файл, в Chrome (реальное время, видеокарта) открываются
страницы, и на сайт уходят ровно запрошенные файлы. Два прохода по ступеням
текстур (#tex=1024 — компьютер, #tex=512 — телефон), со всеми слоями.
web/ — целиком (без снимков харнесса). Корень ветки (галерея, assets/) не трогается.

    python tools/deploy_pages.py            # собрать и показать разницу
    python tools/deploy_pages.py --push     # и закоммитить, и выложить
"""
import argparse, functools, http.server, os, pathlib, shutil, socketserver, subprocess, sys, tempfile, threading, time, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))
import shot   # noqa: E402  (find_chrome, Handler)
import os

def _tmpprof():
    # профиль Chrome — временный и удаляется при выходе (раньше копились в %TEMP%: 51 ГБ)
    import tempfile, atexit, shutil, time
    d = tempfile.mkdtemp(prefix="chrome_prof_")
    def _rm():
        for _ in range(10):
            shutil.rmtree(d, ignore_errors=True)
            if not os.path.exists(d): return
            time.sleep(0.5)
    atexit.register(_rm)
    return d


WT = pathlib.Path(os.environ.get("PAGES_WT", r"C:\Users\Papa\Documents\gh-pages-worktree"))
GIT = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe")
PAGES = [
	"web/",
	"web/#level=district&trees=on&houses=on&tex=1024",
	"web/#level=district&trees=on&houses=on&tex=512",
	"web/rooms.html#tex=1024",
	"web/rooms.html#tex=512",
]
SKIP_WEB = {"shot.png", "shot.log"}

served = set()


class Rec(shot.Handler):
	def do_GET(self):
		p = urllib.parse.unquote(self.path.split("?")[0].split("#")[0]).lstrip("/")
		f = ROOT / p
		if f.is_file():
			served.add(f.relative_to(ROOT).as_posix())
		return super().do_GET()

	def log_message(self, *a):
		pass


def collect(wait):
	socketserver.ThreadingTCPServer.allow_reuse_address = True
	srv = socketserver.ThreadingTCPServer(("127.0.0.1", 8160), functools.partial(Rec, directory=str(ROOT)))
	threading.Thread(target=srv.serve_forever, daemon=True).start()
	for page in PAGES:
		before = len(served)
		cmd = [shot.find_chrome(), "--headless=new", "--window-size=1600,900", "--user-data-dir=" + _tmpprof(),
			"--no-first-run", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "http://127.0.0.1:8160/" + page]
		p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
		time.sleep(wait)
		p.kill()
		print(f"  {page}: +{len(served) - before} файлов")
	srv.shutdown()


def size(files, base):
	return sum((base / f).stat().st_size for f in files if (base / f).is_file())


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--wait", type=int, default=75, help="секунд на страницу (фоновые ступени LOD и текстур)")
	ap.add_argument("--push", action="store_true")
	a = ap.parse_args()
	print("замер: какие файлы грузит веб")
	collect(a.wait)
	game = sorted(f for f in served if f.startswith("game/"))
	web = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "web").rglob("*")
		if p.is_file() and p.name not in SKIP_WEB and "__pycache__" not in p.parts)
	want = set(game) | set(web)
	# в рабочей копии: game/ и web/ — ровно want; остальное (галерея) не трогаем
	old = {p.relative_to(WT).as_posix() for d in ("game", "web") if (WT / d).exists() for p in (WT / d).rglob("*") if p.is_file()}
	gone = sorted(old - want)
	for f in gone:
		(WT / f).unlink()
	changed = 0
	for f in sorted(want):
		s, d = ROOT / f, WT / f
		if d.exists() and d.stat().st_size == s.stat().st_size and d.stat().st_mtime >= s.stat().st_mtime:
			continue
		d.parent.mkdir(parents=True, exist_ok=True)
		shutil.copy2(s, d); changed += 1
	for d in sorted((WT / "game").rglob("*"), reverse=True):   # пустые папки
		if d.is_dir() and not any(d.iterdir()):
			d.rmdir()
	total = sum(p.stat().st_size for p in WT.rglob("*") if p.is_file() and ".git" not in p.parts)
	print(f"game/: {len(game)} файлов, {size(game, ROOT) / 2**20:.0f} МБ · web/: {len(web)} файлов · "
		f"удалено {len(gone)}, обновлено {changed} · сайт целиком {total / 2**20:.0f} МБ")
	if a.push:
		run = lambda *c: subprocess.run([GIT, *c], cwd=WT, check=True)
		run("add", "-A")
		if subprocess.run([GIT, "diff", "--cached", "--quiet"], cwd=WT).returncode:
			run("commit", "-q", "-m", "веб: выкладка по замеру запрошенных файлов")
			run("push", "-q", "origin", "HEAD:gh-pages")
			print("выложено")
		else:
			print("изменений нет")


if __name__ == "__main__":
	main()
