import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { Component } from 'react';
import tw from 'twin.macro';

import Icon from '@/elements/Icon';

interface Props {
    children?: ReactNode;
    /** When true, show the error details (message/stack) in the UI. */
    showDetails?: boolean;
}

interface State {
    hasError: boolean;
    error?: Error | null;
    errorInfo?: { componentStack: string } | null;
}

class ErrorBoundary extends Component<Props, State> {
    override state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    override componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
        // Capture error so we can optionally render it in the UI when requested.
        // Still log to the console for server-side diagnostics.

        console.error(error, errorInfo);
        this.setState({ error, errorInfo });
    }

    override render() {
        if (!this.state.hasError) return this.props.children;

        const { showDetails } = this.props;

        return (
            <div css={tw`flex items-center justify-center w-full my-4`}>
                <div css={tw`flex flex-col items-start bg-neutral-900 rounded p-3 text-red-500 w-full`}>
                    <div css={tw`flex items-center w-full`}>
                        <Icon icon={faExclamationTriangle} css={tw`h-4 w-auto mr-2`} />
                        <p css={tw`text-sm text-neutral-100`}>An error was encountered while rendering this view.</p>
                    </div>
                    {showDetails && (
                        <div css={tw`mt-3 w-full overflow-auto text-xs text-neutral-300 bg-neutral-800 p-2 rounded`}>
                            <div>
                                <strong>Message:</strong>{' '}
                                {this.state.error?.message ||
                                    (this.state.errorInfo?.componentStack
                                        ? 'See component stack below.'
                                        : 'Unknown error')}
                            </div>
                            {this.state.error && !this.state.error.message && (
                                <div css={tw`mt-2 text-xs text-neutral-400`}>
                                    <strong>Raw:</strong>{' '}
                                    {(() => {
                                        try {
                                            return JSON.stringify(this.state.error);
                                        } catch (e) {
                                            return String(this.state.error);
                                        }
                                    })()}
                                </div>
                            )}
                            {this.state.errorInfo?.componentStack && (
                                <pre css={tw`mt-2 whitespace-pre-wrap`}>{this.state.errorInfo.componentStack}</pre>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
