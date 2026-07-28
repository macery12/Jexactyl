<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

class WriteFileContentRequest extends OverwriteCapableFileRequest
{
    /**
     * There is no rule here for the file contents since we just use the body content
     * on the request to set the file contents. If nothing is passed that is fine since
     * it just means we want to set the file to be empty.
     */
    public function rules(): array
    {
        return [
            'file' => 'required|string',
        ];
    }
}
