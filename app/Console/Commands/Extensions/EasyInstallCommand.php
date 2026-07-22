<?php

namespace Everest\Console\Commands\Extensions;

class EasyInstallCommand extends InstallExtensionCommand
{
    protected $signature = 'install
                            {source? : Extension id from a configured repository, or a local package file path}
                            {--path= : Explicit path to a local .M12LabsExtension file}
                            {--repository= : Repository slug or numeric id for repository installs}
                            {--release= : Specific repository version to install}
                            {--file : Prefer local package-file install mode}
                            {--label= : Stored source label for manual file installs}
                            {--yes : Skip interactive prompts when possible}
                            {--debug : Show detailed install diagnostics}';

    protected $description = 'Install an M12Labs extension from the current directory, a package file, or the configured repository.';
}
