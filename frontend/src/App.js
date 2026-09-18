import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { CustomCursor } from './components/CustomCursor';
import { Dashboard } from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { hasToken, onTokenRejected } from './lib/api';

export default function App() {
  const [page, setPage] = useState('landing');
  // The console is useless without the operator token — the socket will not
  // open and no control reaches the detector — so gate on it before mounting
  // the dashboard rather than showing a dead console.
  const [authorized, setAuthorized] = useState(hasToken);

  // Without this, returning from the console drops you at whatever offset the
  // landing page was last scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  // The server can refuse the token mid-session — a restart mints a new one.
  // Fall back to the gate rather than leaving a console that silently controls
  // nothing.
  useEffect(() => onTokenRejected(() => setAuthorized(false)), []);

  const toDashboard = useCallback(() => setPage('dashboard'), []);
  const toLanding = useCallback(() => setPage('landing'), []);
  const onAuthorized = useCallback(() => setAuthorized(true), []);

  const console_ = authorized
    ? <Dashboard onBack={toLanding} />
    : <AuthGate onAuthorized={onAuthorized} />;

  return (
    <>
      <CustomCursor />
      {/* Scoped per page: a crash in the console should not take the whole app
          down permanently — going back re-mounts a fresh boundary. */}
      <ErrorBoundary key={page}>
        {page === 'landing' ? <LandingPage onEnter={toDashboard} /> : console_}
      </ErrorBoundary>
    </>
  );
}
