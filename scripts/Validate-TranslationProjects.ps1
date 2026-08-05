param(
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
$titlesRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\_titles'))
$requiredDirectories = @(
    '00_source',
    '10_extract',
    '20_reference',
    '30_translation\text',
    '30_translation\image_translation\for_translation',
    '30_translation\image_translation\reference',
    '40_build\layeredfs',
    '40_build\releases',
    '50_test',
    '90_tools'
)
$requiredFiles = @(
    'PROJECT.md',
    'WORK_LOG.md',
    '00_source\SOURCE_INVENTORY.tsv',
    '20_reference\REFERENCE_INDEX.tsv',
    '30_translation\text\glossary.tsv',
    '30_translation\text\translation_manifest.tsv',
    '30_translation\text\CODEX_TRANSLATION_WORKFLOW.md',
    '30_translation\image_translation\reference\image_manifest.tsv',
    '40_build\BUILD_MANIFEST.tsv',
    '50_test\TEST_LOG.md'
)

$projects = @(
    Get-ChildItem -LiteralPath $titlesRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $workRoot = Join-Path $_.FullName '_work'
        if (Test-Path -LiteralPath $workRoot -PathType Container) {
            Get-ChildItem -LiteralPath $workRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^[0-9A-Fa-f]{16}$' }
        }
    }
)
$issues = [Collections.Generic.List[object]]::new()

if (-not $projects) {
    $issues.Add([PSCustomObject]@{ Severity = 'ERROR'; TitleId = '-'; Item = $titlesRoot; Problem = 'No translation projects found' })
}

$duplicates = $projects | Group-Object { $_.Name.ToUpperInvariant() } | Where-Object Count -gt 1
foreach ($duplicate in $duplicates) {
    $issues.Add([PSCustomObject]@{
        Severity = 'ERROR'
        TitleId = $duplicate.Name
        Item = ($duplicate.Group.FullName -join '; ')
        Problem = 'Title ID is registered in more than one project'
    })
}

foreach ($project in $projects) {
    $id = $project.Name.ToUpperInvariant()
    foreach ($relativePath in $requiredDirectories) {
        $path = Join-Path $project.FullName $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            $issues.Add([PSCustomObject]@{ Severity = 'ERROR'; TitleId = $id; Item = $relativePath; Problem = 'Required directory is missing' })
        }
    }
    foreach ($relativePath in $requiredFiles) {
        $path = Join-Path $project.FullName $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $issues.Add([PSCustomObject]@{ Severity = 'ERROR'; TitleId = $id; Item = $relativePath; Problem = 'Required project file is missing' })
        }
    }

    $layeredFsRoot = Join-Path $project.FullName '40_build\layeredfs'
    if (Test-Path -LiteralPath $layeredFsRoot) {
        $foreignIds = Get-ChildItem -LiteralPath $layeredFsRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^[0-9A-Fa-f]{16}$' -and $_.Name -ine $id }
        foreach ($foreignId in $foreignIds) {
            $issues.Add([PSCustomObject]@{
                Severity = 'ERROR'
                TitleId = $id
                Item = $foreignId.FullName
                Problem = 'LayeredFS folder belongs to another Title ID'
            })
        }
    }
}

$rootLeakNames = @('data', 'output', 'temp', 'romfs', 'image_translation', '.codex_m2_probe')
foreach ($searchRoot in @((Split-Path $titlesRoot -Parent), $titlesRoot)) {
    Get-ChildItem -LiteralPath $searchRoot -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object Name -In $rootLeakNames |
        ForEach-Object {
            $issues.Add([PSCustomObject]@{
                Severity = if ($Strict) { 'ERROR' } else { 'WARN' }
                TitleId = '-'
                Item = $_.FullName
                Problem = 'Unscoped work directory may mix game artifacts'
            })
        }
}

$projects |
    Sort-Object Name |
    Select-Object @{Name='TitleId';Expression={$_.Name.ToUpperInvariant()}}, @{Name='Project';Expression={$_.FullName}} |
    Format-Table -AutoSize

if ($issues.Count -gt 0) {
    $issues | Sort-Object Severity, TitleId, Item | Format-Table -Wrap -AutoSize
}

$errorCount = @($issues | Where-Object Severity -eq 'ERROR').Count
$warningCount = @($issues | Where-Object Severity -eq 'WARN').Count
Write-Output "Projects: $($projects.Count); Errors: $errorCount; Warnings: $warningCount"

if ($errorCount -gt 0) {
    exit 1
}
