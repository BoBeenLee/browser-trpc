import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { createPMClient, pmLink } from '@browser-trpc/links';
import Main from '../components/Main';
import { trpc } from '../libs/trpc';
import styles from './index.module.css';

export function Index() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      url: '',
      links: [
        pmLink({
          client: createPMClient({
            targetOrigin: '*',
            PostMessage: window,
          }),
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Main />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default Index;
