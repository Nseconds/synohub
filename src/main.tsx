import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

const renderStaticMessage = (title: string, detail: string) => {
  if (!rootElement) return;
  rootElement.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#18181b;font-family:Arial,sans-serif;padding:24px;">
      <div style="max-width:560px;background:white;border:1px solid #e4e4e7;border-radius:12px;padding:24px;box-shadow:0 20px 45px rgba(15,23,42,.08);">
        <h1 style="margin:0 0 8px;font-size:20px;">${title}</h1>
        <p style="margin:0;font-size:13px;color:#52525b;line-height:1.5;white-space:pre-wrap;">${detail}</p>
      </div>
    </div>
  `;
};

const isIgnorableDevServerError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value || '');
  return message.includes('WebSocket closed without opened');
};

window.addEventListener('error', (event) => {
  if (isIgnorableDevServerError(event.error || event.message)) {
    event.preventDefault();
    return;
  }

  renderStaticMessage(
    'SynoHub could not start',
    event.error instanceof Error ? event.error.message : event.message || 'A browser runtime error stopped the app.'
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (isIgnorableDevServerError(reason)) {
    event.preventDefault();
    return;
  }

  renderStaticMessage(
    'SynoHub could not start',
    reason instanceof Error ? reason.message : String(reason || 'A browser promise error stopped the app.')
  );
});

renderStaticMessage(
  'Loading SynoHub...',
  'If this message stays, the React app module did not mount. Open the browser console for the first red error.'
);

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SynoHub render failed', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Arial, sans-serif', background: '#f8fafc', color: '#18181b', padding: 24 }}>
          <div style={{ maxWidth: 560, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 12, padding: 24, boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>SynoHub could not render</h1>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#52525b', lineHeight: 1.5 }}>
              A runtime state caused the page to fail. Clear the session and reload.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f5', padding: 12, borderRadius: 8, fontSize: 12, color: '#3f3f46' }}>
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('synohub-user');
                } catch {
                  // Ignore unavailable storage.
                }
                location.reload();
              }}
              style={{ marginTop: 16, border: 0, background: '#00ADC6', color: '#fff', borderRadius: 8, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}
            >
              Clear Session and Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

import('./App.tsx')
  .then(({ default: App }) => {
    try {
      createRoot(rootElement).render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>,
      );
    } catch (error) {
      console.error('SynoHub initial render failed', error);
      renderStaticMessage(
        'SynoHub initial render failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  })
  .catch((error) => {
    console.error('SynoHub app module failed to load', error);
    renderStaticMessage(
      'SynoHub app module failed to load',
      error instanceof Error ? error.message : String(error)
    );
  });
