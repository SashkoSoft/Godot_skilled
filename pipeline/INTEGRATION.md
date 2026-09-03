# Интеграция ассетов — файл vs игра

Генерируется: `python pipeline/check_integration.py`. Руками не править.

Проверяет не то, что написано в разделе «Приёмка» задачи, а то, что реально есть на диске: скопирован ли файл поставки куда-либо под `game/assets/` (по имени файла) и упоминается ли его имя (без расширения) хоть в одном `.gd`-файле `game/` (грубая, но рабочая проверка «использован ли», а не просто «лежит рядом»).

| Задача | Статус | Скопировано | Упомянуто в коде | Что не скопировано |
|---|---|---|---|---|
| task-0002 — Бетонная панель: стены и перекрытия | accepted | 9/12 | 0/12 | concrete_facade_height_2k.png, wall_paint_height_2k.png, wall_paint_worn_height_2k.png |
| task-0003 — Плитка и бетон лестничной клетки | accepted | 9/12 | 0/12 | landing_floor_height_2k.png, stair_tread_height_2k.png, stair_wall_height_2k.png |
| task-0004 — Грязь и разводы на стекло | accepted | 5/5 | 0/5 |  |
| task-0005 — Дверные блоки: межкомнатные и входные | accepted | 7/7 | 4/7 |  |
| task-0006 — Оконные и балконные блоки | accepted | 6/6 | 3/6 |  |
| task-0007 — Перила и ограждения лестницы | accepted | 6/6 | 0/6 |  |
| task-0008 — Двери лифта и обрамление шахты | accepted | 5/5 | 2/5 |  |
| task-0011 — Зелень: плети, мох, трава | accepted | 0/12 | 0/12 | grass_patch_1_albedo_1k.png, grass_patch_1_normal_1k.png, grass_patch_2_albedo_1k.png, grass_patch_2_normal_1k.png, moss_corner_albedo_1k.png, moss_corner_normal_1k.png, moss_edge_albedo_1k.png, moss_edge_normal_1k.png, vine_wall_1_albedo_1k.png, vine_wall_1_normal_1k.png, vine_wall_2_albedo_1k.png, vine_wall_2_normal_1k.png |
| task-0012 — Сантехника и кухонная плита | accepted | 8/8 | 5/8 |  |
| task-0014 — Материалы квартиры: полы, стены, потолок, плитка | accepted | 18/18 | 0/18 |  |
| task-0015 — Мебель квартиры: кухня, шкафы, батареи | accepted | 9/9 | 6/9 |  |
| task-0016 — Дверцы кладовок 1а, 2а, 6а | accepted | 6/6 | 3/6 |  |
| task-0017 — Остекление лоджии: парапет и переплёт | accepted | 0/6 | 0/6 | loggia_albedo_1k.png, loggia_frame_section.glb, loggia_frame_vent.glb, loggia_normal_1k.png, loggia_orm_1k.png, loggia_parapet.glb |
| task-0018 — Декали износа: потёки, плесень, вытертые тропы | accepted | 17/17 | 0/17 |  |
| task-0019 — Бумага на стенах: плакаты, календарь, обрывки | accepted | 8/8 | 0/8 |  |
| task-0020 — Звук пустой квартиры: шаги, двери, гул | accepted | 26/26 | 2/26 |  |
| task-0021 — Обои: четыре разных рисунка на выбор | accepted | 12/12 | 0/12 |  |
| task-0022 — Полы: паркет ёлочкой и второй линолеум | accepted | 10/10 | 1/10 |  |
| task-0023 — Краска кухни и прихожей: убавить выбоины, два состояния | accepted | 6/6 | 1/6 |  |
| task-0024 — Балконная дверь под проём 1.13 | accepted | 0/5 | 0/5 | balcony_door_narrow.glb, balcony_door_narrow_albedo_1k.png, balcony_door_narrow_broken.glb, balcony_door_narrow_normal_1k.png, balcony_door_narrow_orm_1k.png |
| task-0025 — Плитка пола санузла и фартук кухни | accepted | 12/12 | 0/12 |  |
| task-0026 — Шторы, занавески и карнизы | accepted | 9/9 | 4/9 |  |
| task-0027 — Обои с орнаментом: четыре рисунка | accepted | 12/12 | 0/12 |  |
| task-0028 — Плитка: шов тоньше на стене и на полу | accepted | 12/12 | 0/12 |  |
| task-0029 — Кровать, тумбочка, комод для жилых комнат | accepted | 7/7 | 4/7 |  |
| task-0030 — Обеденный стол и стулья, холодильник | accepted | 6/6 | 3/6 |  |
| task-0031 — Плинтус вдоль пола во всех помещениях | accepted | 5/5 | 2/5 |  |
| task-0033 — Плитка — маска шва для процедурного нойза | accepted | 3/3 | 0/3 |  |

## Не полностью в игре

- **task-0002** — Бетонная панель: стены и перекрытия: скопировано 9/12, не хватает: concrete_facade_height_2k.png, wall_paint_height_2k.png, wall_paint_worn_height_2k.png
- **task-0003** — Плитка и бетон лестничной клетки: скопировано 9/12, не хватает: landing_floor_height_2k.png, stair_tread_height_2k.png, stair_wall_height_2k.png
- **task-0011** — Зелень: плети, мох, трава: скопировано 0/12, не хватает: grass_patch_1_albedo_1k.png, grass_patch_1_normal_1k.png, grass_patch_2_albedo_1k.png, grass_patch_2_normal_1k.png, moss_corner_albedo_1k.png, moss_corner_normal_1k.png, moss_edge_albedo_1k.png, moss_edge_normal_1k.png, vine_wall_1_albedo_1k.png, vine_wall_1_normal_1k.png, vine_wall_2_albedo_1k.png, vine_wall_2_normal_1k.png
- **task-0017** — Остекление лоджии: парапет и переплёт: скопировано 0/6, не хватает: loggia_albedo_1k.png, loggia_frame_section.glb, loggia_frame_vent.glb, loggia_normal_1k.png, loggia_orm_1k.png, loggia_parapet.glb
- **task-0024** — Балконная дверь под проём 1.13: скопировано 0/5, не хватает: balcony_door_narrow.glb, balcony_door_narrow_albedo_1k.png, balcony_door_narrow_broken.glb, balcony_door_narrow_normal_1k.png, balcony_door_narrow_orm_1k.png
