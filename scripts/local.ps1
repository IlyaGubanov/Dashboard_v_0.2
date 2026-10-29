# Локальный запуск МВС СТ на Windows без Docker: Node.js 22+ и MySQL 8.0+ на этом компьютере.
#
#   local.cmd setup   — первый раз: спросит подключение к MySQL, установит зависимости, создаст базу,
#                        загрузит демо-данные и демо-учётки по ролям, соберёт сервер
#   local.cmd start   — запустить: API в отдельном окне, интерфейс — здесь; откроется браузер http://localhost:5173
#   local.cmd demo    — вернуть демо-данные к исходному виду (всё внесённое вручную будет удалено)
#
# Настройки хранятся в local.env (в корне проекта, в git не попадает).
param([string]$Command = 'help')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Api = Join-Path $Root 'apps\api'
$EnvFile = Join-Path $Root 'local.env'

function Say([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "`nОшибка: $text" -ForegroundColor Red; exit 1 }

# Запуск внешней программы с проверкой кода возврата
function Run([string]$exe, [string[]]$arguments, [string]$dir = $Root) {
  Push-Location $dir
  try {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') завершился с кодом $LASTEXITCODE" }
  } finally { Pop-Location }
}

function Ask([string]$question, [string]$default) {
  $v = Read-Host "$question [$default]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $default } else { return $v.Trim() }
}

function Load-Env {
  if (-not (Test-Path $EnvFile)) { Fail 'нет файла local.env — сначала выполните: local.cmd setup' }
  foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
  }
  # локально — по http, без HTTPS; файлы (фото) — в apps\api\data\files
  $env:COOKIE_SECURE = 'false'
  $env:PORT = '3000'
  if (-not $env:FILES_DIR) { $env:FILES_DIR = Join-Path $Api 'data\files' }
}

function Check-Node {
  try { $v = (& node -v) } catch { Fail 'не найден Node.js. Установите Node.js 22 LTS или новее: https://nodejs.org' }
  $major = [int]($v.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { Fail "нужен Node.js 22 или новее, установлен $v" }
  Write-Host "Node.js $v"
}

function Create-EnvFile {
  if (Test-Path $EnvFile) { Say 'local.env уже есть — подключение к базе берётся из него'; return }
  Say 'Подключение к MySQL (8.0 или новее)'
  $h = Ask 'Адрес сервера MySQL' 'localhost'
  $port = Ask 'Порт' '3306'
  $user = Ask 'Пользователь (нужны права на создание базы)' 'root'
  $sec = Read-Host 'Пароль пользователя MySQL' -AsSecureString
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $db = Ask 'Имя базы (будет создана, если её нет)' 'mvs_local'
  $admin = Ask 'Пароль администратора приложения (логин admin; от 10 символов, буквы и цифры)' 'Admin2026local'
  $auth = if ($pass) { "$([uri]::EscapeDataString($user)):$([uri]::EscapeDataString($pass))" } else { [uri]::EscapeDataString($user) }
  @(
    '# Локальный запуск МВС СТ (scripts\local.ps1). Не публикуйте: здесь пароль MySQL.'
    "DATABASE_URL=mysql://$auth@${h}:$port/$db"
    'ADMIN_LOGIN=admin'
    "ADMIN_PASSWORD=$admin"
    'DEMO_DATA=true'
  ) | Set-Content -Path $EnvFile -Encoding UTF8
  Write-Host "Сохранено в $EnvFile"
}

function Setup {
  Check-Node
  Create-EnvFile
  Load-Env
  Say 'Установка зависимостей (несколько минут при первом запуске)'
  Run 'npm.cmd' @('ci', '--no-audit', '--no-fund')
  Say 'Сборка общих модулей'
  Run 'npm.cmd' @('run', 'build', '-w', '@mvs/shared')
  Run 'npm.cmd' @('run', 'db:generate')
  Say 'База данных: создание и миграции'
  Run 'npx.cmd' @('prisma', 'migrate', 'deploy') $Api
  Say 'Справочники и администратор'
  Run 'npx.cmd' @('tsx', 'prisma/seed.ts') $Api
  if ($env:DEMO_DATA -eq 'true') {
    Say 'Демо-данные исходного дашборда'
    Run 'npx.cmd' @('tsx', 'prisma/demo/import.ts') $Api
    Say 'Демо-учётки по ролям'
    Run 'npx.cmd' @('tsx', 'prisma/demo/users.ts') $Api
  }
  Say 'Сборка сервера'
  Run 'npm.cmd' @('run', 'build', '-w', '@mvs/api')
  Say 'Готово. Запуск: local.cmd start'
}

function Start-App {
  Load-Env
  if (-not (Test-Path (Join-Path $Api 'dist\main.js'))) { Fail 'сервер не собран — выполните: local.cmd setup' }
  Say 'Запуск API (отдельное окно, не закрывайте его)'
  $apiProc = Start-Process -FilePath 'node' -ArgumentList 'dist/main.js' -WorkingDirectory $Api -PassThru
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Start-Sleep -Seconds 1 }
    if ($apiProc.HasExited) { break }
  }
  if (-not $ok) {
    if (-not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
    Fail 'API не запустился — посмотрите сообщение в его окне (часто: MySQL не запущен, неверный пароль в local.env или порт 3000 занят)'
  }
  Write-Host 'API: http://localhost:3000/api'
  Say 'Интерфейс: http://localhost:5173 (остановить — Ctrl+C в этом окне)'
  try {
    Run 'npm.cmd' @('run', 'dev', '-w', '@mvs/web', '--', '--open')
  } finally {
    if (-not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
  }
}

function Reset-Demo {
  Load-Env
  $ok = Read-Host 'Демо-данные будут загружены заново, всё внесённое вручную — удалено. Продолжить? (да / y)'
  if ($ok -notmatch '^(да|д|y|yes)$') { Write-Host 'Отменено'; return }
  Run 'npx.cmd' @('tsx', 'prisma/demo/import.ts', '--force', '--delete-manual-data') $Api
  Run 'npx.cmd' @('tsx', 'prisma/demo/users.ts') $Api
}

switch ($Command) {
  'setup' { Setup }
  'start' { Start-App }
  'demo' { Reset-Demo }
  default {
    Write-Host 'Команды: local.cmd setup | local.cmd start | local.cmd demo'
    Write-Host 'Подробно: docs\11-lokalnyy-zapusk.md'
  }
}
