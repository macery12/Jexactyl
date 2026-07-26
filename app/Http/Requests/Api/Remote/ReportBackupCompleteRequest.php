<?php

namespace Everest\Http\Requests\Api\Remote;

use Illuminate\Foundation\Http\FormRequest;
use Everest\Extensions\Backups\S3MultipartUploadLimits;

class ReportBackupCompleteRequest extends FormRequest
{
    public function rules(): array
    {
        $maximumParts = S3MultipartUploadLimits::maximumCompletionParts();
        $rules = [
            'successful' => 'required|boolean',
            'checksum' => 'nullable|string|required_if:successful,true',
            'checksum_type' => 'nullable|string|required_if:successful,true',
            'size' => [
                'exclude_unless:successful,true',
                'required',
                'integer',
                'min:1',
                'max:' . S3MultipartUploadLimits::maximumObjectSize(),
            ],
            'parts' => ['nullable', 'array', 'max:' . $maximumParts],
        ];

        // Laravel expands wildcard validation rules before evaluating the parent
        // array's max rule. Do not create attacker-sized rule sets for input that
        // is already guaranteed to fail the bounded parent rule.
        $parts = $this->input('parts');
        if (is_array($parts) && count($parts) <= $maximumParts) {
            $rules['parts.*.etag'] = ['required', 'string', 'max:1024'];
            $rules['parts.*.part_number'] = [
                'required',
                'integer',
                'between:1,' . S3MultipartUploadLimits::MAX_MULTIPART_PARTS,
                'distinct',
            ];
        }

        return $rules;
    }
}
