# Звук

## Пул плееров для one-shot

Один `AudioStreamPlayer` не сыграет два звука одновременно — второй `play()`
обрывает первый. Заводи кольцевой пул:

```gdscript
var sfx_pool: Array = []
var sfx_pool_i := 0

func _build_audio() -> void:
    for i in range(8):
        var p := AudioStreamPlayer.new()
        add_child(p)
        sfx_pool.append(p)

func _sfx(stream: AudioStream, vol_db := 0.0, pitch := 1.0) -> void:
    if stream == null or sfx_pool.is_empty():
        return
    var p: AudioStreamPlayer = sfx_pool[sfx_pool_i]
    sfx_pool_i = (sfx_pool_i + 1) % sfx_pool.size()
    p.stream = stream
    p.volume_db = vol_db
    p.pitch_scale = pitch
    p.play()
```

Часто повторяющимся звукам (клик, шаг, монетка) всегда давай разброс тона
`randf_range(0.94, 1.06)` — иначе слух быстро устаёт от «пулемёта».

Громкость только в **децибелах**: `-6` — заметно тише, `-26` — фон, `-60` —
практически тишина. Линейного `volume` нет.

## Звук в точке мира, когда камера далеко

```gdscript
var p := AudioStreamPlayer3D.new()
p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED  # не глохнет с расстояния
p.panning_strength = 1.4                                        # но стерео-панорама есть
p.position = pos
add_child(p)
p.finished.connect(p.queue_free)     # самоуничтожение после проигрывания
p.play()
```

Для вида сверху с дистанции 1500+ единиц честное затухание = тишина. Отключаешь
затухание, оставляешь панораму — получаешь «слышно, где это произошло».

## Зацикливание WAV

Godot зацикливает по флагам **самого ресурса**, а не плеера:

```gdscript
var e := load("res://sounds/engine.wav") as AudioStreamWAV
snd_engine = e.duplicate()           # duplicate! иначе испортишь общий ресурс
snd_engine.loop_mode = AudioStreamWAV.LOOP_FORWARD
snd_engine.loop_begin = 0
snd_engine.loop_end = int(snd_engine.get_length() * snd_engine.mix_rate)
```

`loop_end` — в **сэмплах**, не в секундах.

## Процедурный звук без ассетов

Шум дождя, ветра, гудки и бипы качать не нужно — генерируй:

```gdscript
func _make_rain_noise() -> AudioStreamWAV:
    var rate := 22050
    var n := rate * 2                       # 2 секунды
    var data := PackedByteArray()
    data.resize(n * 2)                      # 16 бит = 2 байта на сэмпл
    var v := 0.0
    for i in range(n):
        # фильтр первого порядка над белым шумом = мягкий «коричневый» шум
        v = clampf(v * 0.992 + (randf() * 2.0 - 1.0) * 0.16, -0.75, 0.75)
        data.encode_s16(i * 2, int(v * 22000.0))
    var w := AudioStreamWAV.new()
    w.format = AudioStreamWAV.FORMAT_16_BITS
    w.mix_rate = rate
    w.stereo = false
    w.data = data
    w.loop_mode = AudioStreamWAV.LOOP_FORWARD
    w.loop_end = n
    return w
```

Чистый белый шум звучит как шипение; после фильтра — как шорох дождя.
Клик и «пик» — затухающая синусоида, авария — шум с резкой атакой.

## Непрерывные звуки: fade, а не вкл/выкл

```gdscript
var target := -14.0 if weather == 1 else -60.0
rain_snd.volume_db = move_toward(rain_snd.volume_db, target, dt * 18.0)
if rain_snd.volume_db > -55.0 and not rain_snd.playing:
    rain_snd.play()
elif rain_snd.volume_db <= -55.0 and rain_snd.playing:
    rain_snd.stop()
```

Резкий `stop()` слышен как щелчок. И реально останавливай плеер на тишине —
иначе он молча занимает микшер.

Мотор машинки: `volume_db` и `pitch_scale` считаются от текущей скорости
(`-28.0 + 8.0 * momentum`), при аварии сразу `-60`.

## Headless

Под `--headless` звука нет и `play()` ничего не делает — это не ошибка, просто
не пытайся так проверять звук.
