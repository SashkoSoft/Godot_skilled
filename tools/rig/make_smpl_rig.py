#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Пересобирает эталонный риг `pipeline/reference/rig/smpl_rig.glb`.

Зачем это отдельный инструмент, а не правка файла руками: риг — производные
данные. Поза покоя берётся из самой модели SMPL, а не конструируется на глаз,
потому что повороты, которые отдаёт GVHMR, заданы ОТНОСИТЕЛЬНО шаблона
SMPL. Если поза покоя другая, каждая анимация ляжет со сдвигом, и заметить
это можно будет только по «плывущим» рукам.

Что было не так с прежним файлом: в нём лежал не шаблон, а **кадр мокапа** —
повороты запечены в каждую кость. Замер симметрии: ошибка зеркала по стопе
151.7 мм, по колену 124.8, щиколотки на разной высоте (0.061 против 0.135),
линия плеч наклонена на 6.1°. Любой персонаж, собранный на таком риге,
наследовал шагающую асимметричную привязку.

Суставы шаблона считаются как `J = J_regressor @ v_template` — тот же
расчёт, что делает сама модель при нулевых позе и форме.

    python tools/rig/make_smpl_rig.py
    python tools/rig/make_smpl_rig.py --smpl <путь к SMPL_NEUTRAL.pkl>

