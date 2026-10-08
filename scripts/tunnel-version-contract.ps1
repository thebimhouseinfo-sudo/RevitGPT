function Test-TunnelVersionContract {
    param(
        [Parameter(Mandatory=$true)][string]$VersionText,
        [Parameter(Mandatory=$true)][string]$RequiredVersion
    )

    # CLI prints a SemVer core with optional +build metadata (git hash).
    # Match explicitly: -notmatch does not reliably populate $Matches.
    $pattern = '(?<![A-Za-z0-9.])v?([0-9]+\.[0-9]+\.[0-9]+)(?:\+[0-9A-Za-z.-]+)?(?![A-Za-z0-9.+-])'
    $match = [regex]::Match($VersionText, $pattern)
    if (-not $match.Success) { return $false }
    return $match.Groups[1].Value -ceq $RequiredVersion
}
