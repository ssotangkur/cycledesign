import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { ValidationError } from './types.js';

const execAsync = promisify(exec);

export async function validateESLint(
  _code: string,
  filename: string,
  previewDir: string,
  serverDir: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const eslintConfigPath = join(serverDir, '.eslintrc.js');
    const previewEslintConfigPath = join(previewDir, '.eslintrc.js');

    if (existsSync(eslintConfigPath) && !existsSync(previewEslintConfigPath)) {
      const previewEslintDir = dirname(previewEslintConfigPath);
      if (!existsSync(previewEslintDir)) {
        mkdirSync(previewEslintDir, { recursive: true });
      }
      copyFileSync(eslintConfigPath, previewEslintConfigPath);
    }

    const { stdout, stderr } = await execAsync(
      `npx eslint --format json "${filename}"`,
      {
        cwd: previewDir,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (stdout) {
      const parsedErrors = parseESLintOutput(stdout);
      errors.push(...parsedErrors);
    }

    if (stderr) {
      const parsedErrors = parseESLintOutput(stderr);
      errors.push(...parsedErrors);
    }
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as unknown as { stdout: string; stderr: string };
      const output = execError.stdout || execError.stderr;
      if (output) {
        const parsedErrors = parseESLintOutput(output);
        errors.push(...parsedErrors);
      }
    } else if (error instanceof Error) {
      errors.push({
        type: 'eslint',
        severity: 'error',
        file: filename,
        message: `ESLint validation failed: ${error.message}`,
      });
    }
  }

  return errors;
}

function parseESLintOutput(output: string): ValidationError[] {
  const errors: ValidationError[] = [];

  try {
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return errors;
    }

    const results = JSON.parse(jsonMatch[0]);

    for (const result of results) {
      for (const message of result.messages || []) {
        if (message.severity >= 2) {
          errors.push({
            type: 'eslint',
            severity: 'error',
            file: result.filePath,
            line: message.line,
            column: message.column,
            message: message.message,
            code: message.ruleId || undefined,
          });
        } else if (message.severity === 1) {
          errors.push({
            type: 'eslint',
            severity: 'warning',
            file: result.filePath,
            line: message.line,
            column: message.column,
            message: message.message,
            code: message.ruleId || undefined,
          });
        }
      }
    }
  } catch (parseError) {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    console.error('[ESLint Validation] Failed to parse ESLint JSON output, falling back to regex parsing');
    console.error('[ESLint Validation] Parse error:', errorMessage);
    console.error('[ESLint Validation] Raw output:', output.slice(0, 500));

    const lines = output.split('\n');
    for (const line of lines) {
      const errorMatch = line.match(/(\d+):(\d+)\s+(.*)/);
      if (errorMatch) {
        const [, lineNum, colNum, message] = errorMatch;
        errors.push({
          type: 'eslint',
          severity: 'error',
          file: 'unknown',
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
          message: message.trim(),
        });
      }
    }
  }

  return errors;
}
