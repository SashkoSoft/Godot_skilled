class_name Navigation
extends NavigationRegion3D
## Навигационная сетка, испечённая прямо из коллизий построенного дома.
##
## Редактор мы не открываем, поэтому печём в коде: собираем геометрию со
## статических тел здания и отдаём её NavigationServer3D. Лестничные марши
## заданы наклонной плитой, поэтому попадают в сетку как пандус, и бот
## поднимается по ним сам.

const CELL := 0.08              ## мельче дверного проёма, иначе двери «зарастают»
const AGENT_RADIUS := 0.30      ## путь держится дальше от косяков, чем габарит бота
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
	navigation_mesh = nav


## Сколько всего полигонов получилось — по этому числу видно, испеклось ли.
func polygon_count() -> int:
	if navigation_mesh == null:
		return 0
	return navigation_mesh.get_polygon_count()
