<?php

namespace Everest\Extensions;

use Hashids\Hashids as VendorHashids;
use Everest\Contracts\Extensions\HashidsInterface;

class Hashids extends VendorHashids implements HashidsInterface
{
    public function decodeFirst(string $encoded, ?string $default = null): mixed
    {
        $result = $this->decode($encoded);

        return $result[0] ?? $default;
    }
}
