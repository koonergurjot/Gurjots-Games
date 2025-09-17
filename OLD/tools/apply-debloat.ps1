<#
.SYNOPSIS
    Runs the debloat scanner and optionally removes files marked for deletion.

.DESCRIPTION
    Mirrors tools/apply-debloat.sh behaviour for Windows PowerShell users. The script
    refreshes debloat-report.json via scan-debloat.js and either performs a dry-run
    summary (default) or deletes the entries listed in the report's to_remove array
    when -Apply is specified.

.PARAMETER Apply
    Removes the paths listed in debloat-report.json to_remove after running the scanner.

.PARAMETER DryRun
    Explicitly request dry-run behaviour. This is the default mode when -Apply is not used.

.EXAMPLE
    ./tools/apply-debloat.ps1 -DryRun

.EXAMPLE
    ./tools/apply-debloat.ps1 -Apply
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$DryRun,
    [Alias('h')][switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-Usage {
    Write-Host "Usage: ./tools/apply-debloat.ps1 [-DryRun | -Apply]" -ForegroundColor Cyan
    Write-Host
    Write-Host "Runs the debloat scanner to refresh debloat-report.json and optionally" -ForegroundColor Cyan
    Write-Host "removes files listed in the report's to_remove array." -ForegroundColor Cyan
    Write-Host
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  -DryRun   Explicitly run in dry-run mode (default behaviour)" -ForegroundColor Cyan
    Write-Host "  -Apply    Delete entries listed in debloat-report.json to_remove" -ForegroundColor Cyan
    Write-Host "  -Help     Show this help message" -ForegroundColor Cyan
}

function Fail {
    param(
        [Parameter(Mandatory)][string]$Message,
        [int]$ExitCode = 1
    )

    Write-Error $Message
    exit $ExitCode
}

if ($Help) {
    Show-Usage
    exit 0
}

if ($Apply -and $DryRun) {
    Fail -Message "Cannot use both -Apply and -DryRun."
}

$mode = if ($Apply) { 'apply' } else { 'dry' }

$repoRoot = (Get-Location).ProviderPath
$normalizedRoot = [System.IO.Path]::GetFullPath($repoRoot)
if ($normalizedRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootWithSep = $normalizedRoot
} else {
    $rootWithSep = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
}

$scriptDir = Split-Path -Path $PSCommandPath -Parent

if (-not (Test-Path -LiteralPath '.git' -PathType Container) -or
    -not (Test-Path -LiteralPath 'package.json' -PathType Leaf) -or
    -not (Test-Path -LiteralPath 'tools' -PathType Container)) {
    Fail -Message 'This script must be executed from the repository root.'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail -Message 'node is required to run the debloat scanner.'
}

$preservedToRemove = @()
if (Test-Path -LiteralPath 'debloat-report.json') {
    try {
        $raw = Get-Content -LiteralPath 'debloat-report.json' -Raw
        if ($raw.Trim().Length -gt 0) {
            $existingReport = $raw | ConvertFrom-Json -Depth 32
            if ($existingReport -and $existingReport.PSObject.Properties.Name -contains 'to_remove') {
                $value = $existingReport.to_remove
                if ($null -ne $value) {
                    $preservedToRemove = @($value | ForEach-Object { $_.ToString() })
                }
            }
        }
    } catch {
        # Ignore invalid existing report while preserving state.
    }
}

try {
    & node (Join-Path -Path $scriptDir -ChildPath 'scan-debloat.js')
} catch {
    Fail -Message "Debloat scanner failed: $($_.Exception.Message)"
}

if ($LASTEXITCODE -ne 0) {
    Fail -Message "Debloat scanner exited with code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath 'debloat-report.json' -PathType Leaf)) {
    Fail -Message 'scan-debloat did not produce debloat-report.json'
}

try {
    $report = (Get-Content -LiteralPath 'debloat-report.json' -Raw) | ConvertFrom-Json -Depth 32
} catch {
    Fail -Message "Unable to read refreshed debloat-report.json: $($_.Exception.Message)"
}

if ($preservedToRemove.Count -gt 0) {
    $report | Add-Member -NotePropertyName 'to_remove' -NotePropertyValue @($preservedToRemove) -Force
} else {
    if ($report.PSObject.Properties.Name -contains 'to_remove') {
        $report.PSObject.Properties.Remove('to_remove') | Out-Null
    }
}

try {
    $json = $report | ConvertTo-Json -Depth 32
    [System.IO.File]::WriteAllText((Join-Path -Path $normalizedRoot -ChildPath 'debloat-report.json'), $json + "`n", [System.Text.Encoding]::UTF8)
} catch {
    Fail -Message "Failed to write debloat-report.json: $($_.Exception.Message)"
}

try {
    $report = (Get-Content -LiteralPath 'debloat-report.json' -Raw) | ConvertFrom-Json -Depth 32
} catch {
    Fail -Message "Unable to reload debloat-report.json: $($_.Exception.Message)"
}

$rawToRemove = @()
if ($report -and $report.PSObject.Properties.Name -contains 'to_remove' -and $null -ne $report.to_remove) {
    $rawToRemove = @($report.to_remove)
}

$entries = New-Object System.Collections.Generic.List[object]
$missing = New-Object System.Collections.Generic.List[string]
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$totalBytes = [long]0
$existingCount = 0

function Get-RelativePathFromRoot {
    param(
        [Parameter(Mandatory)][string]$FullPath
    )

    if ($FullPath.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $FullPath.Substring($rootWithSep.Length)
    }

    return $FullPath
}

function Resolve-SafePath {
    param(
        [Parameter(Mandatory)][string]$Relative
    )

    $combined = [System.IO.Path]::Combine($normalizedRoot, $Relative)
    $resolved = [System.IO.Path]::GetFullPath($combined)
    if ($resolved -eq $normalizedRoot) {
        throw "Refusing to operate on repository root via entry: $Relative"
    }
    if (-not $resolved.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside repository root: $Relative"
    }
    return $resolved
}

function Get-EntrySize {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RelativePath
    )

    try {
        $item = Get-Item -LiteralPath $Path -Force
    } catch {
        $display = if ([string]::IsNullOrWhiteSpace($RelativePath)) { Get-RelativePathFromRoot -FullPath $Path } else { $RelativePath }
        throw "Unable to access $display: $($_.Exception.Message)"
    }

    if ($item.PSIsContainer -and -not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        $sum = [long]0
        $stack = New-Object System.Collections.Stack
        $stack.Push($item.FullName) | Out-Null
        while ($stack.Count -gt 0) {
            $current = $stack.Pop()
            try {
                $children = Get-ChildItem -LiteralPath $current -Force
            } catch {
                $displayCurrent = Get-RelativePathFromRoot -FullPath $current
                throw "Unable to enumerate $displayCurrent: $($_.Exception.Message)"
            }
            foreach ($child in $children) {
                if ($child.PSIsContainer -and -not ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                    $stack.Push($child.FullName) | Out-Null
                }
                if ($child -is [System.IO.FileInfo]) {
                    $sum += [long]$child.Length
                }
            }
        }
        return $sum
    }

    if ($item -is [System.IO.FileInfo]) {
        return [long]$item.Length
    }

    return [long]0
}

