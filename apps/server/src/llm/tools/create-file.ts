import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { trackFileCreation } from '../work-tracker';

export const createFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs')
    .describe('Files can only be created in the designs/ directory'),
  code: z
    .string()
    .describe('Complete TypeScript React code to write to the file'),
});

export type CreateFileArgs = z.infer<typeof createFileSchema>;

function validateFilename(filename: string): void {
  if (filename.includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  if (filename.startsWith('/')) {
    throw new Error('Absolute paths are not allowed');
  }
  if (!filename.endsWith('.tsx')) {
    throw new Error('Only .tsx files are allowed');
  }
}

export async function executeCreateFile(args: CreateFileArgs, messageId?: string): Promise<{ success: boolean; filename?: string; error?: string }> {
  try {
    validateFilename(args.filename);

    const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
    const filePath = join(workspaceDir, args.location, args.filename);

    await fs.mkdir(join(workspaceDir, args.location), { recursive: true });
    await fs.writeFile(filePath, args.code, 'utf-8');

    if (messageId) {
      trackFileCreation(messageId, args.filename, args.code);
    }

    return { success: true, filename: args.filename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export const createFileTool = tool({
  description: 'Create a new design file with the provided code',
  parameters: createFileSchema,
  execute: async (args: CreateFileArgs) => {
    return executeCreateFile(args);
  },
});