Модель в репозиторий не кладётся: 37 МБ и своя лицензия. Она уже есть на
машине в развёрнутом GVHMR.
"""

import argparse
import json
import math
import pathlib
import pickle
import struct
import sys
import types

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "pipeline" / "reference" / "rig" / "smpl_rig.glb"
SMPL_DEFAULT = pathlib.Path(
    r"C:\Users\Papa\Documents\AImocap\GVHMR\inputs\checkpoints"
    r"\body_models\smpl\SMPL_NEUTRAL.pkl")

# Порядок суставов SMPL. Первые 22 — то, что отдаёт мокап; последние две
# кости (кисти) не берём: пальцев в SMPL-22 нет, и придумывать их некому.
NAMES = ["pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
         "spine2", "left_ankle", "right_ankle", "spine3", "left_foot",
         "right_foot", "neck", "left_collar", "right_collar", "head",
         "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
         "left_wrist", "right_wrist"]
N = len(NAMES)


# ── распаковка .pkl ──────────────────────────────────────────────────────
class _Ch(object):
    """Заглушка chumpy.

    Наследовать от `ndarray` нельзя: у него `__setstate__` требует кортеж из
    четырёх элементов, а chumpy пишет состояние словарём, и распаковка падает
    с `argument 1 must be 4-item sequence, not dict` — сообщение, по которому
    на chumpy не подумаешь вовсе.
    """

    def __setstate__(self, state):
        self.__dict__.update(state if isinstance(state, dict) else {})

    def value(self):
        for k in ("x", "v", "_data", "data"):
            v = self.__dict__.get(k)
            if v is not None:
                return np.asarray(v)
        raise SystemExit("в chumpy-объекте нет данных")


class _Sparse(object):
    """Разреженная матрица из старого пикла: раньше состояние писалось
    словарём, свежий scipy ждёт кортеж. Собираем сами."""

    def __setstate__(self, state):
        self.__dict__.update(state if isinstance(state, dict) else {})

    def rebuild(self):
        from scipy.sparse import csc_matrix
        shape = self.__dict__.get("_shape") or self.__dict__.get("shape")
        return csc_matrix((self.data, self.indices, self.indptr), shape=shape)


class _Unp(pickle.Unpickler):
    def find_class(self, mod, name):
        if mod.startswith("chumpy"):
            return _Ch
        if mod.startswith("scipy.sparse") and name.endswith("_matrix"):
            return _Sparse
        return super().find_class(mod, name)


def _np(o):
    if isinstance(o, _Ch):
        o = o.value()
    if isinstance(o, _Sparse):
        o = o.rebuild()
    if hasattr(o, "toarray"):
        o = o.toarray()
    return np.asarray(o, dtype=np.float64)


def load_smpl(path):
    for sub in ("chumpy", "chumpy.ch"):
        if sub not in sys.modules:
            m = types.ModuleType(sub)
            m.Ch = _Ch
            sys.modules[sub] = m
    with open(path, "rb") as f:
        d = _Unp(f, encoding="latin1").load()
    J = _np(d["J_regressor"]) @ _np(d["v_template"])
    return J[:N], _np(d["v_template"]), _np(d["kintree_table"]).astype(int)


# ── сборка .glb ──────────────────────────────────────────────────────────
def build_glb(world, parents):
    """world — мировые позиции костей (N,3); parents[i] — индекс родителя.

    Повороты тождественные: поза покоя описывается одними смещениями. Это
    стандартное для glTF представление, и любой загрузчик понимает его
    одинаково — в отличие от «кость вдоль локального +Y с поворотом»,
    которое было в прежнем файле и прятало позу внутри кватернионов.
    """
    nodes = []
    for i, name in enumerate(NAMES):
        p = parents[i]
        off = world[i] - (world[p] if p >= 0 else np.zeros(3))
        n = {"name": name, "translation": [float(x) for x in off]}
        kids = [j for j in range(N) if parents[j] == i]
        if kids:
            n["children"] = kids
        nodes.append(n)
    root = {"name": "Armature", "children": [i for i in range(N) if parents[i] < 0]}
    nodes.append(root)
    root_idx = len(nodes) - 1

    # inverseBindMatrices — обратные к мировым матрицам костей. Повороты
    # тождественные, значит это просто перенос на минус мировую позицию.
    buf = bytearray()
    for i in range(N):
        m = [1.0, 0, 0, 0,
             0, 1.0, 0, 0,
             0, 0, 1.0, 0,
             float(-world[i][0]), float(-world[i][1]), float(-world[i][2]), 1.0]
        buf += struct.pack("<16f", *m)
    while len(buf) % 4:
        buf.append(0)

    js = {
        "asset": {"version": "2.0",
                  "generator": "tools/rig/make_smpl_rig.py (шаблон SMPL_NEUTRAL)"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [root_idx]}],
        "nodes": nodes,
        "skins": [{"name": "SMPL22",
                   "joints": list(range(N)),
                   "skeleton": 0,
                   "inverseBindMatrices": 0}],
        "accessors": [{"bufferView": 0, "componentType": 5126,
                       "count": N, "type": "MAT4"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(buf)}],
        "buffers": [{"byteLength": len(buf)}],
    }
    jb = json.dumps(js, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    while len(jb) % 4:
        jb += b" "

    out = bytearray()
    out += b"glTF" + struct.pack("<II", 2, 12 + 8 + len(jb) + 8 + len(buf))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    out += struct.pack("<II", len(buf), 0x004E4942) + bytes(buf)
    return bytes(out)


def mirror_error(world):
    pairs = [(1, 2), (4, 5), (7, 8), (10, 11), (13, 14), (16, 17), (18, 19), (20, 21)]
    return max(float(np.linalg.norm(
        np.array([-world[a][0], world[a][1], world[a][2]]) - world[b]))
        for a, b in pairs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smpl", default=str(SMPL_DEFAULT))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    src = pathlib.Path(args.smpl)
    if not src.exists():
        raise SystemExit("не найден SMPL_NEUTRAL.pkl: %s" % src)

    J, verts, kt = load_smpl(src)
    parents = [-1] + [int(kt[0][i]) for i in range(1, N)]

    # Шаблон SMPL смотрит в +Z, а по спеке проекта персонаж смотрит в −Z.
    # Поворот на 180° вокруг Y — это смена знака у X и Z; лево остаётся слева.
    J = J * np.array([-1.0, 1.0, -1.0])
    verts = verts * np.array([-1.0, 1.0, -1.0])

    # Подошва на нуле. Считаем по МЕШУ, а не по кости стопы: кость сидит
    # внутри ступни, и по ней персонаж встал бы в землю по щиколотку.
    dy = -float(verts[:, 1].min())
    J[:, 1] += dy

    glb = build_glb(J, parents)
    pathlib.Path(args.out).write_bytes(glb)

    print("записан %s (%d байт)" % (args.out, len(glb)))
    print("костей: %d, порядок SMPL" % N)
    print("ошибка зеркала позы покоя: %.2f мм" % (mirror_error(J) * 1000))
    print("таз Y = %.4f, макушка Y = %.4f, низ костей Y = %.4f"
          % (J[0][1], J[NAMES.index("head")][1], J[:, 1].min()))
    print("рост по мешу: %.4f м" % (verts[:, 1].max() - verts[:, 1].min()))
    print("носок против щиколотки по Z: %.4f против %.4f (лицом в −Z)"
          % (J[NAMES.index("left_foot")][2], J[NAMES.index("left_ankle")][2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
