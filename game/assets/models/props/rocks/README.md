# Камешки — процедурные, 2 LOD, под рандомизацию скриптом

16 форм: `Pebble_00..07` (окатанная галька, сплюснутая) и `Rock_00..07` (колотые, со сколами).
- `rocks_lod0` — 320 треуг. на камень, текстуры 512; `rocks_lod1` — 80 треуг., текстуры 256. Дальше — не рисовать.
- Каждая форма нормирована: **наибольший размер = 1 м, начало координат — снизу по центру** (стоит на земле).
  Размер в игре = масштаб: галька 0.02–0.12, камни 0.05–0.4. Слегка утапливать (на 5–20 % высоты).
- Текстура одна на всех, светло-серая: **цвет = множитель** (цвет экземпляра / albedo). В цвете вершин
  (COLOR_0) запечена окклюзия: низ и впадины темнее — любой оттенок выглядит объёмно.
- Имена узлов одинаковые в обоих LOD. В `_web.glb` (meshopt) сетка лежит в дочернем узле названного узла.
- Коллизий нет (мелочь); для крупных камней — сфера/капсула по масштабу.
- Валидатор: 0 ошибок, 0 предупреждений.

Палитра натуральных тонов (sRGB, домножать ×0.85–1.15):
`#9E9991 #8C786B #B39E80 #5C5957 #A88C78 #807F75 #94755C #C7BFAD #4D4745 #9E8566`

## Godot 4 — россыпь через MultiMesh
```gdscript
# Материал из glb: StandardMaterial3D с vertex_color_use_as_albedo = true (нужно для цвета экземпляров и окклюзии).
func scatter(parent: Node3D, rocks_scene: PackedScene, count: int, radius: float, rng := RandomNumberGenerator.new()):
    var src := rocks_scene.instantiate()
    var palette := [Color("9E9991"), Color("8C786B"), Color("B39E80"), Color("5C5957"), Color("A88C78"),
                    Color("807F75"), Color("94755C"), Color("C7BFAD"), Color("4D4745"), Color("9E8566")]
    for shape in src.get_children():                       # по MultiMesh на форму
        var mesh: Mesh = (shape as MeshInstance3D).mesh
        var mat := mesh.surface_get_material(0).duplicate()
        mat.vertex_color_use_as_albedo = true
        mesh.surface_set_material(0, mat)
        var mm := MultiMesh.new()
        mm.transform_format = MultiMesh.TRANSFORM_3D
        mm.use_colors = true
        mm.mesh = mesh
        mm.instance_count = count / src.get_child_count()
        for i in mm.instance_count:
            var s := rng.randf_range(0.03, 0.12) if shape.name.begins_with("Pebble") else rng.randf_range(0.05, 0.3)
            var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s * rng.randf_range(0.85, 1.15), s, s))
            var p := Vector3(rng.randf_range(-radius, radius), -s * rng.randf_range(0.05, 0.2), rng.randf_range(-radius, radius))
            mm.set_instance_transform(i, Transform3D(basis, p))
            mm.set_instance_color(i, palette[rng.randi() % palette.size()] * rng.randf_range(0.85, 1.15))
        var mmi := MultiMeshInstance3D.new()
        mmi.multimesh = mm
        mmi.visibility_range_end = 25.0                    # LOD0 до 12 м, LOD1 до 25 м — дальше не рисуем
        parent.add_child(mmi)
```

## three.js — InstancedMesh
```js
const gltf = await loader.loadAsync("rocks_lod0_web.glb");        // MeshoptDecoder подключён
const palette = ["#9E9991","#8C786B","#B39E80","#5C5957","#A88C78","#807F75","#94755C","#C7BFAD","#4D4745","#9E8566"];
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
for (const node of gltf.scene.children) {                          // Pebble_00 … Rock_07
  const src = node.isMesh ? node : node.getObjectsByProperty("isMesh", true)[0];
  const n = 40;
  const im = new THREE.InstancedMesh(src.geometry, src.material, n); // material.vertexColors = true (есть COLOR_0)
  for (let i = 0; i < n; i++) {
    const s = node.name.startsWith("Pebble") ? 0.03 + Math.random() * 0.09 : 0.05 + Math.random() * 0.25;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3((Math.random() - 0.5) * 8, -s * 0.1, (Math.random() - 0.5) * 8), q,
              new THREE.Vector3(s * (0.85 + Math.random() * 0.3), s, s));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.set(palette[i % palette.length]).multiplyScalar(0.85 + Math.random() * 0.3));
  }
  scene.add(im);
}
```

Пересборка: `python gen_rock_texture.py` → `blender -b --factory-startup --python build_rocks.py` → `node validate_rocks.js`.
