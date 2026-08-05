<#
.SYNOPSIS
  GameTranslateSkills를 Codex용 스킬과 지식 베이스로 설치한다.
.DESCRIPTION
  - skills/* → Codex skills 디렉터리
  - platforms/, engines/, common/, setup/, scripts/ → GT_HOME
  - 사용자 환경변수 GT_HOME 등록

  기존 대상 파일은 소스 파일로 덮어쓸 수 있지만, 대상에만 있는 파일은 삭제하지 않는다.
.PARAMETER CodexHome
  Codex 홈 디렉터리. 기본값은 CODEX_HOME 환경변수 또는 %USERPROFILE%\\.codex.
.PARAMETER GtHome
  지식 베이스 설치 위치. 기본값은 <CodexHome>\\game-translate.
.PARAMETER SkillsDir
  Codex 스킬 설치 위치. 기본값은 <CodexHome>\\skills.
.PARAMETER SkipUserEnvironment
  GT_HOME 사용자 환경변수 등록을 생략한다. 테스트나 일회성 설치에 사용한다.
#>
[CmdletBinding()]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$GtHome,
    [string]$SkillsDir,
    [switch]$SkipUserEnvironment
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$codexRoot = [IO.Path]::GetFullPath($CodexHome)

if ([string]::IsNullOrWhiteSpace($GtHome)) {
    $knowledgeRoot = Join-Path $codexRoot 'game-translate'
} else {
    $knowledgeRoot = $GtHome
}
$knowledgeRoot = [IO.Path]::GetFullPath($knowledgeRoot)

if ([string]::IsNullOrWhiteSpace($SkillsDir)) {
    $skillRoot = Join-Path $codexRoot 'skills'
} else {
    $skillRoot = $SkillsDir
}
$skillRoot = [IO.Path]::GetFullPath($skillRoot)

$sourceSkills = Join-Path $sourceRoot 'skills'
if (-not (Test-Path -LiteralPath $sourceSkills -PathType Container)) {
    throw "Skills directory not found: $sourceSkills"
}

$sourcePrefix = $sourceRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($destinationRoot in $skillRoot, $knowledgeRoot) {
    if ($destinationRoot.Equals($sourceRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $destinationRoot.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Installation destination must not be inside the repository: $destinationRoot"
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

[IO.Directory]::CreateDirectory($skillRoot) | Out-Null
Get-ChildItem -LiteralPath $sourceSkills -Directory | ForEach-Object {
    $destination = Join-Path $skillRoot $_.Name
    Copy-DirectoryContents -Source $_.FullName -Destination $destination
    Write-Host "Codex 스킬 설치: $($_.Name) → $destination" -ForegroundColor Green
}

foreach ($directoryName in 'platforms', 'engines', 'common', 'setup', 'scripts') {
    $source = Join-Path $sourceRoot $directoryName
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
    $destination = Join-Path $knowledgeRoot $directoryName
    Copy-DirectoryContents -Source $source -Destination $destination
    Write-Host "지식 베이스 설치: $directoryName → $destination" -ForegroundColor Green
}

if (-not $SkipUserEnvironment) {
    [Environment]::SetEnvironmentVariable('GT_HOME', $knowledgeRoot, 'User')
    $env:GT_HOME = $knowledgeRoot
    Write-Host "`nGT_HOME = $knowledgeRoot (사용자 환경변수 등록)"
} else {
    Write-Host "`nGT_HOME = $knowledgeRoot (사용자 환경변수 등록 생략)"
}
Write-Host "설치 완료. 새 Codex 세션에서 `$game-translate 스킬로 작업을 시작하세요."
