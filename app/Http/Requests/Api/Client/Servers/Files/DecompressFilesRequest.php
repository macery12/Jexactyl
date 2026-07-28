<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

class DecompressFilesRequest extends OverwriteCapableFileRequest
{
    public function rules(): array
    {
        return [
            'root' => 'sometimes|nullable|string',
            'file' => 'required|string',
        ];
    }
}
