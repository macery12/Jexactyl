<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Models\AiUsageLog;
use Illuminate\Support\Facades\DB;
use Everest\Services\AI\Support\AiBudgetService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AiBudgetServiceTest extends TestCase
{
    use RefreshDatabase;

    private AiBudgetService $budget;

    public function setUp(): void
    {
        parent::setUp();

        $this->budget = app(AiBudgetService::class);
        Setting::set('settings::modules:ai:budget:enforce', '1');
        Setting::set('settings::modules:ai:budget:monthly_tokens', '100');
    }

    public function testOverBudgetUserIsRejected(): void
    {
        $user = User::factory()->create();
        $this->usage($user, 100);

        $this->expectAdmissionFailure('used your AI allowance');
        $this->budget->reserve($user);
    }

    public function testConcurrentAdmissionAtBoundaryIsSerializedUntilActualUsageIsReconciled(): void
    {
        $user = User::factory()->create();
        $this->usage($user, 99);
        $first = $this->budget->reserve($user);

        try {
            $this->expectAdmissionFailure('already have an AI request running');
            $this->budget->reserve($user);
        } finally {
            AiUsageLog::query()->where('user_id', $user->id)->update(['total_tokens' => 100]);
            $first->release();
        }

        $this->expectAdmissionFailure('used your AI allowance');
        $this->budget->reserve($user);
    }

    public function testPreInferenceRollbackReleasesAdmissionForRetry(): void
    {
        $user = User::factory()->create();
        $reservation = $this->budget->reserve($user);

        // This is the controller's setup-failure path: no provider event was
        // charged, so the durable admission is rolled back immediately.
        $reservation->release();

        $retry = $this->budget->reserve($user);
        $this->assertFalse($retry->passthrough);
        $retry->release();
    }

    public function testConfiguredZeroMeansNoAllowanceWhenEnforcementIsEnabled(): void
    {
        Setting::set('settings::modules:ai:budget:monthly_tokens', '0');
        $user = User::factory()->create();

        $this->expectAdmissionFailure('used your AI allowance');
        $this->budget->reserve($user);
    }

    public function testExpiredLeaseCanBeReplacedAndLateOwnerCannotReleaseReplacement(): void
    {
        $user = User::factory()->create();
        $old = $this->budget->reserve($user);

        DB::table('ai_budget_reservations')
            ->where('user_id', $user->id)
            ->update(['expires_at' => now()->subSecond()]);

        $replacement = $this->budget->reserve($user);
        $token = DB::table('ai_budget_reservations')->where('user_id', $user->id)->value('token');

        $old->release();

        $this->assertSame($token, DB::table('ai_budget_reservations')->where('user_id', $user->id)->value('token'));
        $replacement->release();
        $this->assertDatabaseMissing('ai_budget_reservations', ['user_id' => $user->id]);
    }

    private function usage(User $user, int $tokens): void
    {
        AiUsageLog::create([
            'user_id' => $user->id,
            'turn_id' => fake()->uuid(),
            'model' => 'test',
            'source' => 'agent',
            'total_tokens' => $tokens,
            'status' => 'success',
        ]);
    }

    private function expectAdmissionFailure(string $message): void
    {
        $this->expectException(HttpException::class);
        $this->expectExceptionMessage($message);
    }
}
