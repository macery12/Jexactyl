<?php

namespace Everest\Services\AI\Support;

/**
 * Validates and coerces model-produced tool arguments against a tool's JSON
 * Schema. A focused subset rather than a general engine — the panel authors
 * every schema it publishes.
 *
 * Beyond validation it adds **coercion**: small local models routinely emit
 * `"5"` for an integer or a bare string where an array of one was wanted. Those
 * are formatting slips, not intent errors, so correcting them silently avoids a
 * repair round on something the model already got right.
 *
 * Error messages are fed straight back to the model, naming the field and what
 * was expected.
 */
class SchemaValidator
{
    /**
     * @return array{valid: bool, errors: array<int, string>, value: array}
     */
    public function validate(array $arguments, array $schema): array
    {
        $errors = [];
        $value = $this->validateObject($arguments, $schema, '', $errors);

        return [
            'valid' => $errors === [],
            'errors' => $errors,
            'value' => is_array($value) ? $value : $arguments,
        ];
    }

    protected function validateObject(mixed $data, array $schema, string $path, array &$errors): mixed
    {
        if (!is_array($data)) {
            $errors[] = $this->label($path) . ' must be an object.';

            return $data;
        }

        $properties = is_array($schema['properties'] ?? null) ? $schema['properties'] : [];
        $required = is_array($schema['required'] ?? null) ? $schema['required'] : [];

        foreach ($required as $field) {
            if (!array_key_exists($field, $data) || $data[$field] === null) {
                $errors[] = sprintf('Missing required argument "%s".', $this->join($path, (string) $field));
            }
        }

        // Unknown arguments are dropped rather than rejected. A model that
        // invents an extra field has still expressed a usable call, and the
        // executor validates the real request separately.
        if (($schema['additionalProperties'] ?? null) === false) {
            foreach (array_keys($data) as $key) {
                if (!array_key_exists($key, $properties)) {
                    unset($data[$key]);
                }
            }
        }

        foreach ($properties as $field => $fieldSchema) {
            if (!array_key_exists($field, $data) || !is_array($fieldSchema)) {
                continue;
            }

            $data[$field] = $this->validateValue($data[$field], $fieldSchema, $this->join($path, (string) $field), $errors);
        }

        return $data;
    }

    protected function validateValue(mixed $value, array $schema, string $path, array &$errors): mixed
    {
        $types = (array) ($schema['type'] ?? []);

        if ($value === null) {
            if ($types !== [] && !in_array('null', $types, true)) {
                $errors[] = $this->label($path) . ' may not be null.';
            }

            return null;
        }

        if (isset($schema['enum']) && is_array($schema['enum'])) {
            if (!in_array($value, $schema['enum'], true)) {
                // Case-insensitive rescue: models often echo an enum member
                // with different casing than the schema declares.
                $match = $this->matchEnumLoosely($value, $schema['enum']);
                if ($match !== null) {
                    return $match;
                }

                $errors[] = sprintf(
                    '%s must be one of: %s.',
                    $this->label($path),
                    implode(', ', array_map(fn ($v) => is_scalar($v) ? (string) $v : json_encode($v), $schema['enum']))
                );

                return $value;
            }

            return $value;
        }

        $type = $types[0] ?? null;

        return match ($type) {
            'object' => $this->validateObject($value, $schema, $path, $errors),
            'array' => $this->validateArray($value, $schema, $path, $errors),
            'string' => $this->validateString($value, $schema, $path, $errors),
            'integer' => $this->validateNumber($value, $schema, $path, $errors, true),
            'number' => $this->validateNumber($value, $schema, $path, $errors, false),
            'boolean' => $this->validateBoolean($value, $path, $errors),
            default => $value,
        };
    }

    protected function validateArray(mixed $value, array $schema, string $path, array &$errors): mixed
    {
        // A single item where a list was expected is a very common local-model
        // slip; wrap it rather than failing the call.
        if (!is_array($value)) {
            $value = [$value];
        } elseif ($value !== [] && array_keys($value) !== range(0, count($value) - 1)) {
            $errors[] = $this->label($path) . ' must be an array.';

            return $value;
        }

        $itemSchema = is_array($schema['items'] ?? null) ? $schema['items'] : null;
        if ($itemSchema !== null) {
            foreach ($value as $index => $item) {
                $value[$index] = $this->validateValue($item, $itemSchema, $path . '[' . $index . ']', $errors);
            }
        }

        return array_values($value);
    }

    protected function validateString(mixed $value, array $schema, string $path, array &$errors): mixed
    {
        if (is_bool($value) || is_array($value)) {
            $errors[] = $this->label($path) . ' must be a string.';

            return $value;
        }

        $value = (string) $value;

        if (isset($schema['maxLength']) && mb_strlen($value) > (int) $schema['maxLength']) {
            $errors[] = sprintf('%s may not be longer than %d characters.', $this->label($path), (int) $schema['maxLength']);
        }

        if (isset($schema['minLength']) && mb_strlen($value) < (int) $schema['minLength']) {
            $errors[] = sprintf('%s must be at least %d characters.', $this->label($path), (int) $schema['minLength']);
        }

        if (isset($schema['pattern']) && is_string($schema['pattern'])) {
            $delimited = '~' . str_replace('~', '\~', $schema['pattern']) . '~';
            if (@preg_match($delimited, $value) === 0) {
                $errors[] = sprintf('%s is not in the expected format.', $this->label($path));
            }
        }

        return $value;
    }

    protected function validateNumber(mixed $value, array $schema, string $path, array &$errors, bool $integer): mixed
    {
        if (is_string($value) && is_numeric(trim($value))) {
            $value = trim($value);
        }

        if (!is_numeric($value)) {
            $errors[] = $this->label($path) . ' must be a ' . ($integer ? 'whole number' : 'number') . '.';

            return $value;
        }

        if ($integer) {
            if ((float) $value != (int) $value) {
                $errors[] = $this->label($path) . ' must be a whole number.';

                return $value;
            }
            $value = (int) $value;
        } else {
            $value = (float) $value;
        }

        if (isset($schema['minimum']) && $value < $schema['minimum']) {
            $errors[] = sprintf('%s must be at least %s.', $this->label($path), $schema['minimum']);
        }

        if (isset($schema['maximum']) && $value > $schema['maximum']) {
            $errors[] = sprintf('%s may not be greater than %s.', $this->label($path), $schema['maximum']);
        }

        return $value;
    }

    protected function validateBoolean(mixed $value, string $path, array &$errors): mixed
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_string($value)) {
            $lowered = strtolower(trim($value));
            if (in_array($lowered, ['true', 'yes', '1'], true)) {
                return true;
            }
            if (in_array($lowered, ['false', 'no', '0'], true)) {
                return false;
            }
        }

        if (is_int($value) && ($value === 0 || $value === 1)) {
            return $value === 1;
        }

        $errors[] = $this->label($path) . ' must be true or false.';

        return $value;
    }

    protected function matchEnumLoosely(mixed $value, array $enum): mixed
    {
        if (!is_scalar($value)) {
            return null;
        }

        foreach ($enum as $candidate) {
            if (is_scalar($candidate) && strcasecmp(trim((string) $value), (string) $candidate) === 0) {
                return $candidate;
            }
        }

        return null;
    }

    protected function join(string $path, string $field): string
    {
        return $path === '' ? $field : $path . '.' . $field;
    }

    protected function label(string $path): string
    {
        return $path === '' ? 'The arguments object' : sprintf('The "%s" argument', $path);
    }
}
