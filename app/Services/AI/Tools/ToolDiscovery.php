<?php

namespace Everest\Services\AI\Tools;

/**
 * How one tool is *found*, as opposed to how it is run.
 *
 * Kept beside the `ToolDefinition` it describes rather than in a second registry
 * of its own. A parallel catalogue is the obvious way to build this and the wrong
 * one: the two drift, and the half that drifts is the half nobody executes, so
 * the failure shows up as a tool that cannot be searched for rather than as
 * anything that breaks a test.
 *
 * None of this reaches the model as a schema. `ToolDefinition::toAiTool()` is
 * still the only thing that crosses into a prompt; what lives here is what
 * `ToolCatalogue` searches, and a match only produces a full schema once the tool
 * has entered the working set.
 */
class ToolDiscovery
{
    /**
     * @param string $category the domain this tool belongs to — `files`, `billing`,
     *                         `startup`. Replaces the old `group`, and deliberately
     *                         does not gate anything: it organises the operator's
     *                         catalogue and contributes a retrieval token, and that
     *                         is all it does.
     * @param string[] $aliases the words a person would actually use. This is the
     *                          single highest-leverage field in the whole design:
     *                          without embeddings, "startup command" only reaches
     *                          `startup_list` because somebody wrote it down here.
     * @param string[] $tags coarse facets — `read`, `configuration`, `server`. Weaker
     *                       than an alias on purpose; they broaden a query rather
     *                       than answering it.
     * @param string[] $prerequisites {@see Prerequisite} constants, for the cases the
     *                                derived cross-surface rule cannot know about.
     *                                Almost always empty — see `PrerequisiteResolver`.
     * @param string|null $summary one line for search results. Defaults to the first
     *                             sentence of the tool's own description, which is
     *                             usually right and always in sync.
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
