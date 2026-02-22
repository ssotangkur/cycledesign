import { exec } from 'child_process';
import { promisify } from 'util';
import { ValidationError } from './types';

const execAsync = promisify(exec);

export async function validateTypeScript(
  _code: string,
  filename: string,
  previewDir: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const { stdout, stderr } = await execAsync(
      `npx tsc --noEmit --jsx react --esModuleInterop --skipLibCheck "${filename}"`,
      {
        cwd: previewDir,
        encoding: 'utf8',
      }
    );

    if (stderr) {
      const parsedErrors = parseTypeScriptOutput(stderr);
      errors.push(...parsedErrors);
    }

    if (stdout) {
      const parsedErrors = parseTypeScriptOutput(stdout);
      errors.push(...parsedErrors);
    }
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as unknown as { stdout: string; stderr: string };
      const output = execError.stderr || execError.stdout;
      const parsedErrors = parseTypeScriptOutput(output);
      errors.push(...parsedErrors);
    } else if (error instanceof Error) {
      errors.push({
        type: 'typescript',
        severity: 'error',
        file: filename,
        message: `TypeScript compilation failed: ${error.message}`,
      });
    }
  }

  return errors;
}

function parseTypeScriptOutput(output: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = output.split('\n');

  const errorPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(errorPattern);
    if (match) {
      const [, file, lineNum, colNum, code, message] = match;
      errors.push({
        type: 'typescript',
        severity: 'error',
        file: file.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        message: message.trim(),
        code: `TS${code}`,
      });
    }
  }

  return errors;
}
