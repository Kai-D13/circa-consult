$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist\extension"
$zip = Join-Path $root "dist\circa-consult-extension-v1.2.0.zip"
$files = @(
  "manifest.json", "core.js", "background.js", "content.js", "content.css",
  "popup.html", "popup.js", "options.html", "options.js"
)
if (Test-Path $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $dist $file) }
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Output $zip

