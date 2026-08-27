class_name Navigation
extends NavigationRegion3D
## Навигационная сетка, испечённая прямо из коллизий построенного дома.
##
## Редактор мы не открываем, поэтому печём в коде: собираем геометрию со
## статических тел здания и отдаём её NavigationServer3D. Лестничные марши
## заданы наклонной плитой, поэтому попадают в сетку как пандус, и бот
## поднимается по ним сам.

const CELL := 0.05              ## мельче клетка — марш переживает эрозию
const AGENT_RADIUS := 0.22      ## шире — рвётся лестница и теряются комнаты
const AGENT_HEIGHT := 1.8
const MAX_CLIMB := 0.30         ## порог ступени
const MAX_SLOPE := 50.0         ## марш идёт под 30°


func bake_from(building: Node3D) -> void:
	var nav := NavigationMesh.new()
	nav.cell_size = CELL
	nav.cell_height = CELL
	nav.agent_radius = AGENT_RADIUS
	nav.agent_height = AGENT_HEIGHT
	nav.agent_max_climb = MAX_CLIMB
	nav.agent_max_slope = MAX_SLOPE
	nav.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nav.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_ROOT_NODE_CHILDREN

	var src := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(nav, src, building)
	NavigationServer3D.bake_from_source_geometry_data(nav, src)
	# карта навигации должна жить в тех же клетках, что и сетка, иначе
	# движок ругается на рассинхрон и края полигонов рвутся
	var map := get_world_3d().navigation_map
	NavigationServer3D.map_set_cell_size(map, CELL)
	NavigationServer3D.map_set_cell_height(map, CELL)
	navigation_mesh = nav


## Явные связи по маршам. Запекание рвёт узкий марш на куски, и этажи
## оказываются не соединены; связь склеивает их надёжно и не зависит от того,
## как Recast поделил лестницу на регионы.
func add_stair_links(floors: int) -> void:
	var run := 2.6
	var half := Tower.FLOOR_H * 0.5
	var z_near := Tower.STAIR_Z0 + 1.7
	var z_far := z_near + run
	for f in floors - 1:
		var y0 := f * Tower.FLOOR_H
		_link(Vector3(Tower.STAIR_X0 + 0.58, y0 + 0.10, z_near - 0.40),
				Vector3(Tower.STAIR_X0 + 0.58, y0 + half + 0.10, z_far + 0.40))
		_link(Vector3(Tower.STAIR_X0 + 1.62, y0 + half + 0.10, z_far + 1.45),
				Vector3(Tower.STAIR_X0 + 1.62, y0 + Tower.FLOOR_H + 0.10,
						z_far + 1.05 - run - 0.40))


func _link(a: Vector3, b: Vector3) -> void:
	var l := NavigationLink3D.new()
	l.start_position = a
	l.end_position = b
	l.bidirectional = true
	l.navigation_layers = 1
	add_child(l)


## Сколько всего полигонов получилось — по этому числу видно, испеклось ли.
func polygon_count() -> int:
	if navigation_mesh == null:
		return 0
	return navigation_mesh.get_polygon_count()
