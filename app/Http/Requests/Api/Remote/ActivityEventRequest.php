<?php

namespace Everest\Http\Requests\Api\Remote;

use Illuminate\Support\Collection;
use Illuminate\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class ActivityEventRequest extends FormRequest
{
    public const MAX_REQUEST_BYTES = 1024 * 1024;

    public const MAX_EVENTS = 250;

    public const MAX_METADATA_BYTES = 32 * 1024;

    public const MAX_METADATA_DEPTH = 8;

    public const MAX_METADATA_ITEMS = 256;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'data' => ['required', 'array', 'min:1', 'max:' . self::MAX_EVENTS],
            'data.*' => ['array'],
            'data.*.user' => ['sometimes', 'nullable', 'uuid'],
            'data.*.server' => ['required', 'uuid'],
            'data.*.event' => ['required', 'string', 'max:191'],
            'data.*.metadata' => ['present', 'nullable', 'array', 'max:64'],
            'data.*.ip' => ['sometimes', 'nullable', 'ip'],
            'data.*.timestamp' => ['required', 'string', 'max:64'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach ((array) $this->input('data', []) as $index => $datum) {
                $metadata = is_array($datum) ? ($datum['metadata'] ?? null) : null;
                if ($metadata === null || !is_array($metadata)) {
                    continue;
                }

                $encoded = json_encode($metadata);
                if ($encoded === false || strlen($encoded) > self::MAX_METADATA_BYTES) {
                    $validator->errors()->add(
                        "data.{$index}.metadata",
                        sprintf('The metadata may not exceed %d bytes.', self::MAX_METADATA_BYTES)
                    );

                    continue;
                }

                $items = 0;
                if (!$this->metadataWithinStructuralLimits($metadata, 1, $items)) {
                    $validator->errors()->add(
                        "data.{$index}.metadata",
                        sprintf(
                            'The metadata may not exceed %d levels or %d nested items.',
                            self::MAX_METADATA_DEPTH,
                            self::MAX_METADATA_ITEMS
                        )
                    );
                }
            }
        });
    }

    /**
     * Returns all the unique server UUIDs that were received in this request.
     */
    public function servers(): array
    {
        return Collection::make($this->input('data'))->pluck('server')->unique()->toArray();
    }

    private function metadataWithinStructuralLimits(array $metadata, int $depth, int &$items): bool
    {
        if ($depth > self::MAX_METADATA_DEPTH) {
            return false;
        }

        foreach ($metadata as $value) {
            ++$items;
            if ($items > self::MAX_METADATA_ITEMS) {
                return false;
            }

            if (is_array($value) && !$this->metadataWithinStructuralLimits($value, $depth + 1, $items)) {
                return false;
            }
        }

        return true;
    }
}
