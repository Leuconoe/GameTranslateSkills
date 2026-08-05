<#
.SYNOPSIS
  game-translate 스킬 세트 설치.
.DESCRIPTION
  - skills/*        → ~/.claude/skills/           (Claude Code 스킬 등록)
  - platforms/, engines/, common/, setup/, scripts/ → GT_HOME (지식 베이스)
  - 사용자 환경변수 GT_HOME 설정
.PARAMETER GtHome
  지식 베이스 설치 위치. 기본: ~/.claude/game-translate
.PARAMETER SkillsDir
  스킬 설치 위치. 기본: ~/.claude/skills
#>
[CmdletBinding()]
param(
    [string]$GtHome = (Join-Path $HOME '.claude\game-translate'),
    [string]$SkillsDir = (Join-Path $HOME '.claude\skills')
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

# 1. 스킬 복사
New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
Get-ChildItem (Join-Path $repo 'skills') -Directory | ForEach-Object {
    $dest = Join-Path $SkillsDir $_.Name
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -Confirm:$false }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse
    Write-Host "스킬 설치: $($_.Name)" -ForegroundColor Green
}

# 2. 지식 베이스 복사
New-Item -ItemType Directory -Force -Path $GtHome | Out-Null
foreach ($dir in 'platforms', 'engines', 'common', 'setup', 'scripts') {
    $src = Join-Path $repo $dir
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dest = Join-Path $GtHome $dir
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -Confirm:$false }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse
    Write-Host "지식 베이스: $dir → $dest" -ForegroundColor Green
}

# 3. 환경변수
[Environment]::SetEnvironmentVariable('GT_HOME', $GtHome, 'User')
Write-Host "`nGT_HOME = $GtHome (사용자 환경변수 등록 — 새 세션부터 적용)"
Write-Host "설치 완료. Claude Code에서 'game-translate' 스킬로 시작하세요."
Write-Host "도구 설치: pwsh `"$GtHome\setup\Install-Tools.ps1`" -ToolsRoot <작업루트>\_tools"
