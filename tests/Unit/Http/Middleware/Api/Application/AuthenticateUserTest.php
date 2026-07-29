<?php

namespace Everest\Tests\Unit\Http\Middleware\Api\Application;

use Everest\Models\AdminRole;
use Laravel\Sanctum\TransientToken;
use Everest\Tests\Unit\Http\Middleware\MiddlewareTestCase;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;
use Everest\Http\Middleware\Api\Application\AuthenticateApplicationUser;

class AuthenticateUserTest extends MiddlewareTestCase
{
    /**
     * Test that no user defined results in an access denied exception.
     */
    public function testNoUserDefined()
    {
        $this->expectException(AccessDeniedHttpException::class);

        $this->setRequestUserModel(null);

        $this->getMiddleware()->handle($this->request, $this->getClosureAssertions());
    }

    /**
     * Test that a non-admin user results in an exception.
     */
    public function testNonAdminUser()
    {
        $this->expectException(AccessDeniedHttpException::class);

        $this->generateRequestUserModel(['root_admin' => false])
            ->withAccessToken(new TransientToken());

        $this->getMiddleware()->handle($this->request, $this->getClosureAssertions());
    }

    /**
     * Test that an admin user continues though the middleware.
     */
    public function testAdminUser()
    {
        $user = $this->generateRequestUserModel(['root_admin' => true, 'admin_role_id' => 1]);
        $user->setRelation('adminRole', $this->profile());
        $user->withAccessToken(new TransientToken());

        $this->getMiddleware()->handle($this->request, $this->getClosureAssertions());
    }

    public function testSuspendedAdminIsRejected(): void
    {
        $this->expectException(AccessDeniedHttpException::class);

        $user = $this->generateRequestUserModel([
            'root_admin' => true,
            'admin_role_id' => 1,
            'state' => 'suspended',
        ]);
        $user->setRelation('adminRole', $this->profile());
        $user->withAccessToken(new TransientToken());

        $this->getMiddleware()->handle($this->request, $this->getClosureAssertions());
    }

    public function testPendingDelegatedAdminIsRejected(): void
    {
        $this->expectException(AccessDeniedHttpException::class);

        $this->generateRequestUserModel([
            'root_admin' => false,
            'admin_role_id' => 123,
            'state' => 'pending',
        ])->withAccessToken(new TransientToken());

        $this->getMiddleware()->handle($this->request, $this->getClosureAssertions());
    }

    /**
     * Return an instance of the middleware for testing.
     */
    private function getMiddleware(): AuthenticateApplicationUser
    {
        return new AuthenticateApplicationUser(
            new ApplicationApiAccessProfileService(new AdminCapabilityRegistry())
        );
    }

    private function profile(): AdminRole
    {
        $profile = new AdminRole();
        $profile->forceFill([
            'id' => 1,
            'permissions' => [],
            'is_owner' => true,
            'api_eligible' => false,
        ]);

        return $profile;
    }
}
