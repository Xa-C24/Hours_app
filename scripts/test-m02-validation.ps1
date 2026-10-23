param(
    [ValidateSet('Local','Http','Postgres')][string]$Mode = 'Http',
    [ValidateSet('neon-branch-test','local-synthetic')][string]$Target = 'neon-branch-test'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$names = @('DATABASE_URL','DB_PATH','SQLITE_DB_PATH','NODE_ENV','M01_TEST_DATABASE_URL','NEON_API_KEY',
    'M01_NEON_PROJECT_ID','M01_NEON_BRANCH_ID','M02_TEST_DATABASE_URL','M02_TEST_TARGET',
    'M02_NEON_API_KEY','M02_NEON_PROJECT_ID','M02_NEON_BRANCH_ID')
$previous = @{}
function Set-SecretEnvironment {
    param([string]$Name, [string]$Prompt)
    $secret = Read-Host $Prompt -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $secret.Dispose()
    }
}
foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
Push-Location -LiteralPath $projectRoot
$validationExit = 1
try {
    $env:NODE_ENV = 'test'
    # Every local fallback must target a fresh synthetic database, never data/hours.db.
    $testDirectory = Join-Path $projectRoot ('tmp/m02-validation-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
    $env:DB_PATH = Join-Path $testDirectory 'auth.sqlite'
    $env:SQLITE_DB_PATH = $env:DB_PATH
    if ($Mode -eq 'Postgres') {
        $env:M02_TEST_TARGET = $Target
        Set-SecretEnvironment -Name 'M02_TEST_DATABASE_URL' -Prompt 'URL de la base synthetique (saisie masquee)'
        if ($Target -eq 'neon-branch-test') {
            $env:M02_NEON_PROJECT_ID = Read-Host 'ID du projet Neon App_Hours'
            $env:M02_NEON_BRANCH_ID = Read-Host 'ID de la branche synthetique Branch_Test'
            Set-SecretEnvironment -Name 'M02_NEON_API_KEY' -Prompt 'Cle API Neon pour verifier la cible (saisie masquee)'
        }
        # The JavaScript guard verifies the branch and endpoint independently BEFORE connecting.
        & node --test test/user-id-test-target.test.js test/user-id-postgres.integration.test.js
    } elseif ($Mode -eq 'Local') {
        & node --test
    } else {
        & node --test test/api-v1.test.js test/authentication-security.test.js test/mobile-calendar-api.test.js test/work-timer-api.test.js test/account-backup.test.js
    }
    $validationExit = $LASTEXITCODE
} finally {
    Pop-Location
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
exit $validationExit

