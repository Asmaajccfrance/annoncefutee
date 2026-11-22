# Active l'offre Découverte pour les tests : 50 crédits/mois + inscriptions + API client.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/activer-offre-gratuite-prod.ps1

$ErrorActionPreference = 'Stop'
$key = Join-Path $env:USERPROFILE '.ssh\o2switch_tunnel'
$remote = 'sc1crje1720@pen.o2switch.net'
$app = '/home/sc1crje1720/annoncefutee-app'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Remote([string]$Command) {
    ssh -o BatchMode=yes -o ConnectTimeout=25 -o IdentitiesOnly=yes -i $key $remote $Command
}

if (-not (Test-Path $key)) {
    throw "Clé SSH introuvable: $key"
}

Write-Host 'Connexion SSH…'
Invoke-Remote "echo CONNECTED; whoami"

Write-Host 'Backup fichiers…'
Invoke-Remote @"
mkdir -p /home/sc1crje1720/backups
cp -p $app/app/Models/Plan.php /home/sc1crje1720/backups/Plan.php.20261117-free50
cp -p $app/config/credits.php /home/sc1crje1720/backups/credits.php.20261117-free50
cp -p $app/.env /home/sc1crje1720/backups/env.20261117-free50
echo backup_ok
"@

Write-Host 'Envoi fichiers…'
scp -i $key -o IdentitiesOnly=yes `
    "$root\backend\app\Models\Plan.php" `
    "${remote}:${app}/app/Models/Plan.php"
scp -i $key -o IdentitiesOnly=yes `
    "$root\backend\config\credits.php" `
    "${remote}:${app}/config/credits.php"
scp -i $key -o IdentitiesOnly=yes `
    "$root\backend\database\migrations\2026_11_17_190000_set_free_plan_to_fifty_credits.php" `
    "${remote}:${app}/database/migrations/"

Write-Host 'Mise à jour .env + migration…'
# Met à jour uniquement les clés demandées, sans afficher le .env.
Invoke-Remote @"
cd $app
php -r '
\$path = ".env";
\$env = file_get_contents(\$path);
\$map = [
  "CREDITS_MONTHLY" => "50",
  "PUBLIC_REGISTRATION" => "true",
  "CLIENT_API" => "true",
];
foreach (\$map as \$key => \$value) {
  \$pattern = "/^" . preg_quote(\$key, "/") . "=.*/m";
  if (preg_match(\$pattern, \$env)) {
    \$env = preg_replace(\$pattern, \$key . "=" . \$value, \$env, 1);
  } else {
    \$env = rtrim(\$env) . PHP_EOL . \$key . "=" . \$value . PHP_EOL;
  }
}
file_put_contents(\$path, \$env);
echo "env_updated\n";
'
php artisan migrate --force --path=database/migrations/2026_11_17_190000_set_free_plan_to_fifty_credits.php
php artisan optimize:clear
php artisan tinker --execute="echo App\\Models\\Plan::where('slug','free')->value('monthly_credits');"
"@

Write-Host 'Vérification publique…'
$plans = Invoke-RestMethod -Uri 'https://annoncefutee.fr/api/v1/plans'
$health = Invoke-RestMethod -Uri 'https://annoncefutee.fr/api/v1/health'
$free = $plans.plans | Where-Object { $_.slug -eq 'free' } | Select-Object -First 1

Write-Host ("registration_open={0}" -f $plans.registration_open)
Write-Host ("free.monthly_credits={0} is_active={1}" -f $free.monthly_credits, $free.is_active)
Write-Host ("client_api={0}" -f $health.client_api)

if (-not $plans.registration_open) { throw 'registration_open attendu true' }
if (-not $health.client_api) { throw 'client_api attendu true' }
if ([int]$free.monthly_credits -ne 50) { throw 'monthly_credits attendu 50' }
if (-not $free.is_active) { throw 'offre free doit être active' }

Write-Host 'OK — offre Découverte active à 50 crédits/mois.'
