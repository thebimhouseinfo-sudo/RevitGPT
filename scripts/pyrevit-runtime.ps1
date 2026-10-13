Set-StrictMode -Version Latest

function Get-PyRevitCliCandidates {
    param(
        [string]$AppData = $env:APPDATA,
        [string]$ProgramFiles = $env:ProgramFiles,
        [string]$ProgramFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    )

    $candidates = @()
    if ($AppData) {
        $candidates += (Join-Path $AppData "pyRevit-Master\bin\pyrevit.exe")
    }
    if ($ProgramFiles) {
        $candidates += (Join-Path $ProgramFiles "pyRevit-Master\bin\pyrevit.exe")
        $candidates += (Join-Path $ProgramFiles "pyRevit CLI\bin\pyrevit.exe")
    }
    if ($ProgramFilesX86) {
        $candidates += (Join-Path $ProgramFilesX86 "pyRevit-Master\bin\pyrevit.exe")
        $candidates += (Join-Path $ProgramFilesX86 "pyRevit CLI\bin\pyrevit.exe")
    }
    return @($candidates | Select-Object -Unique)
}

function Find-PyRevitCli {
    param(
        [string]$AppData = $env:APPDATA,
        [string]$ProgramFiles = $env:ProgramFiles,
        [string]$ProgramFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)"),
        [switch]$SkipPathLookup
    )

    if (-not $SkipPathLookup) {
        $cmd = Get-Command pyrevit.exe -ErrorAction SilentlyContinue
        if (-not $cmd) {
            $cmd = Get-Command pyrevit -ErrorAction SilentlyContinue
        }
        if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) {
            return $cmd.Source
        }
    }

    foreach ($candidate in (Get-PyRevitCliCandidates -AppData $AppData -ProgramFiles $ProgramFiles -ProgramFilesX86 $ProgramFilesX86)) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    return $null
}

function Get-PyRevitAttachmentPaths {
    param(
        [Parameter(Mandatory=$true)][int]$Year,
        [string]$AppData = $env:APPDATA,
        [string]$ProgramData = $env:ProgramData,
        [string]$ProgramFiles = $env:ProgramFiles
    )

    $paths = @()
    if ($AppData) {
        $paths += (Join-Path $AppData "Autodesk\Revit\Addins\$Year\pyRevit.addin")
    }

    if ($Year -ge 2027) {
        if ($ProgramFiles) {
            $paths += (Join-Path $ProgramFiles "Autodesk\Revit\Addins\$Year\pyRevit.addin")
        }
    } elseif ($ProgramData) {
        $paths += (Join-Path $ProgramData "Autodesk\Revit\Addins\$Year\pyRevit.addin")
    }

    return @($paths | Select-Object -Unique)
}

function Get-PyRevitAttachmentInfo {
    param(
        [Parameter(Mandatory=$true)][int]$Year,
        [string]$AppData = $env:APPDATA,
        [string]$ProgramData = $env:ProgramData,
        [string]$ProgramFiles = $env:ProgramFiles
    )

    foreach ($path in (Get-PyRevitAttachmentPaths -Year $Year -AppData $AppData -ProgramData $ProgramData -ProgramFiles $ProgramFiles)) {
        if (-not (Test-Path $path)) { continue }

        $assembly = $null
        $name = $null
        $parseError = $null
        try {
            [xml]$xml = Get-Content $path -Raw
            $addin = $xml.RevitAddIns.AddIn | Select-Object -First 1
            $assembly = [string]$addin.Assembly
            $name = [string]$addin.Name
        } catch {
            $parseError = $_.Exception.Message
        }

        return [pscustomobject]@{
            Year = $Year
            ManifestPath = $path
            Name = $name
            AssemblyPath = $assembly
            AssemblyExists = [bool]($assembly -and (Test-Path $assembly))
            ParseError = $parseError
        }
    }

    return $null
}

function Get-RunningRevitYears {
    $years = @()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='Revit.exe'" -ErrorAction SilentlyContinue)) {
        $samples = @([string]$proc.ExecutablePath)
        if ($proc.ExecutablePath -and (Test-Path $proc.ExecutablePath)) {
            try {
                $vi = (Get-Item $proc.ExecutablePath).VersionInfo
                $samples += @([string]$vi.ProductName, [string]$vi.FileDescription, [string]$vi.ProductVersion)
            } catch {}
        }
        foreach ($sample in $samples) {
            if ($sample -match '(20\d{2})') {
                $years += [int]$Matches[1]
                break
            }
        }
    }
    return @($years | Sort-Object -Unique)
}
