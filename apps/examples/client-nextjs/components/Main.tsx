import React from 'react';
import { trpc } from '../libs/trpc';

const Main = () => {
  const hello = trpc.useQuery(['hello', { name: 'client' } as any]);
  if (!hello.data) return <div>Loading...</div>;
  return (
    <div>
      <p>{hello.data.greeting}</p>
    </div>
  );
};

export default Main;
