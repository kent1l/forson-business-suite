import { Component } from 'react';
import ErrorState from './ErrorState';

// Catches render/lifecycle errors in its subtree so one broken section (a tab,
// a modal) can't blank the whole page. Reuses ErrorState for the fallback UI to
// stay visually consistent with existing "failed to load" states.
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught an error:', error, info);
    }

    handleRetry = () => {
        this.setState({ hasError: false });
    };

    render() {
        if (this.state.hasError) {
            return (
                <ErrorState
                    title={this.props.title || 'Something went wrong'}
                    description={this.props.description || 'This section failed to render. You can try again or continue using the rest of the page.'}
                    onRetry={this.handleRetry}
                    className={this.props.className}
                />
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
