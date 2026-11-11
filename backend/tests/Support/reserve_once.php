<?php

use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Credits\CreditLedger;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

if (getenv('VINTED_IA_CONCURRENCY') !== '1') {
    fwrite(STDERR, "Refusé.\n");
    exit(1);
}

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

config([
    'database.default' => 'mysql',
    'database.connections.mysql.host' => '127.0.0.1',
    'database.connections.mysql.port' => (string) getenv('VINTED_IA_MYSQL_PORT'),
    'database.connections.mysql.database' => (string) getenv('VINTED_IA_MYSQL_DATABASE'),
    'database.connections.mysql.username' => (string) getenv('VINTED_IA_MYSQL_USER'),
    'database.connections.mysql.password' => (string) getenv('VINTED_IA_MYSQL_PASSWORD'),
    'credits.monthly_credits' => 1,
    'credits.analysis_cost' => 1,
    'credits.max_inflight' => 8,
    'credits.reservation_hold_micros' => 1000,
    'credits.daily_user_cost_usd' => 100,
    'credits.daily_global_cost_usd' => 100,
]);
DB::purge('mysql');
DB::reconnect('mysql');

$user = User::query()->find((int) ($argv[1] ?? 0));
if ($user === null) {
    fwrite(STDOUT, "missing\n");
    exit(0);
}

try {
    app(CreditLedger::class)->reserve($user, 1);
    fwrite(STDOUT, "OK\n");
} catch (ApiException $e) {
    fwrite(STDOUT, $e->errorCode."\n");
} catch (Throwable $e) {
    fwrite(STDOUT, "error\n");
    fwrite(STDERR, $e::class."\n");
}
