import { appRouter, AppRouter } from '../libs/trpc';
import { applyPMSHandler } from '@browser-trpc/browser';
import React, { useEffect } from 'react';

import styles from './index.module.css';

export function Index() {
  useEffect(() => {
    applyPMSHandler<AppRouter>({
      targetOrigin: '*',
      pms: window,
      router: appRouter,
    });
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}

export default Index;
