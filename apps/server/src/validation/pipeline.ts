import { ValidationError, ValidationResult } from './types';
import { validateTypeScript } from './typescript';
import { validateESLint } from './eslint';
import { validateKnip } from './knip';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export class ValidationPipeline {
  private previewDir: string;
  private serverDir: string;

  constructor(previewDir: string, serverDir: string) {
    this.previewDir = previewDir;
    this.serverDir = serverDir;
  }

  async validate(code: string, filename: string): Promise<ValidationResult> {
    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationError[] = [];

    const dependencyErrors = await this.checkDependencies(code, filename);
    allErrors.push(...dependencyErrors);

    if (dependencyErrors.length === 0) {
      const [tsErrors, eslintErrors, knipErrors] = await Promise.all([
        validateTypeScript(code, filename, this.previewDir),
        validateESLint(code, filename, this.previewDir, this.serverDir),
        validateKnip(this.previewDir),
      ]);

      for (const error of tsErrors) {
        if (error.severity === 'error') {
          allErrors.push(error);
        } else {
          allWarnings.push(error);
        }
      }

      for (const error of eslintErrors) {
        if (error.severity === 'error') {
          allErrors.push(error);
        } else {
          allWarnings.push(error);
        }
      }

      for (const error of knipErrors) {
        allWarnings.push(error);
      }
    }

    return {
      success: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  private async checkDependencies(
    code: string,
    filename: string
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    const importPattern = /(?:import|from)\s+['"]([^'"]+)['"]/g;
    const imports = new Set<string>();
    let match;

    while ((match = importPattern.exec(code)) !== null) {
      const importPath = match[1];
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        const packageName = importPath.split('/')[0];
        const scopedMatch = importPath.match(/^(@[^/]+\/[^/]+)/);
        if (scopedMatch) {
          imports.add(scopedMatch[1]);
        } else {
          imports.add(packageName);
        }
      }
    }

    const packageJsonPath = join(this.previewDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return errors;
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const installedDeps = new Set([
        ...Object.keys(packageJson.dependencies || {}),
        ...Object.keys(packageJson.devDependencies || {}),
      ]);

      for (const pkg of imports) {
        if (!installedDeps.has(pkg) && !this.isBuiltInModule(pkg)) {
          errors.push({
            type: 'dependency',
            severity: 'error',
            file: filename,
            message: `Missing dependency: ${pkg}`,
            suggestion: `Run: npm install ${pkg}`,
          });
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        errors.push({
          type: 'dependency',
          severity: 'error',
          file: filename,
          message: `Failed to read package.json: ${error.message}`,
        });
      }
    }

    return errors;
  }

  private isBuiltInModule(moduleName: string): boolean {
    const builtIns = [
      'fs', 'path', 'http', 'https', 'os', 'util', 'events',
      'stream', 'buffer', 'querystring', 'url', 'crypto',
    ];
    return builtIns.includes(moduleName);
  }
}
