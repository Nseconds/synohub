import React, { type ErrorInfo, type ReactNode } from "react";

interface AppBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface AppBoundaryState {
  hasError: boolean;
}

export class AppBoundary extends React.Component<AppBoundaryProps, AppBoundaryState> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("SynoHub layout crash caught:", error, errorInfo);
    try {
      localStorage.removeItem("synohub-user");
    } catch {
      // Ignore storage failures; the fallback login screen still renders.
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
