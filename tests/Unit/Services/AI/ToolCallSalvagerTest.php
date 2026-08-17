<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Support\ToolCallSalvager;

/**
 * The salvager recovers tool calls a model wrote as prose. Every case here is
 * output shape observed from a real local model chat template.
 */
class ToolCallSalvagerTest extends TestCase
{
    private ToolCallSalvager $salvager;

    /** @var AiTool[] */
    private array $tools;

    public function setUp(): void
    {
        parent::setUp();

        $this->salvager = new ToolCallSalvager();
        $this->tools = [
            new AiTool('files_read', 'Read a file', ['type' => 'object', 'properties' => ['path' => ['type' => 'string']]]),
            new AiTool('server_power', 'Power action', ['type' => 'object', 'properties' => ['signal' => ['type' => 'string']]]),
        ];
    }

    public function testRecoversQwenStyleToolCallTags(): void
    {
        $text = 'Let me check that file.
<tool_call>
{"name": "files_read", "arguments": {"path": "/config/iceandfire.toml"}}
</tool_call>';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame('files_read', $calls[0]->name);
        $this->assertSame(['path' => '/config/iceandfire.toml'], $calls[0]->arguments);
    }

    public function testRecoversFencedJsonBlocks(): void
    {
        $text = "I'll read it:\n```json\n{\"name\": \"files_read\", \"arguments\": {\"path\": \"/eula.txt\"}}\n```";

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame('/eula.txt', $calls[0]->arguments['path']);
    }

    public function testRecoversMistralToolCallsArray(): void
    {
        $text = '[TOOL_CALLS] [{"name": "server_power", "arguments": {"signal": "restart"}}]';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame('server_power', $calls[0]->name);
        $this->assertSame(['signal' => 'restart'], $calls[0]->arguments);
    }

    public function testRecoversOpenAiFunctionEnvelopeWithStringArguments(): void
    {
        $text = '{"function": {"name": "files_read", "arguments": "{\"path\": \"/a.txt\"}"}}';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame(['path' => '/a.txt'], $calls[0]->arguments);
    }

    public function testAcceptsAlternateArgumentKeys(): void
    {
        $text = '<tool_call>{"name": "files_read", "parameters": {"path": "/b.txt"}}</tool_call>';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertSame(['path' => '/b.txt'], $calls[0]->arguments);
    }

    public function testRecoversMultipleCallsAndDeduplicates(): void
    {
        $text = '<tool_call>{"name":"files_read","arguments":{"path":"/a"}}</tool_call>
<tool_call>{"name":"files_read","arguments":{"path":"/b"}}</tool_call>
<tool_call>{"name":"files_read","arguments":{"path":"/a"}}</tool_call>';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(2, $calls);
        $this->assertSame('/a', $calls[0]->arguments['path']);
        $this->assertSame('/b', $calls[1]->arguments['path']);
    }

    public function testRecoveredCallIdsDoNotRepeatAcrossResponses(): void
    {
        $text = '<tool_call>{"name":"files_read","arguments":{"path":"/a"}}</tool_call>';

        $first = $this->salvager->salvage($text, $this->tools)[0];
        $second = $this->salvager->salvage($text, $this->tools)[0];

        $this->assertMatchesRegularExpression('/^salvaged_[a-f0-9]{24}_0$/', $first->id);
        $this->assertNotSame($first->id, $second->id);
    }

    public function testRejectsToolNamesThatWereNotOffered(): void
    {
        // This is the security-relevant case: prose must never be able to
        // conjure a capability the turn did not expose.
        $text = '<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>';

        $this->assertSame([], $this->salvager->salvage($text, $this->tools));
    }

    public function testIgnoresJsonThatIsNotAToolCall(): void
    {
        $text = 'Here is the config: {"motd": "A Minecraft Server", "max-players": 20}';

        $this->assertSame([], $this->salvager->salvage($text, $this->tools));
    }

    public function testHandlesBracesInsideStringValues(): void
    {
        $text = '<tool_call>{"name":"files_read","arguments":{"path":"/a{b}c.txt"}}</tool_call>';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame('/a{b}c.txt', $calls[0]->arguments['path']);
    }

    public function testMatchesToolNameCaseInsensitivelyButReturnsCanonicalName(): void
    {
        $text = '<tool_call>{"name": "Files_Read", "arguments": {"path": "/a"}}</tool_call>';

        $calls = $this->salvager->salvage($text, $this->tools);

        $this->assertCount(1, $calls);
        $this->assertSame('files_read', $calls[0]->name);
    }

    public function testDetectsAnAttemptWorthRepairing(): void
    {
        $this->assertTrue($this->salvager->looksLikeAttempt('<tool_call>{"name":'));
        $this->assertTrue($this->salvager->looksLikeAttempt('{"name": "files_read"}'));

        // A plain answer is not a malformed call and must not burn a repair round.
        $this->assertFalse($this->salvager->looksLikeAttempt('The EULA has not been accepted yet.'));
        $this->assertFalse($this->salvager->looksLikeAttempt(null));
    }

    public function testRepairSchemaConstrainsToOfferedToolNames(): void
    {
        $schema = $this->salvager->repairSchema($this->tools);

        $this->assertSame(['files_read', 'server_power'], $schema['properties']['name']['enum']);
        $this->assertSame(['name', 'arguments'], $schema['required']);
    }
}
