import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

export const renameFileSchema = z.object({
  oldFilename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  newFilename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
});

export type RenameFileArgs = z.infer<typeof renameFileSchema>;

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

export async function executeRenameFile(args: RenameFileArgs): Promise<{ success: boolean; oldFilename?: string; newFilename?: string; error?: string }> {
  try {
    validateFilename(args.oldFilename);
    validateFilename(args.newFilename);

    const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
    const designsDir = join(workspaceDir, 'designs');
    const oldPath = join(designsDir, args.oldFilename);
    const newPath = join(designsDir, args.newFilename);

    await fs.rename(oldPath, newPath);

    return { success: true, oldFilename: args.oldFilename, newFilename: args.newFilename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export const renameFileTool = tool({
  description: 'Rename an existing code file',
  parameters: renameFileSchema,
  execute: async (args: RenameFileArgs) => {
    return executeRenameFile(args);
  },
});
