<?php

namespace Everest\Console\Commands\Extensions;

class EasyUninstallCommand extends UninstallExtensionCommand
{
    protected $signature = 'uninstall
                            {extensionId : Installed extension id to remove}
                            {--force : Skip the confirmation prompts}
                            {--drop-data : Also roll back the extension\'s migrations, DROPPING its database tables (unrecoverable)}
                            {--debug : Show detailed uninstall diagnostics}';

    protected $description = 'Uninstall an M12Labs extension package. Database tables are preserved unless --drop-data is given.';
}
