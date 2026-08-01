<?php

namespace Everest\Console\Commands\User;

use Everest\Models\AdminRole;
use Illuminate\Console\Command;
use Everest\Services\Users\UserCreationService;

class MakeUserCommand extends Command
{
    protected $description = 'Creates a user on the system via the CLI.';

    protected $signature = 'p:user:make
                            {--email=}
                            {--username=}
                            {--name-first=}
                            {--name-last=}
                            {--password=}
                            {--admin= : Make this user a Root Admin with full access (true/false)}
                            {--no-password}';

    /**
     * MakeUserCommand constructor.
     */
    public function __construct(private UserCreationService $creationService)
    {
        parent::__construct();
    }

    /**
     * Handle command request to create a new user.
     *
     * @throws \Exception
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    public function handle(): int
    {
        $owner = $this->ownerRequested();
        if ($owner === null) {
            $this->components->error(trans('command/messages.user.invalid_admin'));

            return self::FAILURE;
        }
        $ownerProfile = $owner
            ? AdminRole::query()->where('is_owner', true)->first()
            : null;
        if ($owner && !$ownerProfile) {
            $this->components->error(trans('command/messages.user.owner_missing'));

            return self::FAILURE;
        }

        $email = $this->option('email') ?? $this->ask(trans('command/messages.user.ask_email'));
        $username = $this->option('username') ?? $this->ask(trans('command/messages.user.ask_username'));

        if (is_null($password = $this->option('password')) && !$this->option('no-password')) {
            $this->warn(trans('command/messages.user.ask_password_help'));
            $this->line(trans('command/messages.user.ask_password_tip'));
            $password = $this->secret(trans('command/messages.user.ask_password'));
        }

        $data = compact('email', 'username', 'password');
        if ($ownerProfile) {
            $data['admin_role_id'] = $ownerProfile->id;
            $data['root_admin'] = true;
        }

        $user = $this->creationService->handle($data);
        $this->table(['Field', 'Value'], [
            ['UUID', $user->uuid],
            ['Email', $user->email],
            ['Username', $user->username],
            ['Root Admin', $user->isOwner() ? 'Yes' : 'No'],
        ]);

        return self::SUCCESS;
    }

    /**
     * Resolve the optional non-interactive Owner flag without relying on
     * PHP's unsafe non-empty-string-to-true cast.
     */
    private function ownerRequested(): ?bool
    {
        $value = $this->option('admin');
        if ($value === null) {
            return $this->confirm(trans('command/messages.user.ask_admin'));
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    }
}
