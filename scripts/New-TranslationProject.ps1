param(
    [Parameter(Mandatory = $true)]
    [string]$GameFolder,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{16}$')]
    [string]$TitleId,

    [Parameter(Mandatory = $true)]
    [string]$GameName,

    # Titles root override. Defaults to a "_titles" folder next to this script's
    # parent folder (workspace layout). Pass this explicitly when running the
    # knowledge-base copy of this script: -TitlesRoot <workspace>\_titles
    [Parameter(Mandatory = $false)]
    [string]$TitlesRoot
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TitlesRoot)) {
    $titlesRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\_titles'))
} else {
    $titlesRoot = [IO.Path]::GetFullPath($TitlesRoot)
}
if (-not (Test-Path -LiteralPath $titlesRoot -PathType Container)) {
    throw "Titles root does not exist: $titlesRoot (pass -TitlesRoot to point at the workspace _titles folder)"
}

$gameRoot = [IO.Path]::GetFullPath((Join-Path $titlesRoot $GameFolder))
$titlesPrefix = $titlesRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $gameRoot.StartsWith($titlesPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "GameFolder must be under $titlesRoot"
}
if (-not (Test-Path -LiteralPath $gameRoot -PathType Container)) {
    throw "Game folder does not exist: $gameRoot"
}

$id = $TitleId.ToUpperInvariant()
$project = Join-Path $gameRoot "_work\$id"

# Duplicate check 1: scan every _work folder under the titles root, including
# titles parked in waiting folders such as _waitng/_hold/_complete.
# -Depth 2 covers "<game>/_work" and "<waiting>/<game>/_work" without walking
# deep project trees.
$registeredProjects = @(
    Get-ChildItem -LiteralPath $titlesRoot -Directory -Recurse -Depth 2 -Filter '_work' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ieq $id }
        }
)

