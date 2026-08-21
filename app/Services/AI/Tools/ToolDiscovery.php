<?php

namespace Everest\Services\AI\Tools;

/**
 * How one tool is *found*, as opposed to how it is run. Kept beside the
 * `ToolDefinition` it describes rather than in a parallel registry, which is the
 * obvious way to build this and the wrong one: the two drift, and the half that
 * drifts is the half nobody executes — so it surfaces as a tool that cannot be
 * searched for rather than as a failing test.
 *
 * None of this reaches the model as a schema. `ToolDefinition::toAiTool()` is
 * still the only thing that crosses into a prompt; this is what `ToolCatalogue`
 * searches, and a match yields a full schema only once the tool is in the
 * working set.
 */
class ToolDiscovery
{
    /**
     * @param string $category the domain this tool belongs to — `files`, `billing`,
     *                         `startup`. Gates nothing: it organises the operator's
     *                         catalogue and contributes a retrieval token.
     * @param string[] $aliases the words a person would actually use, and the
     *                          highest-leverage field here — without embeddings,
     *                          "startup command" reaches `startup_list` only
     *                          because somebody wrote it down.
     * @param string[] $tags coarse facets — `read`, `configuration`, `server`.
     *                       Weaker than an alias: they broaden a query rather
     *                       than answering it.
     * @param string[] $prerequisites {@see Prerequisite} constants, for what the
     *                                derived cross-surface rule cannot know.
     *                                Almost always empty.
     * @param string|null $summary one line for search results, defaulting to the
     *                             first sentence of the tool's description.
     */
    public function __construct(
        public readonly string $category,
        public readonly array $aliases = [],
        public readonly array $tags = [],
        public readonly array $prerequisites = [],
        public readonly ?string $summary = null,
    ) {
    }

    /**
     * The one-line summary a search result carries.
     *
     * Falls back to the first sentence of the executable description so a tool
     * that never got an explicit summary is still findable and still legible.
     * Truncated because a search result is a list: eight of these go to the model
     * at once, and a paragraph each would cost more context than the schemas the
     * whole mechanism exists to avoid sending.
     */
    public function summary(string $description): string
    {
        if ($this->summary !== null) {
            return $this->summary;
        }

        $sentence = preg_split('/(?<=[.!?])\s+/', trim($description), 2)[0] ?? $description;

        return mb_strlen($sentence) > 160 ? mb_substr($sentence, 0, 157) . '...' : $sentence;
    }
}
