import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/monitoring";
import { translate } from "../i18n/translate";

interface State {
  error: Error | null;
}

/** Last line of defence: a friendly screen instead of a blank page when rendering crashes. */
class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    reportError(error, { source: "error-boundary", path: window.location.pathname });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">{translate("errorPage.title")}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {translate("errorPage.body")}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {translate("error.reload")}
            </button>
            <a href="/" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {translate("errorPage.home")}
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
