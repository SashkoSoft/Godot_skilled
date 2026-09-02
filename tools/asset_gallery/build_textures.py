"""Сканирует game/assets/textures/** и пишет манифест для галереи.
Никакой Godot не нужен — это просто список файлов, картинки читает сам браузер.
Запускать вместе с build.sh (тот считает модели, этот — текстуры).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "game", "assets", "textures"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "game", "assets", "textures_data.json"))

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")

def main():
    materials = []
    for name in sorted(os.listdir(ROOT)):
        folder = os.path.join(ROOT, name)
        if not os.path.isdir(folder):
            continue
        files = sorted(f for f in os.listdir(folder) if f.lower().endswith(IMG_EXT))
        if not files:
            continue
        materials.append({"category": name, "files": files})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(materials, f, ensure_ascii=False, indent=2)
    print(f"[textures] {len(materials)} folders -> {OUT}")

if __name__ == "__main__":
    main()
