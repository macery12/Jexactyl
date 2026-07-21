<?php

namespace Everest\Http\Requests\Api\Application\Landing;

use Everest\Models\AdminRole;
use Everest\Services\Landing\LandingConfigService;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateLandingConfigRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        $ids = implode(',', LandingConfigService::SECTION_IDS);

        return [
            'enabled' => 'required|boolean',
            'sections' => 'required|array|max:24',
            'sections.*.id' => "required|string|in:{$ids}",
            'sections.*.enabled' => 'required|boolean',
            'sections.*.order' => 'required|integer|min:0|max:100',
            'sections.*.data' => 'required|array',

            // Shared / hero text fields.
            'sections.*.data.badge' => 'nullable|string|max:120',
            'sections.*.data.title' => 'nullable|string|max:200',
            'sections.*.data.subtitle' => 'nullable|string|max:600',
            'sections.*.data.heading' => 'nullable|string|max:200',
            'sections.*.data.backgroundImage' => 'nullable|url|max:500',

            'sections.*.data.primaryCta' => 'nullable|array',
            'sections.*.data.primaryCta.label' => 'nullable|string|max:60',
            'sections.*.data.primaryCta.href' => ['nullable', 'string', 'max:300', $this->hrefRule()],
            'sections.*.data.secondaryCta' => 'nullable|array',
            'sections.*.data.secondaryCta.label' => 'nullable|string|max:60',
            'sections.*.data.secondaryCta.href' => ['nullable', 'string', 'max:300', $this->hrefRule()],

            // Repeated items (features / faq / testimonials all key off `items`).
            'sections.*.data.items' => 'nullable|array|max:24',
            'sections.*.data.items.*.icon' => 'nullable|string|max:40',
            'sections.*.data.items.*.title' => 'nullable|string|max:160',
            'sections.*.data.items.*.body' => 'nullable|string|max:800',
            'sections.*.data.items.*.q' => 'nullable|string|max:200',
            'sections.*.data.items.*.a' => 'nullable|string|max:1200',
            'sections.*.data.items.*.quote' => 'nullable|string|max:600',
            'sections.*.data.items.*.author' => 'nullable|string|max:120',
            'sections.*.data.items.*.role' => 'nullable|string|max:120',

            // Pricing section.
            'sections.*.data.categoryIds' => 'nullable|array|max:100',
            'sections.*.data.categoryIds.*' => 'integer',

            // Custom block (rendered as plain text on the frontend — never raw HTML).
            'sections.*.data.body' => 'nullable|string|max:5000',
        ];
    }

    /**
     * CTA links must be a same-origin relative path or an absolute http(s) URL —
     * this blocks `javascript:` and other scheme-based injection in stored content.
     */
    private function hrefRule(): string
    {
        // NB: delimiter must not collide with any char in the pattern — the
        // pattern itself allows '#' (URL fragments) inside the character class,
        // so we delimit with '~'.
        return 'regex:~^(/[\w\-./?=&%#]*|https?://.+)$~i';
    }

    public function permission(): string
    {
        return AdminRole::SETTINGS_UPDATE;
    }
}
