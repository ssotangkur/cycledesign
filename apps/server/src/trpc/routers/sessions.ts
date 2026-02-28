import { router, publicProcedure } from '../init.js';
import { z } from 'zod';
import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
} from '../../sessions/storage.js';

export const sessionsRouter = router({
  // GET /api/sessions - List all sessions
  list: publicProcedure.query(async () => {
    return listSessions();
  }),

  // POST /api/sessions - Create a new session
  create: publicProcedure
    .input(z.object({ name: z.string().optional() }))
    .mutation(async ({ input }) => {
      return createSession(input.name);
    }),

  // GET /api/sessions/:id - Get a session by ID
  get: publicProcedure
    .input(z.string())
    .query(async ({ input }) => {
      const session = await getSession(input);
      if (!session) {
        throw new Error('Session not found');
      }
      return session;
    }),

  // DELETE /api/sessions/:id - Delete a session
  delete: publicProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      const deleted = await deleteSession(input);
      if (!deleted) {
        throw new Error('Session not found');
      }
      return { success: true };
    }),
});