foreach ($entry in $rawToRemove) {
    $value = if ($null -ne $entry) { $entry.ToString() } else { '' }
    $trimmed = $value.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        Fail -Message 'Invalid to_remove entry detected. All entries must be non-empty strings.'
    }
    if (-not $seen.Add($trimmed)) {
        continue
    }

    try {
        $resolved = Resolve-SafePath -Relative $trimmed
    } catch {
        Fail -Message $_
    }

    if (Test-Path -LiteralPath $resolved) {
        try {
            $size = Get-EntrySize -Path $resolved -RelativePath $trimmed
        } catch {
            Fail -Message $_
        }
        $totalBytes += $size
        $existingCount += 1
        $entries.Add([PSCustomObject]@{
            Path = $trimmed
            FullPath = $resolved
            SizeBytes = $size
            Missing = $false
        }) | Out-Null
    } else {
        $missing.Add($trimmed) | Out-Null
        $entries.Add([PSCustomObject]@{
            Path = $trimmed
            FullPath = $resolved
            SizeBytes = [long]0
            Missing = $true
        }) | Out-Null
    }
}

function Format-Size {
    param(
        [Parameter(Mandatory)][long]$Bytes
    )

    $units = @('bytes', 'KB', 'MB', 'GB', 'TB', 'PB')
    $value = [double]$Bytes
    $index = 0
    while ($value -ge 1024 -and $index -lt ($units.Count - 1)) {
        $value = $value / 1024
        $index++
    }
    return ('{0:N2} {1}' -f $value, $units[$index])
}

