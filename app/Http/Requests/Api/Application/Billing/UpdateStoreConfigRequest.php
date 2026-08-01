<?php

namespace Everest\Http\Requests\Api\Application\Billing;

use Everest\Models\AdminRole;
use Everest\Services\Billing\StoreConfigService;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateStoreConfigRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        $ids = implode(',', StoreConfigService::SECTION_IDS);

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
            'sections.*.data.subheading' => 'nullable|string|max:600',
            'sections.*.data.backgroundImage' => 'nullable|url|max:500',
            'sections.*.data.promoText' => 'nullable|string|max:300',

            'sections.*.data.primaryCta' => 'nullable|array',
            'sections.*.data.primaryCta.label' => 'nullable|string|max:60',
            'sections.*.data.primaryCta.href' => ['nullable', 'string', 'max:300', $this->hrefRule()],

            // Repeated items (feature cards + trust tiles both key off `items`).
            'sections.*.data.items' => 'nullable|array|max:24',
            'sections.*.data.items.*.icon' => 'nullable|string|max:40',
            'sections.*.data.items.*.title' => 'nullable|string|max:160',
            'sections.*.data.items.*.body' => 'nullable|string|max:800',

            // Catalog spotlight ("most popular") plan overrides.
            'sections.*.data.featuredEnabled' => 'nullable|boolean',
            'sections.*.data.featuredBadge' => 'nullable|string|max:60',
            'sections.*.data.featuredCta' => 'nullable|string|max:60',
            'sections.*.data.featuredProductId' => 'nullable|integer|min:1',

            // Custom block (rendered as plain text on the frontend — never raw HTML).
            'sections.*.data.body' => 'nullable|string|max:5000',

            // Trust bar accepted-methods chips.
            'sections.*.data.methods' => 'nullable|array|max:12',
            'sections.*.data.methods.*' => 'nullable|string|max:40',
            'sections.*.data.acceptedLabel' => 'nullable|string|max:120',
        ];
    }

    /**
     * CTA links must be a same-origin relative path, an absolute http(s) URL, or
     * an in-page `#anchor` (the hero's default target is `#plans`) — this blocks
     * `javascript:` and other scheme-based injection in stored content.
     */
    private function hrefRule(): string
    {
        // NB: delimiter must not collide with any char in the pattern — the
        // pattern itself allows '#' inside the character class, so we delimit
        // with '~'.
        return 'regex:~^(/[\w\-./?=&%#]*|https?://.+|#[\w\-]*)$~i';
    }

    public function permission(): string
    {
        return AdminRole::BILLING_UPDATE;
    }
}
