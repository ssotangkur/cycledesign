import { initTRPC } from '@trpc/server';
import { providersRouter } from './routers/providers';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Export appRouter directly
export const appRouter = router({
  providers: providersRouter,
});

// Export type router type signature for usage with frontend
export type AppRouter = typeof appRouter;
