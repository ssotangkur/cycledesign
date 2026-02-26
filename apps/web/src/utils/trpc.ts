import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@server/trpc/index';

// Create tRPC React hooks
export const trpc = createTRPCReact<AppRouter>();
