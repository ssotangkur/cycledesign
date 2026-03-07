import { exec } from 'child_process';
import { promisify } from 'util';
import { ValidationError } from './types.js';

const execAsync = promisify(exec);

export async function validateKnip(
  previewDir: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const { stdout, stderr } = await execAsync('npx knip --no-progress',
      {
        cwd: previewDir,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stderr || stdout;
    const parsedErrors = parseKnipOutput(output);
    errors.push(...parsedErrors);
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as unknown as { stdout: string; stderr: string };
      const output = execError.stderr || execError.stdout;
      if (output) {
        const parsedErrors = parseKnipOutput(output);
        errors.push(...parsedErrors);
      }
    } else if (error instanceof Error) {
      if (error.message.includes('Unused files') || 
          error.message.includes('Unused dependencies') ||
          error.message.includes('Unused exports')) {
        const parsedErrors = parseKnipOutput(error.message);
        errors.push(...parsedErrors);
      }
    }
  }

  return errors;
}

function parseKnipOutput(output: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = output.split('\n');

  let currentFile = '';
  let currentSection = '';

  for (const line of lines) {
    if (line.includes('Unused') && line.includes(':')) {
      currentSection = line.trim();
      continue;
    }

    if (line.trim().startsWith('.') && line.includes('.tsx')) {
      currentFile = line.trim();
      continue;
    }

    if (currentFile && line.trim() && !line.startsWith('└') && !line.startsWith('┌')) {
      const trimmed = line.trim().replace(/^[├│─└┌]+\s*/, '');
      if (trimmed && !trimmed.includes('Unused')) {
        const lineMatch = trimmed.match(/:(\d+):\d+/);
        errors.push({
          type: 'knip',
          severity: 'warning',
          file: currentFile,
          line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
          message: `${currentSection}: ${trimmed}`,
        });
      }
    }
  }

  return errors;
}