Write-Host 'Debloat dry-run summary:'
Write-Host "  Total entries in to_remove: $($entries.Count)"
Write-Host "  Existing entries: $existingCount"
if ($missing.Count -gt 0) {
    Write-Host "  Missing entries (will be ignored): $($missing.Count)"
}
Write-Host "  Estimated reclaimable size: $(Format-Size -Bytes $totalBytes) ($totalBytes bytes)"

if ($mode -eq 'apply') {
    if ($entries.Count -eq 0) {
        Write-Host 'No entries listed in to_remove; nothing to apply.'
        exit 0
    }

    $removedCount = 0
    $removedBytes = [long]0
    $failures = $false
    $index = 0
    foreach ($entry in $entries) {
        $index++
        if ($entry.Missing) {
            Write-Host "Skipping $($entry.Path) (not found)."
            continue
        }
        Write-Host "[$index/$($entries.Count)] Removing $($entry.Path)..."
        try {
            Remove-Item -LiteralPath $entry.FullPath -Recurse -Force -ErrorAction Stop
            $removedCount += 1
            $removedBytes += [long]$entry.SizeBytes
        } catch {
            Write-Error "Failed to remove $($entry.Path): $($_.Exception.Message)"
            $failures = $true
        }
    }

    Write-Host ("Removal complete. Removed {0} entr{1}." -f $removedCount, (if ($removedCount -eq 1) { 'y' } else { 'ies' }))
    Write-Host ("Estimated space reclaimed: {0} ({1} bytes)." -f (Format-Size -Bytes $removedBytes), $removedBytes)

    try {
        $reportAfter = (Get-Content -LiteralPath 'debloat-report.json' -Raw) | ConvertFrom-Json -Depth 32
    } catch {
        Fail -Message "Unable to reopen debloat-report.json: $($_.Exception.Message)"
    }

    $remaining = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $entries) {
        if ([string]::IsNullOrWhiteSpace($entry.Path)) { continue }
        if (Test-Path -LiteralPath $entry.FullPath) {
            $remaining.Add($entry.Path) | Out-Null
        }
    }

    if ($remaining.Count -gt 0) {
        $reportAfter | Add-Member -NotePropertyName 'to_remove' -NotePropertyValue @($remaining) -Force
    } else {
        if ($reportAfter.PSObject.Properties.Name -contains 'to_remove') {
            $reportAfter.PSObject.Properties.Remove('to_remove') | Out-Null
        }
    }

    try {
        $json = $reportAfter | ConvertTo-Json -Depth 32
        [System.IO.File]::WriteAllText((Join-Path -Path $normalizedRoot -ChildPath 'debloat-report.json'), $json + "`n", [System.Text.Encoding]::UTF8)
    } catch {
        Fail -Message "Failed to update debloat-report.json after removal: $($_.Exception.Message)"
    }

    if ($failures) {
        exit 1
    }
}

exit 0
