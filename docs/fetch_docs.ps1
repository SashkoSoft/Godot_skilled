# Восстанавливает локальную копию документации Godot 4.7 и демо-проектов.
# Эти клоны не хранятся в репозитории (~970 МБ, своя история git).
# Запуск:  powershell -ExecutionPolicy Bypass -File docs\fetch_docs.ps1

$ErrorActionPreference = "Stop"
$BranchDocs = "4.7"   # ветка мануала — должна совпадать с версией движка
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Clone-OrPull([string]$Url, [string]$Path, [string]$Branch) {
	if (Test-Path (Join-Path $Path ".git")) {
		Write-Host "== обновляю $Path"
		git -C $Path pull --ff-only
	} else {
		Write-Host "== клонирую $Url ($Branch) -> $Path"
		git clone --depth 1 --branch $Branch --single-branch $Url $Path
	}
}

Clone-OrPull "https://github.com/godotengine/godot-docs.git"          (Join-Path $Dir "godot-docs")          $BranchDocs
Clone-OrPull "https://github.com/godotengine/godot-demo-projects.git" (Join-Path $Dir "godot-demo-projects") "master"

Write-Host ""
Write-Host "Готово. Статей мануала:" (Get-ChildItem (Join-Path $Dir "godot-docs") -Recurse -Filter *.rst).Count
