<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

use Everest\Models\Permission;
use Everest\Contracts\Http\ClientPermissionsRequest;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class RenameFileRequest extends ClientApiRequest implements ClientPermissionsRequest
{
    /**
     * The permission the user is required to have in order to perform this
     * request action.
     */
    public function permission(): string
    {
        return Permission::ACTION_FILE_UPDATE;
    }

    public function rules(): array
    {
        return [
            'root' => 'required|nullable|string',
            'files' => 'required|array',
            'files.*' => 'array',
            'files.*.to' => 'required|string',
            'files.*.from' => 'required|string',
        ];
    }

    /**
     * Normalize and validate rename targets to prevent path traversal.
     */
    public function withValidator($validator)
    {
        $validator->after(function ($validator) {
            $root = $this->input('root') ?? '/';

            try {
                $normalizedRoot = $this->normalizeRelativePath($root);
            } catch (\InvalidArgumentException $ex) {
                $validator->errors()->add('root', $ex->getMessage());

                return;
            }
            $sanitizedFiles = [];

            foreach ($this->input('files', []) as $file) {
                $from = $file['from'] ?? '';
                $to = $file['to'] ?? '';

                try {
                    $normalizedFrom = $this->validatePathWithinRoot($normalizedRoot, $from);
                    $normalizedTo = $this->validatePathWithinRoot($normalizedRoot, $to);

                    // Replace inputs with sanitized values to ensure downstream safety.
                    $sanitizedFiles[] = [
                        'from' => $normalizedFrom,
                        'to' => $normalizedTo,
                    ];
                } catch (\InvalidArgumentException $ex) {
                    $validator->errors()->add('files', $ex->getMessage());
                    break;
                }
            }

            if (!$validator->errors()->has('files')) {
                $this->merge([
                    'root' => $normalizedRoot,
                    'files' => $sanitizedFiles,
                ]);
            }
        });
    }

    private function normalizeRelativePath(string $path): string
    {
        $clean = str_replace('\\', '/', $path);
        $clean = str_replace("\0", '', $clean);
        $clean = ltrim($clean, '/');

        $collapsed = $this->collapseSegments($clean);

        return '/' . ltrim($collapsed, '/');
    }

    private function validatePathWithinRoot(string $root, string $path): string
    {
        $clean = str_replace('\\', '/', $path);

        if ($clean === '') {
            throw new \InvalidArgumentException('Invalid file name or path.');
        }

        if (preg_match('/^[a-zA-Z]:/', $clean)) {
            throw new \InvalidArgumentException('Drive letters are not allowed.');
        }

        if (str_starts_with($clean, '/')) {
            throw new \InvalidArgumentException('Absolute paths are not allowed.');
        }

        $rootPrefix = trim($root, '/');
        $combined = $rootPrefix !== '' ? $rootPrefix . '/' . $clean : $clean;
        $normalized = $this->collapseSegments($combined);

        if ($rootPrefix !== '' && !str_starts_with($normalized, $rootPrefix)) {
            throw new \InvalidArgumentException('Path traversal is not allowed.');
        }

        return $normalized;
    }

    private function collapseSegments(string $path): string
    {
        if (str_contains($path, '//')) {
            throw new \InvalidArgumentException('Name contains invalid characters.');
        }

        $segments = array_filter(explode('/', $path));
        $safeSegments = [];

        foreach ($segments as $segment) {
            if ($segment === '..') {
                throw new \InvalidArgumentException('Path traversal is not allowed.');
            }

            if (!preg_match('/^[A-Za-z0-9._ -]+$/', $segment)) {
                throw new \InvalidArgumentException('Name contains invalid characters.');
            }

            $safeSegments[] = $segment;
        }

        return implode('/', $safeSegments);
    }
}
