param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path (Split-Path $PSScriptRoot -Parent) "public/js/mavlink-dialect.js"
}
$source = Get-Content -Raw -LiteralPath $SourcePath
$constructorPattern = "mavlink20\.messages\.(?<type>[A-Za-z0-9_]+)\s*=\s*function\(\s*\.\.\.moreargs\s*\)\s*\{(?<body>.*?)\r?\n\}"
$constructors = @{}

foreach ($match in [regex]::Matches($source, $constructorPattern, [Text.RegularExpressions.RegexOptions]::Singleline)) {
  $body = $match.Groups["body"].Value
  $nameMatch = [regex]::Match($body, "this\._name\s*=\s*'(?<value>[^']+)'\s*;")
  $fieldsMatch = [regex]::Match($body, "this\.fieldnames\s*=\s*\[(?<value>[^\]]*)\]\s*;")

  if (-not $nameMatch.Success -or -not $fieldsMatch.Success) {
    continue
  }

  $fields = @(
    [regex]::Matches($fieldsMatch.Groups["value"].Value, "'(?<value>[^']*)'") |
      ForEach-Object { $_.Groups["value"].Value }
  )
  $constructors[$match.Groups["type"].Value] = @{
    name = $nameMatch.Groups["value"].Value
    fields = $fields
  }
}

$mapPattern = "(?m)^\s*(?<id>\d+):\s*\{\s*format:\s*'(?<format>[^']+)',\s*type:\s*mavlink20\.messages\.(?<type>[A-Za-z0-9_]+),\s*order_map:\s*\[(?<order>[^\]]*)\],\s*crc_extra:\s*(?<crc>\d+)\s*\},"
$definitionsById = @{}

foreach ($match in [regex]::Matches($source, $mapPattern)) {
  $type = $match.Groups["type"].Value
  $constructor = $constructors[$type]
  if ($null -eq $constructor) {
    throw "No constructor metadata found for MAVLink message type '$type'."
  }

  $order = @(
    $match.Groups["order"].Value -split "," |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -ne "" } |
      ForEach-Object { [int]$_ }
  )
  $id = [int]$match.Groups["id"].Value
  $definitionsById[$id] = @(
    $id,
    $constructor.name,
    $match.Groups["format"].Value,
    $order,
    [int]$match.Groups["crc"].Value,
    $constructor.fields
  )
}

$definitions = [Collections.Generic.List[object]]::new()
foreach ($id in ($definitionsById.Keys | Sort-Object { [int]$_ })) {
  $definitions.Add($definitionsById[$id])
}

if ($definitions.Count -lt 300) {
  throw "Only $($definitions.Count) MAVLink definitions were extracted; refusing to write an incomplete dialect."
}

$json = ConvertTo-Json -InputObject $definitions -Depth 8 -Compress
$javascript = @"
(function createMavlinkDialect(globalScope) {
  "use strict";

  // Generated from mavgen JavaScript definitions. Rebuild with tools/build-mavlink-dialect.ps1.
  const definitions = $json;
  const byId = new Map(definitions.map((definition) => [definition[0], definition]));
  const api = Object.freeze({
    definitions: Object.freeze(definitions),
    byId,
    get(messageId) {
      return byId.get(messageId) || null;
    },
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.MavMoleDialect = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
"@

$outputDirectory = Split-Path $OutputPath -Parent
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[IO.File]::WriteAllText($OutputPath, $javascript, [Text.UTF8Encoding]::new($false))
Write-Output "Wrote $($definitions.Count) MAVLink definitions to $OutputPath"
