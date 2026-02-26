import { initTRPC } from '@trpc/server';
import { providersRouter } from './routers/providers';
import { sessionsRouter } from './routers/sessions';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  providers: providersRouter,
  sessions: sessionsRouter,
});

export type AppRouter = typeof appRouter;
