<?php

namespace Everest\Extensions\Laravel\Sanctum;

use Everest\Models\ApiKey;
use Illuminate\Contracts\Support\Jsonable;
use Illuminate\Contracts\Support\Arrayable;

class NewAccessToken implements Arrayable, Jsonable
{
    public function __construct(public ApiKey $accessToken, public string $plainTextToken)
    {
    }

    public function toArray(): array
    {
        return [
            'accessToken' => $this->accessToken,
            'plainTextToken' => $this->plainTextToken,
        ];
    }

    public function toJson($options = 0): string
    {
        return json_encode($this->toArray(), $options);
    }
}
