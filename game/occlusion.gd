class_name Occlusion
extends Node
## Видимость геометрии в изометрии:
##   1. перекрытие над этажом игрока гасится всегда (иначе внутри дома не видно ничего);
##   2. этажи выше игрока прячутся целиком;
##   3. стены, попавшие между камерой и игроком, гасятся до полупрозрачных.
##
## Гашение — через per-instance uniform `fade` в шейдере: один материал на все
## стены, никаких дубликатов и лишних draw call.

const FADE_HIDDEN := 0.05      ## насколько гасим то, что мешает
const FADE_SPEED := 9.0

var building: Building
var player: Player
var rig: CameraRig

var _fade_now: Dictionary = {}   ## MeshInstance3D -> текущее значение


func _process(delta: float) -> void:
	if building == null or player == null or rig == null:
		return

	var cam := rig.get_camera()
	if cam == null:
		return

	var from := cam.global_position
	var to := player.global_position + Vector3(0, 1.0, 0)
	var pf := player.floor_index
	building.set_focus(player.global_position)

	for mi in building.fadeable:
		if not is_instance_valid(mi):
			continue
		var mf: int = mi.get_meta("floor", 0)
		var is_ceiling: bool = mi.get_meta("is_ceiling", false)

		# Перекрытия и всё, что выше этажа игрока, просто не рисуем:
		# в изометрии потолки не показывают, а не гасят по кругу.
		if mf > pf:
			mi.visible = false
			continue
		mi.visible = true

		var want := 1.0
		if not is_ceiling and _blocks(mi, from, to):
			want = FADE_HIDDEN

		var cur: float = _fade_now.get(mi, 1.0)
		cur = lerpf(cur, want, clampf(FADE_SPEED * delta, 0.0, 1.0))
		_fade_now[mi] = cur
		mi.set_instance_shader_parameter(&"fade", cur)
		mi.set_instance_shader_parameter(&"hole_mode", 1.0)


## Пересекает ли объект отрезок «камера → игрок».
## AABB.intersects_segment возвращает точку пересечения или null, а не bool.
func _blocks(mi: MeshInstance3D, from: Vector3, to: Vector3) -> bool:
	var aabb := mi.global_transform * mi.get_aabb()
	return aabb.intersects_segment(from, to) != null


## Крыша дома: её гасим всегда, когда игрок внутри.
func hide_roof_above(pf: int) -> void:
	for mi in building.fadeable:
		if mi.get_meta("is_ceiling", false) and int(mi.get_meta("floor", 0)) > pf:
			mi.visible = false
