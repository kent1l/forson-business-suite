import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(_error) {
        // Update state so the next render will show the fallback UI
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // Log error details to console for debugging
        console.error('=== ERROR BOUNDARY CAUGHT ERROR ===');
        console.error('Error:', error);
        console.error('Error Message:', error?.message);
        console.error('Error Stack:', error?.stack);
        console.error('Component Stack:', errorInfo?.componentStack);
        console.error('Error Name:', error?.name);
        console.error('Error toString:', error?.toString());
        
        // Log React version for debugging version conflicts
        console.error('React Version:', React.version);
        
        // Log browser information
        console.error('User Agent:', navigator.userAgent);
        console.error('Timestamp:', new Date().toISOString());
        
        // Store error details in state
        this.setState({
            error: error,
            errorInfo: errorInfo
        });

        // Optionally send to error tracking service
        // this.logErrorToService(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-6">
                    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
                        <div className="mb-6 flex items-center gap-4">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                                <svg
                                    className="h-8 w-8 text-red-600"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                    />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold text-gray-900">
                                    Something went wrong
                                </h1>
                                <p className="mt-1 text-sm text-gray-500">
                                    An unexpected error occurred in the application
                                </p>
                            </div>
                        </div>

                        {/* Error details for debugging */}
                        <div className="mb-6 rounded-lg bg-red-50 p-4">
                            <h2 className="mb-2 font-semibold text-red-900">Error Details:</h2>
                            <p className="mb-2 font-mono text-sm text-red-800">
                                {this.state.error?.toString()}
                            </p>
                            {this.state.error?.message && (
                                <p className="mb-2 text-sm text-red-700">
                                    <span className="font-semibold">Message:</span> {this.state.error.message}
                                </p>
                            )}
                            <p className="text-xs text-red-600">
                                <span className="font-semibold">React Version:</span> {React.version}
                            </p>
                        </div>

                        {/* Stack trace (collapsible for production) */}
                        <details className="mb-6">
                            <summary className="cursor-pointer rounded-lg bg-gray-100 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-200">
                                View Stack Trace (Advanced)
                            </summary>
                            <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-900 p-4">
                                <pre className="text-xs text-green-400">
                                    {this.state.error?.stack}
                                </pre>
                                {this.state.errorInfo?.componentStack && (
                                    <>
                                        <hr className="my-4 border-gray-700" />
                                        <pre className="text-xs text-blue-400">
                                            {this.state.errorInfo.componentStack}
                                        </pre>
                                    </>
                                )}
                            </div>
                        </details>

                        {/* Action buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => window.location.reload()}
                                className="flex-1 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
                            >
                                Reload Page
                            </button>
                            <button
                                onClick={() => {
                                    console.clear();
                                    this.setState({ hasError: false, error: null, errorInfo: null });
                                }}
                                className="flex-1 rounded-lg border-2 border-gray-300 px-6 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                            >
                                Try Again
                            </button>
                        </div>

                        {/* Help text */}
                        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                            <p className="text-sm text-blue-900">
                                <span className="font-semibold">💡 Debugging Tips:</span>
                            </p>
                            <ul className="mt-2 list-inside list-disc text-sm text-blue-800">
                                <li>Check the browser console (F12) for detailed error logs</li>
                                <li>Clear your browser cache and cookies</li>
                                <li>Try using a different browser</li>
                                <li>Contact support if the problem persists</li>
                            </ul>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
