import { useCallback, useEffect, useState } from 'react';
import { CustomCursor } from './components/CustomCursor';
import { Dashboard } from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';

export default function App() {
  const [page, setPage] = useState('landing');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const toDashboard = useCallback(() => setPage('dashboard'), []);
  const toLanding = useCallback(() => setPage('landing'), []);

  return (
    <>
      <CustomCursor />
      <ErrorBoundary key={page}>
        {page === 'landing' ? <LandingPage onEnter={toDashboard} /> : <Dashboard onBack={toLanding} />}
      </ErrorBoundary>
    </>
  );
}
