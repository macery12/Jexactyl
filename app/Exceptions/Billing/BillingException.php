<?php

namespace Everest\Exceptions\Billing;

use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\BillingException as BillingExceptionModel;

/**
 * Custom exception for billing-related errors.
 *
 * This exception is thrown when billing operations fail and automatically
 * logs the error to the billing_exceptions table for admin review.
 */
class BillingException extends DisplayException
{
    private ?int $orderId = null;
    private string $exceptionType = BillingExceptionModel::TYPE_PAYMENT;
    private ?string $paymentProcessor = null;
    private ?string $externalId = null;
    private array $context = [];

    /**
     * Create a new billing exception.
     *
     * @param string $title Short error title
     * @param string $message Detailed error message
     * @param string $exceptionType Type of exception (payment, deployment, storefront, webhook, refund)
     * @param int|null $orderId Associated order ID
     * @param string|null $paymentProcessor Payment processor (stripe, paypal)
     * @param string|null $externalId External transaction/payment ID
     * @param array $context Additional context data
     * @param \Throwable|null $previous Previous exception
     */
    public function __construct(
        private string $title,
        string $message,
        string $exceptionType = BillingExceptionModel::TYPE_PAYMENT,
        ?int $orderId = null,
        ?string $paymentProcessor = null,
        ?string $externalId = null,
        array $context = [],
        ?\Throwable $previous = null,
    ) {
        $this->orderId = $orderId;
        $this->exceptionType = $exceptionType;
        $this->paymentProcessor = $paymentProcessor;
        $this->externalId = $externalId;
        $this->context = $context;

        parent::__construct($message, $previous, self::LEVEL_ERROR);
    }

    /**
     * Log this exception to the database.
     * This is called automatically when the exception is reported.
     */
    public function report()
    {
        $this->logToDatabase();

        return parent::report();
    }

    /**
     * Log exception details to the billing_exceptions table.
     */
    private function logToDatabase(): void
    {
        try {
            $description = $this->getMessage();

            // Add payment processor info if available
            if ($this->paymentProcessor) {
                $description .= "\nPayment Processor: " . ucfirst($this->paymentProcessor);
            }

            // Add external ID if available
            if ($this->externalId) {
                $description .= "\nExternal ID: " . $this->externalId;
            }

            // Add context if available
            if (!empty($this->context)) {
                $description .= "\nContext: " . json_encode($this->context, JSON_PRETTY_PRINT);
            }

            // Add stack trace for debugging
            $description .= "\n\nStack Trace:\n" . $this->getTraceAsString();

            $data = [
                'exception_type' => $this->exceptionType,
                'title' => $this->title,
                'description' => $description,
            ];

            // Add order_id only if it's set and valid
            if ($this->orderId !== null) {
                $data['order_id'] = $this->orderId;
            }

            BillingExceptionModel::create($data);
        } catch (\Exception $e) {
            // If we fail to log the exception, log to system logs
            \Log::error('Failed to log billing exception to database: ' . $e->getMessage(), [
                'original_exception' => $this->getMessage(),
                'exception_type' => $this->exceptionType,
                'title' => $this->title,
            ]);
        }
    }

    /**
     * Get the exception type.
     */
    public function getExceptionType(): string
    {
        return $this->exceptionType;
    }

    /**
     * Get the order ID.
     */
    public function getOrderId(): ?int
    {
        return $this->orderId;
    }

    /**
     * Get the payment processor.
     */
    public function getPaymentProcessor(): ?string
    {
        return $this->paymentProcessor;
    }

    /**
     * Get the external ID.
     */
    public function getExternalId(): ?string
    {
        return $this->externalId;
    }

    /**
     * Get the context data.
     */
    public function getContext(): array
    {
        return $this->context;
    }
}
