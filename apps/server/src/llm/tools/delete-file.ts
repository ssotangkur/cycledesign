import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

export const deleteFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
});

export type DeleteFileArgs = z.infer<typeof deleteFileSchema>;

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

export async function executeDeleteFile(args: DeleteFileArgs): Promise<{ success: boolean; filename?: string; error?: string }> {
  try {
    validateFilename(args.filename);

    const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
    const designsDir = join(workspaceDir, 'designs');
    const filePath = join(designsDir, args.filename);

    await fs.unlink(filePath);

    return { success: true, filename: args.filename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export const deleteFileTool = tool({
  description: 'Delete an existing code file',
  inputSchema: deleteFileSchema,
  execute: async ({ filename }) => {
    return executeDeleteFile({ filename });
  },
});
