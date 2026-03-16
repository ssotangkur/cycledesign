import { statusBroadcaster } from '../features/status/StatusBroadcaster.js';
import { ValidationPipeline } from './pipeline.js';
import { injectIds } from '../parser/id-injector.js';
import { previewManager } from '../preview/preview-manager.js';
import { getPendingWork, clearPendingWork } from '../llm/work-tracker.js';
import { join, resolve } from 'path';
import { promises as fs } from 'fs';

export interface ValidationError {
  type: string;
  message: string;
  severity?: string;
}

export interface ValidationResult {
  success: boolean;
  errors?: ValidationError[];
}

export class ValidationService {
  constructor() {
  }

  async validateAndPreparePreview(messageId: string): Promise<ValidationResult> {
    const pendingWork = this.getPendingWork(messageId);

    if (!pendingWork || pendingWork.files.size === 0) {
      return { success: true };
    }

    for (const [filename, { code }] of pendingWork.files) {
      statusBroadcaster.sendValidationStart(messageId, 'dependency check');
      const dependencyErrors = await this.checkDependencies(code, filename);
      if (dependencyErrors.length > 0) {
        return { success: false, errors: dependencyErrors.map((e) => ({ type: e.type, message: e.message })) };
      }

      statusBroadcaster.sendValidationStart(messageId, 'TypeScript compilation');
      const tsErrors = await this.validateTypeScript(code, filename);
      if (tsErrors.length > 0) {
        return { success: false, errors: tsErrors.map((e) => ({ type: e.type, message: e.message })) };
      }

      statusBroadcaster.sendValidationStart(messageId, 'ESLint check');
      const eslintErrors = await this.validateESLint(code, filename);
      if (eslintErrors.length > 0) {
        const errorErrors = eslintErrors.filter((e) => e.severity === 'error');
        if (errorErrors.length > 0) {
          return { success: false, errors: errorErrors.map((e) => ({ type: e.type, message: e.message })) };
        }
      }

      statusBroadcaster.sendValidationStart(messageId, 'ID injection');
      const injectedCode = injectIds(code, new Set(), filename.replace('.tsx', ''));

      const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
      const filePath = join(workspaceDir, 'designs', filename);
      await fs.mkdir(join(workspaceDir, 'designs'), { recursive: true });
      await fs.writeFile(filePath, injectedCode.code, 'utf-8');

      statusBroadcaster.sendValidationComplete(messageId, 'Validation completed successfully');

      statusBroadcaster.sendPreviewStart(messageId, 'Starting preview server');
      await previewManager.start({ designName: filename.replace('.tsx', '') });
      const status = previewManager.getStatus();
      if (status.port) {
        statusBroadcaster.sendPreviewReady(messageId, status.port, 'Preview server is ready');
      }
    }

    this.clearPendingWork(messageId);
    return { success: true };
  }

  async checkDependencies(code: string, filename: string): Promise<ValidationError[]> {
    const pipeline = new ValidationPipeline(
      join(process.cwd(), 'apps', 'preview'),
      process.cwd()
    );
    const result = await pipeline.validate(code, filename);
    return result.errors;
  }

  async validateTypeScript(code: string, filename: string): Promise<ValidationError[]> {
    const mod = await import('./typescript.js');
    return mod.validateTypeScript(code, filename, join(process.cwd(), 'apps', 'preview'));
  }

  async validateESLint(code: string, filename: string): Promise<ValidationError[]> {
    const mod = await import('./eslint.js');
    return mod.validateESLint(code, filename, join(process.cwd(), 'apps', 'preview'), process.cwd());
  }

  private getPendingWork(messageId: string) {
    return getPendingWork(messageId);
  }

  private clearPendingWork(messageId: string) {
    clearPendingWork(messageId);
  }
}
