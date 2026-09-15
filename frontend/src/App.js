import { useCallback, useEffect, useState } from 'react';
import { CustomCursor } from './components/CustomCursor';
import { Dashboard } from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';

export default function App() {
  const [page, setPage] = useState('landing');

  // Without this, returning from the console drops you at whatever offset the
  // landing page was last scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const toDashboard = useCallback(() => setPage('dashboard'), []);
  const toLanding = useCallback(() => setPage('landing'), []);

  return (
    <>
      <CustomCursor />
      {/* Scoped per page: a crash in the console should not take the whole app
          down permanently — going back re-mounts a fresh boundary. */}
      <ErrorBoundary key={page}>
        {page === 'landing' ? <LandingPage onEnter={toDashboard} /> : <Dashboard onBack={toLanding} />}
      </ErrorBoundary>
    </>
  );
}
