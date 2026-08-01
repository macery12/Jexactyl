<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

use Illuminate\Validation\Validator;
use Illuminate\Validation\ValidationException;

class WriteFileWithDiffRequest extends OverwriteCapableFileRequest
{
    /**
     * The JSON body contains both the previous and replacement contents, so keep
     * a separate cap on the raw request in addition to the decoded field caps.
     */
    public const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

    /**
     * Match the Panel's default editor ceiling while preventing callers from
     * submitting unbounded strings directly to this endpoint.
     */
    public const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

    /**
     * Bound line-oriented work before the diff service ever splits the strings.
     */
    public const MAX_CONTENT_LINES = 20000;

    public const MAX_FILE_PATH_LENGTH = 4096;

    /**
     * Authorize the server action before inspecting an attacker-controlled body,
     * then enforce a hard cap on the raw JSON representation.
     *
     * @throws ValidationException
     */
    protected function prepareForValidation(): void
    {
        parent::prepareForValidation();

        if (strlen($this->getContent()) > self::MAX_REQUEST_BYTES) {
            throw ValidationException::withMessages(['content' => sprintf('The request body may not exceed %d bytes.', self::MAX_REQUEST_BYTES)]);
        }
    }

    /**
     * Validation rules for writing a file with diff tracking.
     */
    public function rules(): array
    {
        return [
            'file' => ['bail', 'required', 'string', 'max:' . self::MAX_FILE_PATH_LENGTH],
            'content' => ['bail', 'present', 'string'],
            'original_content' => ['nullable', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $data = $validator->getData();

            foreach (['content', 'original_content'] as $attribute) {
                $value = $data[$attribute] ?? null;
                if (!is_string($value)) {
                    continue;
                }

                if (strlen($value) > self::MAX_CONTENT_BYTES) {
                    $validator->errors()->add(
                        $attribute,
                        sprintf('The %s field may not exceed %d bytes.', $attribute, self::MAX_CONTENT_BYTES)
                    );

                    continue;
                }

                $lines = $value === '' ? 0 : substr_count($value, "\n") + 1;
                if ($lines > self::MAX_CONTENT_LINES) {
                    $validator->errors()->add(
                        $attribute,
                        sprintf('The %s field may not exceed %d lines.', $attribute, self::MAX_CONTENT_LINES)
                    );
                }
            }
        });
    }
}
