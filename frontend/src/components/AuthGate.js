import { useCallback, useState } from 'react';
import { FONT, INK, BRAND, SURFACE } from '../theme';
import { checkToken, isWellFormedToken, setToken } from '../lib/api';

/**
 * Operator token gate.
 *
 * The backend refuses every control endpoint and the telemetry socket without
 * the shared token that run.py prints at startup. Normally run.py opens the
 * console with the token already in the URL fragment and this screen never
 * appears; it is the path for a second browser, a phone, or a reopened tab.
 *
 * The token is verified against /auth/check before it is stored, so a typo is
 * reported here rather than surfacing later as a console that connects to
 * nothing.
 */
export function AuthGate({ onAuthorized }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const candidate = value.trim();

      if (!isWellFormedToken(candidate)) {
        setError('That does not look like a Kavach token. Copy the full value from the server console.');
        return;
      }

      setChecking(true);
      setError('');
      try {
        await checkToken(candidate);
      } catch (cause) {
        setChecking(false);
        setError(
          cause?.status === 401 || cause?.status === 403
            ? 'Rejected by the detection server. The token may be from a previous run.'
            : cause?.message || 'Could not reach the detection server.'
        );
        return;
      }

      setToken(candidate);
      setChecking(false);
      onAuthorized?.();
    },
    [value, onAuthorized]
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: SURFACE.page,
        color: INK.primary,
        fontFamily: FONT.mono,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: '440px',
          background: SURFACE.panel,
          border: `1px solid ${INK.line}`,
          padding: 'clamp(24px, 6vw, 40px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div
          style={{
            fontFamily: FONT.display,
            fontSize: 'clamp(1.4rem, 4vw, 2rem)',
            letterSpacing: '0.15em',
            color: BRAND.red,
          }}
        >
          OPERATOR TOKEN
        </div>

        <p style={{ fontSize: '0.78rem', color: INK.muted, lineHeight: 1.7, margin: 0 }}>
          The detection server printed a token when it started. Paste it to
          authorize this console for the current browser session.
        </p>

        <label htmlFor="kavach-token" style={{ fontSize: '0.7rem', letterSpacing: '0.18em', color: INK.secondary }}>
          OPERATOR TOKEN
        </label>
        <input
          id="kavach-token"
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'kavach-token-error' : undefined}
          style={{
            fontFamily: FONT.mono,
            fontSize: '0.9rem',
            padding: '12px',
            background: SURFACE.sunken,
            color: INK.primary,
            border: `1px solid ${error ? BRAND.red : INK.line}`,
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />

        {error ? (
          <p
            id="kavach-token-error"
            role="alert"
            style={{ fontSize: '0.72rem', color: BRAND.red, lineHeight: 1.6, margin: 0 }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={checking}
          style={{
            fontFamily: FONT.display,
            fontSize: '0.9rem',
            letterSpacing: '0.2em',
            padding: '12px 28px',
            border: `1px solid ${BRAND.red}`,
            background: checking ? SURFACE.raised : BRAND.red,
            color: checking ? INK.muted : '#000',
            cursor: checking ? 'progress' : 'pointer',
          }}
        >
          {checking ? 'VERIFYING…' : 'AUTHORIZE CONSOLE'}
        </button>
      </form>
    </div>
  );
}

export default AuthGate;