foreach ($registered in $registeredProjects) {
    if (-not $registered.FullName.Equals($project, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Title ID $id is already registered at $($registered.FullName)"
    }
}

# Duplicate check 2: GAME_REGISTRY.tsv (catches rows whose folders were moved
# or renamed and therefore escape the folder scan).
$registryPath = Join-Path $titlesRoot 'GAME_REGISTRY.tsv'
if (Test-Path -LiteralPath $registryPath -PathType Leaf) {
    foreach ($row in @(Import-Csv -LiteralPath $registryPath -Delimiter "`t")) {
        if (-not $row.base_title_id) { continue }
        if ($row.base_title_id.Trim().ToUpperInvariant() -ne $id) { continue }
        $rowGameRoot = $null
        if ($row.release_folder) {
            $rowGameRoot = [IO.Path]::GetFullPath((Join-Path $titlesRoot $row.release_folder.Trim()))
        }
        if (-not $rowGameRoot -or -not $rowGameRoot.Equals($gameRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Title ID $id is already registered in GAME_REGISTRY.tsv (release_folder: $($row.release_folder))"
        }
    }
}

$folders = @(
    '00_source',
    '10_extract\romfs_original',
    '10_extract\decompiled',
    '20_reference\external_patches',
    '20_reference\fonts',
    '20_reference\documents',
    '30_translation\text',
    '30_translation\text\translation_batches',
    '30_translation\text\reports',
    '30_translation\image_translation\for_translation',
    '30_translation\image_translation\reference',
    "40_build\layeredfs\$id\romfs",
    '40_build\staging',
    '40_build\releases',
    '50_test\screenshots',
    '50_test\logs',
    '90_tools\scripts',
    '90_tools\environment'
)

foreach ($folder in $folders) {
    New-Item -ItemType Directory -Force -Path (Join-Path $project $folder) | Out-Null
}

# Templates are single-quoted here-strings with {{TOKEN}} placeholders so that
# literal $-references (like $GT_TOOLS) survive and no backtick escaping is needed.

$projectFile = Join-Path $project 'PROJECT.md'
if (-not (Test-Path -LiteralPath $projectFile)) {
    $body = @'
# {{GAME_NAME}}

- Base Title ID: `{{TITLE_ID}}`
- Update Title ID: unknown
- Version: unknown
- Engine: unknown
- Default Korean font: undecided — inspect the actual files under `$GT_TOOLS/_fonts/`, choose one, and record its exact filename and SHA-256 here
- Status: registered; extraction not started

## Source packages

Record package filenames and sizes here.

## Current resume point

Identify the effective RomFS and engine before producing translation files.
'@
    $body = $body.Replace('{{GAME_NAME}}', $GameName).Replace('{{TITLE_ID}}', $id)
    Set-Content -LiteralPath $projectFile -Value $body -Encoding utf8
}

$workLog = Join-Path $project 'WORK_LOG.md'
if (-not (Test-Path -LiteralPath $workLog)) {
    $body = @'
# Work log

## Created

- Project registered for `{{TITLE_ID}}`.
- Extraction and analysis have not started.
'@
    $body = $body.Replace('{{TITLE_ID}}', $id)
    Set-Content -LiteralPath $workLog -Encoding utf8 -Value $body
}

$testLog = Join-Path $project '50_test\TEST_LOG.md'
if (-not (Test-Path -LiteralPath $testLog)) {
    Set-Content -LiteralPath $testLog -Encoding utf8 -Value @"
# Device test log

| Date | Build | Game version | UI language | Subtitle | Secondary subtitle | Test area | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
"@
}

$glossary = Join-Path $project '30_translation\text\glossary.tsv'
if (-not (Test-Path -LiteralPath $glossary)) {
    Set-Content -LiteralPath $glossary -Encoding utf8 -Value "source`treading`tko`tcategory`tevidence`tnotes"
}

$textManifest = Join-Path $project '30_translation\text\translation_manifest.tsv'
if (-not (Test-Path -LiteralPath $textManifest)) {
    Set-Content -LiteralPath $textManifest -Encoding utf8 -Value "id`tsource_file`tsource_key`tja`ten`ttarget_ko`tstatus`tnotes"
}

$codexWorkflow = Join-Path $project '30_translation\text\CODEX_TRANSLATION_WORKFLOW.md'
if (-not (Test-Path -LiteralPath $codexWorkflow)) {
    $body = @'
# {{GAME_NAME}} Codex translation configuration

The mandatory common procedure is `$GT_HOME/common/glossary-rules.md` (batch construction, translation, and independent second-pass review rules).

## Project settings

- Base Title ID: `{{TITLE_ID}}`
- Authoritative source language: Japanese unless analysis proves otherwise
- Secondary reference language: English when available
- Replacement language slot: undecided; confirm on device before full injection
- Batch size: fixed 80 editable rows (canonical rule: `$GT_HOME/common/glossary-rules.md` section 3); combined source/reference/draft text at most 48,000 characters
- Codex reasoning effort: high
- First-pass status: not started
- Independent second-pass status: not started

## Context and voice

Record the cast voice rules, route chronology, special terminology, and ambiguous source notes here before batch translation.

## Project-specific controls

Record placeholders, ruby syntax, link markers, line-break representation, and non-visible identifiers here before merging any output.
'@
    $body = $body.Replace('{{GAME_NAME}}', $GameName).Replace('{{TITLE_ID}}', $id)
    Set-Content -LiteralPath $codexWorkflow -Encoding utf8 -Value $body
}

$sourceInventory = Join-Path $project '00_source\SOURCE_INVENTORY.tsv'
if (-not (Test-Path -LiteralPath $sourceInventory)) {
    Set-Content -LiteralPath $sourceInventory -Encoding utf8 -Value "role`tfile_name`ttitle_id`tversion`tregion`tsize_bytes`tsha256`tnotes"
}

$referenceIndex = Join-Path $project '20_reference\REFERENCE_INDEX.tsv'
if (-not (Test-Path -LiteralPath $referenceIndex)) {
    Set-Content -LiteralPath $referenceIndex -Encoding utf8 -Value "type`tpath`torigin`tlicense_or_usage`tpurpose`tnotes"
}

$imageManifest = Join-Path $project '30_translation\image_translation\reference\image_manifest.tsv'
if (-not (Test-Path -LiteralPath $imageManifest)) {
    Set-Content -LiteralPath $imageManifest -Encoding utf8 -Value "id`tsource_archive`ttexture_key`tx`ty`twidth`theight`tlanguage`thash`tsource_text`ttarget_ko`tstatus`tnotes"
}

$buildManifest = Join-Path $project '40_build\BUILD_MANIFEST.tsv'
if (-not (Test-Path -LiteralPath $buildManifest)) {
    Set-Content -LiteralPath $buildManifest -Encoding utf8 -Value "build_id`tdate`tscope`tsource_clean_path`toutput_path`tsize_bytes`tsha256`tdevice_result`tnotes"
}

Write-Output $project
