import { router } from './init.js';
import { providersRouter } from './routers/providers.js';
import { sessionsRouter } from './routers/sessions.js';

export const appRouter = router({
  providerConfig: providersRouter,
  sessions: sessionsRouter,
});

export type AppRouter = typeof appRouter;
