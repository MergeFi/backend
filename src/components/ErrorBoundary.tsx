'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { track } from '@/lib/analytics';

interface Props {
  children:  ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
    track('app_error', {
      message:    error.message,
      stack:      error.stack?.slice(0, 200),
      component:  info.componentStack?.trim().split('\n')[0]?.trim(),
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
          <span className="text-4xl">⚠️</span>
          <h3 className="mt-4 text-lg font-semibold text-white">Something went wrong</h3>
          <p className="mt-2 text-sm text-gray-400">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-6 rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-400 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
