import { initTRPC } from '@trpc/server';
import { providersRouter } from './routers/providers.js';
import { sessionsRouter } from './routers/sessions.js';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  providerConfig: providersRouter,
  sessions: sessionsRouter,
});

export type AppRouter = typeof appRouter;
