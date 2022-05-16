import * as trpc from '@browser-trpc/browser';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/ban-types
type Context = {};

export const appRouter = trpc
    .router<Context>()
    .query('hello', {
        input: z
            .object({
                name: z.string(),
            })
            .nullish(),
        resolve: ({ input }) => {
            return {
                text: `hello ${input?.name ?? 'world'}`,
            };
        },
    })
    .mutation('createPost', {
        input: z.object({
            title: z.string(),
            text: z.string(),
        }),
        resolve({ input }) {
            // imagine db call here
            return {
                id: `${Math.random()}`,
                ...input,
            };
        },
    })
    .subscription('randomNumber', {
        resolve() {
            return new trpc.Subscription<{ randomNumber: number }>((emit) => {
                const timer = setInterval(() => {
                    // emits a number every second
                    emit.data({ randomNumber: Math.random() });
                }, 200);

                return () => {
                    clearInterval(timer);
                };
            });
        },
    });

export type AppRouter = typeof appRouter;
