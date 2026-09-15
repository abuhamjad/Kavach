import { Component } from 'react';
import { FONT, INK, BRAND, SURFACE } from '../theme';

/**
 * Without this, one bad payload or a Recharts throw blanks the entire operator
 * console to white with no recovery path. A surveillance console must fail
 * visibly and stay recoverable.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[kavach] console crashed', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          background: SURFACE.page,
          color: INK.primary,
          fontFamily: FONT.mono,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: FONT.display, fontSize: 'clamp(1.5rem,5vw,2.5rem)', letterSpacing: '0.15em', color: BRAND.red }}>
          CONSOLE FAULT
        </div>
        <p style={{ fontSize: '0.8rem', color: INK.muted, maxWidth: '52ch', lineHeight: 1.7 }}>
          The interface stopped responding. The detection backend is unaffected and
          continues to record. Reload to reconnect.
        </p>
        <pre
          style={{
            fontSize: '0.65rem',
            color: INK.faint,
            maxWidth: '68ch',
            overflowX: 'auto',
            border: `1px solid ${INK.line}`,
            padding: '12px',
            textAlign: 'left',
            width: '100%',
          }}
        >
          {String(error?.message || error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            fontFamily: FONT.display,
            fontSize: '0.9rem',
            letterSpacing: '0.2em',
            padding: '10px 28px',
            border: `1px solid ${BRAND.red}`,
            background: BRAND.red,
            color: '#000',
            cursor: 'pointer',
          }}
        >
          RELOAD CONSOLE
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
