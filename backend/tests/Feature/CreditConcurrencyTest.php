<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\User;
use App\Models\UsageEvent;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

class CreditConcurrencyTest extends TestCase
{
    public function test_eight_parallel_reserves_charge_a_single_credit_on_mysql(): void
    {
        $port = getenv('VINTED_IA_MYSQL_PORT');
        if ($port === false || $port === '') {
            $this->markTestSkipped('VINTED_IA_MYSQL_PORT absent.');
        }

        $database = getenv('VINTED_IA_MYSQL_DATABASE') ?: 'vinted_ia_p2';
        $username = getenv('VINTED_IA_MYSQL_USER') ?: 'root';
        $password = getenv('VINTED_IA_MYSQL_PASSWORD');
        $password = $password === false ? '' : $password;

        try {
            new PDO('mysql:host=127.0.0.1;port='.$port.';dbname='.$database, $username, $password, [
                PDO::ATTR_TIMEOUT => 3,
            ]);
        } catch (\PDOException) {
            $this->markTestSkipped('MySQL inaccessible.');
        }

        config([
            'database.connections.mysql.host' => '127.0.0.1',
            'database.connections.mysql.port' => $port,
            'database.connections.mysql.database' => $database,
            'database.connections.mysql.username' => $username,
            'database.connections.mysql.password' => $password,
        ]);
        DB::purge('mysql');

        $previous = config('database.default');
        config(['database.default' => 'mysql']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        try {
            Artisan::call('migrate:fresh', ['--force' => true, '--database' => 'mysql']);
            $user = User::factory()->create(['plan_id' => Plan::free()->id]);

            $indexes = collect(DB::select('SHOW INDEX FROM usage_events'))->pluck('Column_name')->all();
            $this->assertContains('user_id', $indexes);
            $this->assertContains('created_at', $indexes);
            $this->assertContains('status', $indexes);

            putenv('VINTED_IA_CONCURRENCY=1');
            putenv('VINTED_IA_MYSQL_PORT='.$port);
            putenv('VINTED_IA_MYSQL_DATABASE='.$database);
            putenv('VINTED_IA_MYSQL_USER='.$username);
            putenv('VINTED_IA_MYSQL_PASSWORD='.$password);

            $handles = [];
            for ($i = 0; $i < 8; $i++) {
                $pipes = [];
                $process = proc_open(
                    [PHP_BINARY, base_path('tests/Support/reserve_once.php'), (string) $user->id],
                    [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                    $pipes,
                    base_path()
                );
                $this->assertIsResource($process);
                $handles[] = [$process, $pipes[1], $pipes[2]];
            }

            $codes = [];
            foreach ($handles as [$process, $output, $error]) {
                $codes[] = trim((string) stream_get_contents($output));
                $err = trim((string) stream_get_contents($error));
                fclose($output);
                fclose($error);
                proc_close($process);
                if ($err !== '') {
                    $codes[] = 'stderr:'.$err;
                }
            }

            $this->assertCount(1, array_filter($codes, fn (string $code) => $code === 'OK'), implode(',', $codes));
            $this->assertSame(1, UsageEvent::query()->where('status', 'reserved')->count());
            $this->assertSame(1, (int) UsageEvent::query()->sum('credits_charged'));
        } finally {
            config(['database.default' => $previous]);
            DB::purge('mysql');
            DB::setDefaultConnection($previous);
        }
    }
}
