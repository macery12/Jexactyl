<?php

namespace Everest\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Egg;
use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\Allocation;
use Everest\Models\EggVariable;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Cache;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\BillingException;
use Everest\Services\Servers\ServerCreationService;
use Everest\Services\Servers\VariableValidatorService;
use Everest\Exceptions\Billing\BillingException as BillingExceptionClass;

class CreateServerService
{
    /**
     * CreateServerService constructor.
     */
    public function __construct(
        private ServerCreationService $creation,
        private VariableValidatorService $variableValidator,
    ) {
    }

    /**
     * Process the creation of a server.
     * This method handles both free and paid servers.
     *
     * @param Request $request The HTTP request
     * @param Product $product The product being purchased
     * @param \Stripe\StripeObject|\stdClass $metadata The metadata (from Stripe or mock object)
     * @param Order $order The order being processed
     * @param string|null $serverName The custom server name (optional)
     *
     * @return Server The created server
     */
    public function process(Request $request, Product $product, object $metadata, Order $order, ?string $serverName = null): Server
    {
        // Use egg from order if available, otherwise fall back to category's default egg
        $eggId = $order->egg_id ?? $product->category->getDefaultEggId();

        $egg = Egg::findOrFail($eggId);

        $allocation = $this->getAllocation($metadata->node_id, $order->id);

        // Extract custom variables from metadata if available
        $customVariables = [];
        if (isset($metadata->variables) && $metadata->variables !== '') {
            if (is_string($metadata->variables)) {
                $decoded = json_decode($metadata->variables, true);
                if (json_last_error() !== JSON_ERROR_NONE) {
                    throw new DisplayException('Failed to decode environment variables: ' . json_last_error_msg());
                }
                if (!is_array($decoded)) {
                    throw new DisplayException('Environment variables must be an array.');
                }
                $customVariables = $decoded;
            } elseif (is_array($metadata->variables)) {
                $customVariables = $metadata->variables;
            }
        }

        $environment = $this->getEnvironmentWithCustomVariables(
            $egg->id,
            $this->filterUserEditableVariables($egg->id, $customVariables)
        );

        // Determine the server name: use passed parameter, metadata name, or default
        $finalServerName = $serverName;
        if (!$finalServerName && isset($metadata->name) && !empty(trim((string) $metadata->name))) {
            $finalServerName = trim((string) $metadata->name);
        }
        if (!$finalServerName) {
            // Defensive fallback - should not be reached due to frontend/controller validation
            // but ensures server creation never fails due to empty name
            $finalServerName = $request->user()->username . '\'s server';
        }

        try {
            // Get billing days from metadata (Stripe) or order, or default to product's renewal days
            $billingDays = null;
            if (isset($metadata->billing_days) && is_numeric($metadata->billing_days)) {
                $billingDays = (int) $metadata->billing_days;
            } elseif ($order->billing_days) {
                $billingDays = $order->billing_days;
            }

            // If no billing_days specified, fall back to product's default
            $renewalDays = $billingDays ?? $product->getRenewalDays();

            $server = $this->creation->handle([
                'node_id' => $metadata->node_id,
                'allocation_id' => $allocation,
                'egg_id' => $egg->id,
                'nest_id' => $product->category->nest_id,
                'name' => $finalServerName,
                'owner_id' => $request->user()->id,
                'memory' => $product->memory_limit,
                'swap' => 0,
                'disk' => $product->disk_limit,
                'io' => 500,
                'cpu' => $product->cpu_limit,
                'startup' => $egg->startup,
                'environment' => $environment,
                'image' => current($egg->docker_images),
                'billing_product_id' => $product->id,
                'billing_days' => $renewalDays, // Use renewalDays to be consistent with renewal_date
                'billing_amount' => $order->total,
                'renewal_date' => Carbon::now()->addDays($renewalDays)->toDateTimeString(),
                'database_limit' => $product->database_limit,
                'backup_limit' => $product->backup_limit,
                'allocation_limit' => $product->allocation_limit,
                'subuser_limit' => 3,
                'subdomain_limit' => null,
            ]);
        } catch (BillingExceptionClass $e) {
            // Re-throw billing exceptions as-is
            throw $e;
        } catch (DisplayException $ex) {
            throw new BillingExceptionClass('Failed to create billable server', 'Unable to create server: ' . $ex->getMessage(), BillingException::TYPE_DEPLOYMENT, $order->id, null, null, ['product_id' => $product->id, 'node_id' => $metadata->node_id, 'egg_id' => $egg->id], $ex);
        } catch (\Exception $ex) {
            throw new BillingExceptionClass('Unexpected server creation error', 'An unexpected error occurred while creating server: ' . $ex->getMessage(), BillingException::TYPE_DEPLOYMENT, $order->id, null, null, ['product_id' => $product->id, 'node_id' => $metadata->node_id, 'egg_id' => $egg->id, 'error' => $ex->getMessage()], $ex);
        }

        // Invalidate the node availability cache so the next checkout reflects current allocation state.
        Cache::forget("billing.node_available.{$metadata->node_id}");

        return $server;
    }

