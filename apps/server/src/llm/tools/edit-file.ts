import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { applyPatch } from 'diff';

export const editFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs'),
  patch: z
    .string()
    .describe('Unified diff patch to apply to the file'),
});

export type EditFileArgs = z.infer<typeof editFileSchema>;

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

export async function executeEditFile(args: EditFileArgs): Promise<{ success: boolean; filename?: string; error?: string }> {
  try {
    validateFilename(args.filename);

    const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
    const filePath = join(workspaceDir, args.location, args.filename);

    const existingContent = await fs.readFile(filePath, 'utf-8');
    
    const patchedContent = applyPatch(existingContent, args.patch);
    
    if (patchedContent === false) {
      return { success: false, error: 'Failed to apply patch. The patch does not match the current file content.' };
    }

    await fs.writeFile(filePath, patchedContent, 'utf-8');

    return { success: true, filename: args.filename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export const editFileTool = tool({
  description: 'Modify an existing design file using unified diff patch',
  parameters: editFileSchema,
  execute: async (args: EditFileArgs) => {
    return executeEditFile(args);
  },
});
