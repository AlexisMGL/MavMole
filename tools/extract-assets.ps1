param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetsRoot = Join-Path $ProjectRoot 'assets'
$boardPath = Join-Path $assetsRoot 'source\mavmole-brand-board.png'
$generatedMascotPath = Join-Path $assetsRoot 'source\mole-transparent-generated.png'

if (-not (Test-Path -LiteralPath $boardPath)) {
    throw "Missing source board: $boardPath"
}

if (-not (Test-Path -LiteralPath $generatedMascotPath)) {
    throw "Missing generated mascot: $generatedMascotPath"
}

$outputDirectories = @(
    'brand',
    'icons',
    'banners',
    'backgrounds',
    'mascot',
    'animations\enter',
    'animations\emerge',
    'animations\walk'
)

foreach ($directory in $outputDirectories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $assetsRoot $directory) | Out-Null
}

function Save-Crop {
    param(
        [System.Drawing.Bitmap]$Source,
        [System.Drawing.Rectangle]$Rectangle,
        [string]$RelativeOutputPath
    )

    if ($Rectangle.Left -lt 0 -or $Rectangle.Top -lt 0 -or
        $Rectangle.Right -gt $Source.Width -or $Rectangle.Bottom -gt $Source.Height) {
        throw "Crop outside source bounds: $RelativeOutputPath"
    }

    $outputPath = Join-Path $assetsRoot $RelativeOutputPath
    $bitmap = New-Object System.Drawing.Bitmap($Rectangle.Width, $Rectangle.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.DrawImage(
            $Source,
            (New-Object System.Drawing.Rectangle(0, 0, $Rectangle.Width, $Rectangle.Height)),
            $Rectangle,
            [System.Drawing.GraphicsUnit]::Pixel
        )
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-CroppedResize {
    param(
        [System.Drawing.Bitmap]$Source,
        [System.Drawing.Rectangle]$Rectangle,
        [System.Drawing.Size]$OutputSize,
        [string]$RelativeOutputPath
    )

    $outputPath = Join-Path $assetsRoot $RelativeOutputPath
    $bitmap = New-Object System.Drawing.Bitmap($OutputSize.Width, $OutputSize.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage(
            $Source,
            (New-Object System.Drawing.Rectangle(0, 0, $OutputSize.Width, $OutputSize.Height)),
            $Rectangle,
            [System.Drawing.GraphicsUnit]::Pixel
        )
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-SpriteStrip {
    param(
        [System.Drawing.Bitmap]$Source,
        [System.Drawing.Rectangle[]]$Frames,
        [System.Drawing.Size]$CellSize,
        [string]$RelativeOutputPath
    )

    $outputPath = Join-Path $assetsRoot $RelativeOutputPath
    $bitmap = New-Object System.Drawing.Bitmap(($CellSize.Width * $Frames.Count), $CellSize.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, 250, 246, 237))
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        for ($index = 0; $index -lt $Frames.Count; $index += 1) {
            $destination = New-Object System.Drawing.Rectangle(($index * $CellSize.Width), 0, $CellSize.Width, $CellSize.Height)
            $graphics.DrawImage($Source, $destination, $Frames[$index], [System.Drawing.GraphicsUnit]::Pixel)
        }

        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$board = [System.Drawing.Bitmap]::FromFile($boardPath)
$generatedMascot = [System.Drawing.Bitmap]::FromFile($generatedMascotPath)

try {
    $staticCrops = @(
        @{ Path = 'brand\mavmole-lockup.png'; Rectangle = [System.Drawing.Rectangle]::new(450, 30, 620, 380) },
        @{ Path = 'brand\mavmole-banner.png'; Rectangle = [System.Drawing.Rectangle]::new(552, 475, 628, 140) },
        @{ Path = 'icons\mole-square.png'; Rectangle = [System.Drawing.Rectangle]::new(60, 480, 143, 135) },
        @{ Path = 'icons\mole-circle.png'; Rectangle = [System.Drawing.Rectangle]::new(220, 482, 131, 132) },
        @{ Path = 'icons\mole-small.png'; Rectangle = [System.Drawing.Rectangle]::new(363, 524, 59, 61) },
        @{ Path = 'icons\molehill.png'; Rectangle = [System.Drawing.Rectangle]::new(435, 510, 83, 100) },
        @{ Path = 'banners\side-left.png'; Rectangle = [System.Drawing.Rectangle]::new(1217, 475, 113, 274) },
        @{ Path = 'banners\side-right.png'; Rectangle = [System.Drawing.Rectangle]::new(1355, 475, 115, 274) },
        @{ Path = 'backgrounds\tunnel-pattern.png'; Rectangle = [System.Drawing.Rectangle]::new(50, 655, 1082, 94) }
    )

    foreach ($crop in $staticCrops) {
        Save-Crop -Source $board -Rectangle $crop.Rectangle -RelativeOutputPath $crop.Path
    }

    Save-CroppedResize `
        -Source $generatedMascot `
        -Rectangle ([System.Drawing.Rectangle]::new(195, 155, 1145, 690)) `
        -OutputSize ([System.Drawing.Size]::new(796, 480)) `
        -RelativeOutputPath 'mascot\mole-transparent.png'

    $animationSets = @(
        @{
            Name = 'enter'
            CellSize = [System.Drawing.Size]::new(104, 73)
            Frames = [System.Drawing.Rectangle[]]@(
                [System.Drawing.Rectangle]::new(42, 796, 104, 73),
                [System.Drawing.Rectangle]::new(151, 796, 104, 73),
                [System.Drawing.Rectangle]::new(263, 796, 104, 73),
                [System.Drawing.Rectangle]::new(375, 796, 104, 73),
                [System.Drawing.Rectangle]::new(42, 889, 104, 73),
                [System.Drawing.Rectangle]::new(151, 889, 104, 73),
                [System.Drawing.Rectangle]::new(263, 889, 104, 73),
                [System.Drawing.Rectangle]::new(375, 889, 104, 73)
            )
        },
        @{
            Name = 'emerge'
            CellSize = [System.Drawing.Size]::new(105, 73)
            Frames = [System.Drawing.Rectangle[]]@(
                [System.Drawing.Rectangle]::new(524, 796, 105, 73),
                [System.Drawing.Rectangle]::new(638, 796, 105, 73),
                [System.Drawing.Rectangle]::new(756, 796, 105, 73),
                [System.Drawing.Rectangle]::new(876, 796, 105, 73),
                [System.Drawing.Rectangle]::new(524, 889, 105, 73),
                [System.Drawing.Rectangle]::new(638, 889, 105, 73),
                [System.Drawing.Rectangle]::new(756, 889, 105, 73),
                [System.Drawing.Rectangle]::new(876, 889, 105, 73)
            )
        },
        @{
            Name = 'walk'
            CellSize = [System.Drawing.Size]::new(115, 70)
            Frames = [System.Drawing.Rectangle[]]@(
                [System.Drawing.Rectangle]::new(1005, 797, 115, 70),
                [System.Drawing.Rectangle]::new(1128, 797, 115, 70),
                [System.Drawing.Rectangle]::new(1251, 797, 115, 70),
                [System.Drawing.Rectangle]::new(1374, 797, 115, 70),
                [System.Drawing.Rectangle]::new(1005, 890, 115, 70),
                [System.Drawing.Rectangle]::new(1128, 890, 115, 70),
                [System.Drawing.Rectangle]::new(1251, 890, 115, 70),
                [System.Drawing.Rectangle]::new(1374, 890, 115, 70)
            )
        }
    )

    foreach ($animation in $animationSets) {
        for ($index = 0; $index -lt $animation.Frames.Count; $index += 1) {
            $frameNumber = ($index + 1).ToString('00')
            Save-Crop `
                -Source $board `
                -Rectangle $animation.Frames[$index] `
                -RelativeOutputPath "animations\$($animation.Name)\frame-$frameNumber.png"
        }

        Save-SpriteStrip `
            -Source $board `
            -Frames $animation.Frames `
            -CellSize $animation.CellSize `
            -RelativeOutputPath "animations\mole-$($animation.Name)-strip.png"
    }
}
finally {
    $board.Dispose()
    $generatedMascot.Dispose()
}

Get-ChildItem -Path $assetsRoot -Recurse -File |
    Where-Object { $_.FullName -notlike '*\source\*' } |
    Sort-Object FullName |
    Select-Object FullName, Length
