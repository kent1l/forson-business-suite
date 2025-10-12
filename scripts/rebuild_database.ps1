Param(
    [string]$ContainerName = "forson_db",
    [string]$DatabaseName = "forson_business_suite",
    [string]$DbSuperUser = "postgres",
    [string]$SchemaScript = "database/initial_schema.sql",
    [string]$MigrationsPath = "database/migrations"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host "===> $Description" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Description"
    }
}

function Run-DockerCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker ${($Arguments -join ' ')} failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $SchemaScript)) {
    throw "Schema script not found: $SchemaScript"
}

if (-not (Test-Path $MigrationsPath)) {
    throw "Migrations folder not found: $MigrationsPath"
}

$schemaFullPath = (Resolve-Path $SchemaScript).Path
$migrationFiles = Get-ChildItem -Path $MigrationsPath -Filter *.sql | Sort-Object Name

Invoke-Step "Dropping database $DatabaseName" {
    Run-DockerCommand @("exec", "-u", $DbSuperUser, $ContainerName, "psql", "-U", $DbSuperUser, "-c", "DROP DATABASE IF EXISTS $DatabaseName;")
}

Invoke-Step "Creating database $DatabaseName" {
    Run-DockerCommand @("exec", "-u", $DbSuperUser, $ContainerName, "psql", "-U", $DbSuperUser, "-c", "CREATE DATABASE $DatabaseName OWNER $DbSuperUser;")
}

$schemaDestination = "/tmp/$(Split-Path -Path $schemaFullPath -Leaf)"

Invoke-Step "Copying schema script to container" {
    Run-DockerCommand @("cp", $schemaFullPath, "$ContainerName:$schemaDestination")
}

Invoke-Step "Applying base schema" {
    Run-DockerCommand @("exec", "-u", $DbSuperUser, $ContainerName, "psql", "-U", $DbSuperUser, "-d", $DatabaseName, "-f", $schemaDestination)
}

foreach ($migration in $migrationFiles) {
    $migrationPath = (Resolve-Path $migration.FullName).Path
    $migrationDest = "/tmp/$($migration.Name)"
    Invoke-Step "Copying migration $($migration.Name)" {
        Run-DockerCommand @("cp", $migrationPath, "$ContainerName:$migrationDest")
    }
    Invoke-Step "Applying migration $($migration.Name)" {
        Run-DockerCommand @("exec", "-u", $DbSuperUser, $ContainerName, "psql", "-U", $DbSuperUser, "-d", $DatabaseName, "-f", $migrationDest)
    }
}

Write-Host "Database rebuild complete." -ForegroundColor Green
