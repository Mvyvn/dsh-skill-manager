# dsh-skill-manager installer — Windows
# Installs the plugin into the dsh web profile, then tells you to restart.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dshHome  = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$target   = Join-Path $dshHome 'profiles\web\node_modules\dsh-skill-manager'

if (-not (Test-Path (Join-Path $dshHome 'profiles\web'))) {
    Write-Host "[dsh-skill-manager] web profile not found at $dshHome\profiles\web" -ForegroundColor Red
    Write-Host "Start 'dsh web' once so the profile is generated, then re-run this script." -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $repoRoot 'lib')              $target -Recurse -Force
Copy-Item (Join-Path $repoRoot 'cordis.patch.yml') $target -Force
Copy-Item (Join-Path $repoRoot 'package.json')     $target -Force

Write-Host "[dsh-skill-manager] installed to $target" -ForegroundColor Green
Write-Host "Now FULLY restart 'dsh web' (stop the process, then start it again) - a page refresh is not enough." -ForegroundColor Cyan
