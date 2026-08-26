class_name Occlusion
extends Node
## Видимость геометрии в изометрии:
##   1. перекрытие над этажом игрока гасится всегда (иначе внутри дома не видно ничего);
##   2. этажи выше игрока прячутся целиком;
##   3. стены, попавшие между камерой и игроком, гасятся до полупрозрачных.
##
## Гашение — через per-instance uniform `fade` в шейдере: один материал на все
## стены, никаких дубликатов и лишних draw call.

const FADE_HIDDEN := 0.20      ## насколько гасим то, что реально загораживает
const FADE_SPEED := 9.0
## Чем ближе стена к игроку, тем слабее её гасим: вплотную она остаётся
## отчётливо видимой (иначе кажется, что персонаж проваливается сквозь неё),
## и только на отдалении уходит в 20%.
const NEAR_MIN := 0.4          ## вплотную
const NEAR_MAX := 2.6          ## отсюда гасим полностью
const FADE_NEAR := 0.55        ## плотность стены, к которой прижался игрок

var building: Tower
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
		if mi.get_meta("is_mark", false):
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
			# чем ближе стена к игроку, тем меньше её гасим
			var d := _distance_to_player(mi)
			var k := clampf((d - NEAR_MIN) / (NEAR_MAX - NEAR_MIN), 0.0, 1.0)
			want = lerpf(FADE_NEAR, FADE_HIDDEN, k)

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


## Горизонтальное расстояние от игрока до ближайшей точки объекта.
func _distance_to_player(mi: MeshInstance3D) -> float:
	var aabb := mi.global_transform * mi.get_aabb()
	var p := player.global_position
	var closest := Vector3(
		clampf(p.x, aabb.position.x, aabb.position.x + aabb.size.x),
		p.y,
		clampf(p.z, aabb.position.z, aabb.position.z + aabb.size.z)
	)
	return Vector2(closest.x - p.x, closest.z - p.z).length()


## Крыша дома: её гасим всегда, когда игрок внутри.
func hide_roof_above(pf: int) -> void:
	for mi in building.fadeable:
		if mi.get_meta("is_ceiling", false) and int(mi.get_meta("floor", 0)) > pf:
			mi.visible = false
