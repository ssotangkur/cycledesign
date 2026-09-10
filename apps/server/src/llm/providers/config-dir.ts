// Shared config-dir resolution for LLM provider file persistence.
//
// Single owner of the precedence also used by the providers tRPC router
// (apps/server/src/trpc/routers/providers.ts):
//   CYCLEDESIGN_CONFIG_DIR > (CYCLEDESIGN_E2E === '1' ? .cycledesign-e2e : .cycledesign)
//
// Providers must resolve the dir dynamically (call getConfigDir() at each
// read/write) so E2E runs and CYCLEDESIGN_CONFIG_DIR overrides isolate
// provider JSON files instead of leaking them into ./.cycledesign.
import { join } from 'path';

export function getConfigDir(): string {
  return (
    process.env.CYCLEDESIGN_CONFIG_DIR ??
    (process.env.CYCLEDESIGN_E2E === '1'
      ? join(process.cwd(), '.cycledesign-e2e')
      : join(process.cwd(), '.cycledesign'))
  );
}
