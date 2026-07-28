<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

class PullFileRequest extends OverwriteCapableFileRequest
{
    public function rules(): array
    {
        return [
            'url' => 'required|string|url',
            'directory' => 'nullable|string',
            'filename' => 'nullable|string',
            'use_header' => 'boolean',
            'foreground' => 'boolean',
        ];
    }
}
