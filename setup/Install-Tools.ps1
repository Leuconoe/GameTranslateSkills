<#
.SYNOPSIS
  tools.manifest.json 기반 게임 번역 도구 설치.
.DESCRIPTION
  mode=latest-github : GitHub 최신 릴리스에서 assetPattern과 일치하는 자산을 받아 압축 해제
  mode=download      : 안내 URL 출력 (수동 확인 후 다운로드)
  mode=manual        : 안내만 출력
  에뮬레이터·콘솔 키·롬은 절대 자동 배포하지 않습니다.
.PARAMETER ToolsRoot
  도구 배치 루트. 기본: $env:GT_TOOLS, 없으면 <현재 위치>\_tools
.PARAMETER Only
  특정 도구 이름만 설치 (쉼표 구분)
#>
[CmdletBinding()]
param(
    [string]$ToolsRoot = $(if ($env:GT_TOOLS) { $env:GT_TOOLS } else { Join-Path (Get-Location) '_tools' }),
    [string[]]$Only
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $PSScriptRoot 'tools.manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
Write-Host "도구 루트: $ToolsRoot`n"

foreach ($tool in $manifest.tools) {
    if ($Only -and $tool.name -notin $Only) { continue }
    Write-Host "== $($tool.name) — $($tool.purpose)" -ForegroundColor Cyan

    switch ($tool.mode) {
        'latest-github' {
            $dest = Join-Path $ToolsRoot $tool.dest
            if (Test-Path -LiteralPath $dest) { Write-Host "  이미 존재: $dest (건너뜀)"; break }
            try {
                $rel = Invoke-RestMethod "https://api.github.com/repos/$($tool.repo)/releases/latest" -Headers @{ 'User-Agent' = 'gt-setup' }
                $asset = $rel.assets | Where-Object { $_.name -like $tool.assetPattern } | Select-Object -First 1
                if (-not $asset) {
                    Write-Warning "  자산 패턴 '$($tool.assetPattern)' 불일치. 수동 설치: https://github.com/$($tool.repo)/releases"
                    break
                }
                $zip = Join-Path $env:TEMP $asset.name
                Write-Host "  다운로드: $($asset.name) ($([math]::Round($asset.size/1MB,1))MB)"
                Invoke-WebRequest $asset.browser_download_url -OutFile $zip
                if ($zip -like '*.zip') {
                    Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
                } else {
                    New-Item -ItemType Directory -Force -Path $dest | Out-Null
                    Copy-Item -LiteralPath $zip -Destination $dest
                }
                Remove-Item -LiteralPath $zip -Force -Confirm:$false
                Write-Host "  설치 완료: $dest" -ForegroundColor Green
            } catch {
                Write-Warning "  실패: $_. 수동 설치: https://github.com/$($tool.repo)/releases"
            }
        }
        'download' {
            Write-Host "  안내 URL:"
            $tool.urls | ForEach-Object { Write-Host "    $_" }
            if ($tool.note) { Write-Host "  참고: $($tool.note)" }
        }
        'manual' {
            Write-Host "  [수동 준비] $($tool.note)" -ForegroundColor Yellow
        }
    }
    Write-Host ''
}

Write-Host "완료. 수동 항목은 위 안내에 따라 배치한 뒤 다시 실행하면 상태를 확인할 수 있습니다."
