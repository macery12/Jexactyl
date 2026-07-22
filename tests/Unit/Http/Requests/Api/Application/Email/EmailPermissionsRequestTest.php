<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Email;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\Validator;
use Everest\Http\Requests\Api\Application\Email\SendTestEmailRequest;
use Everest\Http\Requests\Api\Application\Email\GetDeferredQueueRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailActivityRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailQuotaInfoRequest;
use Everest\Http\Requests\Api\Application\Email\GetUserEmailQuotaRequest;
use Everest\Http\Requests\Api\Application\Email\ViewEmailActivityRequest;
use Everest\Http\Requests\Api\Application\Email\ManageDeferredEmailRequest;
use Everest\Http\Requests\Api\Application\Email\TestEmailConnectionRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailTemplateKeysRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateUserEmailQuotaRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailNotificationSettingsRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateEmailNotificationSettingRequest;

class EmailPermissionsRequestTest extends TestCase
{
    public function testReadRequestsUseEmailReadPermission(): void
    {
        $requests = [
            new GetEmailActivityRequest(),
            new ViewEmailActivityRequest(),
            new GetEmailTemplateKeysRequest(),
            new GetDeferredQueueRequest(),
            new GetEmailNotificationSettingsRequest(),
            new GetEmailQuotaInfoRequest(),
            new GetUserEmailQuotaRequest(),
        ];

        foreach ($requests as $request) {
            $this->assertSame(AdminRole::EMAIL_READ, $request->permission());
        }
    }

    public function testUpdateRequestsUseEmailUpdatePermission(): void
    {
        $this->assertSame(AdminRole::EMAIL_UPDATE, (new UpdateEmailNotificationSettingRequest())->permission());
        $this->assertSame(AdminRole::EMAIL_UPDATE, (new UpdateUserEmailQuotaRequest())->permission());
    }

    public function testDeferredQueueActionsUseEmailSendPermission(): void
    {
        $this->assertSame(AdminRole::EMAIL_SEND, (new ManageDeferredEmailRequest())->permission());
        $this->assertSame(AdminRole::EMAIL_SEND, (new SendTestEmailRequest())->permission());
        $this->assertSame(AdminRole::EMAIL_SEND, (new TestEmailConnectionRequest())->permission());
    }

    public function testSendTestEmailRequestRequiresAValidRecipient(): void
    {
        $request = new SendTestEmailRequest();

        $this->assertFalse(Validator::make(['to' => 'not-an-email'], $request->rules())->passes());
        $this->assertTrue(Validator::make(['to' => 'admin@example.com'], $request->rules())->passes());
    }

    public function testEmailActivityRequestNormalizesBooleanQueryStrings(): void
    {
        $request = TestableGetEmailActivityRequest::createFromBase(
            Request::create('/api/application/email/logs', 'GET', ['only_failures' => 'false'])
        );
        $request->setContainer($this->app);

        $request->runPrepareForValidation();

        $this->assertFalse($request->input('only_failures'));
        $this->assertTrue(Validator::make($request->all(), $request->rules())->passes());
    }
}

class TestableGetEmailActivityRequest extends GetEmailActivityRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function runPrepareForValidation(): void
    {
        parent::prepareForValidation();
    }
}
