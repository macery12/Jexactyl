<?php

namespace Everest\Exceptions\Service\Mods;

/**
 * A modpack install failure that knows whether it is worth trying again.
 *
 * InstallModpackJob used to catch every exception and mark the row FAILED,
 * which meant its `tries` was unreachable and its resume machinery — the phase
 * marker and batch offset on the download_queue row — was only ever exercised
 * by a manual retry from the UI. Classifying the failure lets a transient node
 * or CurseForge hiccup resume from the last completed batch instead.
 */
class ModpackInstallException extends ModsServiceException
{
    private function __construct(string $message, private readonly bool $retryable)
    {
        parent::__construct($message);
    }

    /**
     * Transient: a node, network, or provider problem that a later attempt may
     * well get past. The row keeps its phase so the retry resumes.
     */
    public static function retryable(string $message): self
    {
        return new self($message, true);
    }

    /**
     * Permanent: the request itself cannot succeed — a malformed manifest, an
     * archive we cannot read, or a file the author has blocked from download.
     * Retrying only burns attempts and delays the user's error message.
     */
    public static function terminal(string $message): self
    {
        return new self($message, false);
    }

    public function isRetryable(): bool
    {
        return $this->retryable;
    }
}