    /**
     * Process the creation of a free server.
     *
     * This is a convenience wrapper around the unified process() method.
     * It converts the simple parameters into the StripeObject format expected by process().
     *
     * @param Request $request The HTTP request
     * @param Product $product The product being purchased
     * @param int $nodeId The node ID to deploy to
     * @param Order $order The order being processed
     * @param array $customVariables Custom environment variables
     * @param string|null $serverName The custom server name (optional)
     *
     * @return Server The created server
     */
    public function processFree(Request $request, Product $product, int $nodeId, Order $order, array $customVariables = [], ?string $serverName = null): Server
    {
        // Create a mock metadata object that mimics Stripe's StripeObject structure
        $metadata = new \stdClass();
        $metadata->node_id = $nodeId;
        $metadata->variables = !empty($customVariables) ? $customVariables : null;

        // Call the unified process method
        return $this->process($request, $product, $metadata, $order, $serverName);
    }

    /**
     * Merge custom environment variables with defaults for an egg.
     * Custom variables take precedence over defaults.
     */
    private function getEnvironmentWithCustomVariables(int $eggId, array $customVariables = []): array
    {
        $variables = [];
        $defaults = EggVariable::where('egg_id', $eggId)->get();

        // Start with defaults
        foreach ($defaults as $variable) {
            $variables[$variable->env_variable] = $variable->default_value;
        }

        // Override with custom variables
        foreach ($customVariables as $variable) {
            if (is_array($variable)
                && array_key_exists('key', $variable)
                && array_key_exists('value', $variable)
                && !empty($variable['key'])) {
                $variables[$variable['key']] = $variable['value'];
            }
        }

        return $variables;
    }

    /**
     * Restrict billing-supplied variables to known, user-editable egg variables only.
     */
    private function filterUserEditableVariables(int $eggId, array $customVariables): array
    {
        if (empty($customVariables)) {
            return [];
        }

        $normalized = [];
        foreach ($customVariables as $variable) {
            if (!is_array($variable) || !array_key_exists('key', $variable) || !array_key_exists('value', $variable)) {
                continue;
            }

            $key = trim((string) $variable['key']);
            if ($key === '') {
                continue;
            }

            $normalized[$key] = is_scalar($variable['value']) || $variable['value'] === null
                ? (string) ($variable['value'] ?? '')
                : '';
        }

        if (empty($normalized)) {
            return [];
        }

        return $this->variableValidator
            ->setUserLevel(User::USER_LEVEL_USER)
            ->handle($eggId, $normalized)
            ->map(fn ($variable) => [
                'key' => $variable->key,
                'value' => $variable->value ?? '',
            ])
            ->values()
            ->all();
    }

    /**
     * Get a suitable allocation to deploy to.
     *
     * @throws BillingExceptionClass
     */
    private function getAllocation(int $nodeId, int $orderId): int
    {
        $allocation = Allocation::where('node_id', $nodeId)->where('server_id', null)->first();

        if (!$allocation) {
            throw new BillingExceptionClass('Failed to find allocation to assign to server', 'No allocations are available for deployment. Please create more allocations (ports) for node ' . $nodeId, BillingException::TYPE_DEPLOYMENT, $orderId, null, null, ['node_id' => $nodeId]);
        }

        return $allocation->id;
    }
}
