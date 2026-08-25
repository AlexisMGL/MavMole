param(
    [int]$Port = 3187,
    [string]$OutputDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'mavmole-ui-review'),
    [string]$NodePath = 'node',
    [string]$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if (-not (Test-Path -LiteralPath $EdgePath)) {
    throw "Microsoft Edge was not found at $EdgePath"
}

$env:PORT = $Port.ToString()
$serverProcess = Start-Process `
    -FilePath $NodePath `
    -ArgumentList 'server/server.js' `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $ready) {
        throw 'Preview server did not become ready.'
    }

    $captures = @(
        @{ Name = 'home-desktop.png'; Size = '1440,1200'; Path = '/' },
        @{ Name = 'mole-desktop.png'; Size = '1000,1400'; Path = '/mole' },
        @{ Name = 'dig-mobile.png'; Size = '500,1100'; Path = '/dig' }
    )
    $sessionId = [guid]::NewGuid().ToString('N')

    foreach ($capture in $captures) {
        $screenshotPath = Join-Path $OutputDirectory $capture.Name
        $profileName = "edge-profile-$sessionId-$($capture.Name.Replace('.png', ''))"
        $edgeProfile = Join-Path $OutputDirectory $profileName

        if (Test-Path -LiteralPath $screenshotPath) {
            Remove-Item -LiteralPath $screenshotPath
        }

        $edgeArguments = @(
            '--headless=new',
            '--disable-gpu',
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-extensions',
            '--hide-scrollbars',
            '--no-first-run',
            '--run-all-compositor-stages-before-draw',
            '--virtual-time-budget=1500',
            "--user-data-dir=$edgeProfile",
            "--window-size=$($capture.Size)",
            "--screenshot=$screenshotPath",
            "http://127.0.0.1:$Port$($capture.Path)"
        )

        Start-Process `
            -FilePath $EdgePath `
            -ArgumentList $edgeArguments `
            -WindowStyle Hidden `
            -Wait | Out-Null

        if (-not (Test-Path -LiteralPath $screenshotPath)) {
            throw "Failed to capture $($capture.Path)"
        }
    }

    Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.png' |
        Sort-Object Name |
        Select-Object FullName, Length
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id
    }
}

exit 0
