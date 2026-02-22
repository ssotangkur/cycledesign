import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { trackDependency } from '../work-tracker';

const execAsync = promisify(exec);

export const addDependencySchema = z.object({
  packageName: z
    .string()
    .regex(/^[a-z0-9@/._-]+$/, 'Invalid package name'),
  version: z
    .string()
    .optional()
    .describe('Version range (e.g., "^5.0.0"). If omitted, latest stable is used'),
});

export type AddDependencyArgs = z.infer<typeof addDependencySchema>;

export async function executeAddDependency(args: AddDependencyArgs, messageId?: string): Promise<{ success: boolean; packageName?: string; version?: string; error?: string }> {
  try {
    const previewDir = join(process.cwd(), 'apps', 'preview');
    const packageSpec = args.version ? `${args.packageName}@${args.version}` : args.packageName;

    await execAsync(`npm install ${packageSpec}`, {
      cwd: previewDir,
      timeout: 120000,
    });

    if (messageId) {
      trackDependency(messageId, args.packageName);
    }

    return { 
      success: true, 
      packageName: args.packageName, 
      version: args.version || 'latest' 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export const addDependencyTool = tool({
  description: 'Add an npm package to the preview environment',
  parameters: addDependencySchema,
  execute: async (args: AddDependencyArgs) => {
    return executeAddDependency(args);
  },
});
