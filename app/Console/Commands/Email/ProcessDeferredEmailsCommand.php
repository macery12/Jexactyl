<?php

namespace Everest\Console\Commands\Email;

use Illuminate\Console\Command;
use Everest\Jobs\Email\ProcessDeferredEmailsJob;

class ProcessDeferredEmailsCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'email:process-deferred';

    /**
     * The console command description.
     */
    protected $description = 'Process deferred emails that are ready to be sent';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('Processing deferred emails...');

        ProcessDeferredEmailsJob::dispatch();

        $this->info('Deferred emails processing job dispatched.');

        return 0;
    }
}
