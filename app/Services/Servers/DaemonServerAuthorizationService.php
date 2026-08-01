<?php

namespace Everest\Services\Servers;

use Everest\Models\Node;
use Everest\Models\Backup;
use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\ServerTransfer;
use Everest\Exceptions\Http\HttpForbiddenException;

class DaemonServerAuthorizationService
{
    /**
     * Return the node authenticated by the daemon middleware.
     */
    public function node(Request $request): Node
    {
        $node = $request->attributes->get('node');
        if (!$node instanceof Node) {
            throw new HttpForbiddenException('The requesting daemon could not be identified.');
        }

        return $node;
    }

    /**
     * Ensure the daemon is the node currently assigned to the server.
     */
    public function assertCurrentNode(Node $node, Server $server): void
    {
        $this->assertAllowed($node->id === $server->node_id);
    }

    /**
     * Server details are available to the assigned node and, during an active
     * transfer, both the source and target nodes.
     */
    public function assertCanReadDetails(Node $node, Server $server, ?ServerTransfer $transfer): void
    {
        $allowed = is_null($transfer)
            ? $node->id === $server->node_id
            : in_array($node->id, [$transfer->old_node, $transfer->new_node], true);

        $this->assertAllowed($allowed);
    }

    /**
     * Either participant in an active transfer may report a failure.
     */
    public function assertCanFailTransfer(Node $node, ServerTransfer $transfer): void
    {
        $this->assertAllowed(in_array($node->id, [$transfer->old_node, $transfer->new_node], true));
    }

    /**
     * Only the target node may finalize a successful transfer.
     */
    public function assertCanCompleteTransfer(Node $node, ServerTransfer $transfer): void
    {
        $this->assertAllowed($node->id === $transfer->new_node);
    }

    /**
     * Backups are only visible to the node currently assigned to their server.
     */
    public function assertCanAccessBackup(Node $node, Backup $backup): void
    {
        $this->assertAllowed($node->id === $backup->server->node_id);
    }

    private function assertAllowed(bool $allowed): void
    {
        if (!$allowed) {
            throw new HttpForbiddenException('This daemon is not authorized to access the requested resource.');
        }
    }
}
