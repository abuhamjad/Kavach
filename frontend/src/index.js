import React from 'react';
import ReactDOM from 'react-dom/client';

// Self-hosted fonts. These were previously pulled from the Google Fonts CDN via
// a <link> injected at module-import time, which broke the project's "runs fully
// offline" guarantee and made a surveillance console beacon to a third party on
// every load. Bundled locally now — no network, no external request.
import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/300.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/share-tech-mono/400.css';

import './index.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
