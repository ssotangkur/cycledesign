import { ToolLoopAgent, stepCountIs, type Tool } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import { allTools } from './tools/index.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { statusBroadcaster } from '../websocket/status-broadcaster.js';
import { getPendingWork, clearPendingWork } from './work-tracker.js';
import { injectIds } from '../parser/id-injector.js';
import { previewManager } from '../preview/preview-manager.js';
import { ValidationPipeline } from '../validation/pipeline.js';
import { join, resolve } from 'path';
import { promises as fs } from 'fs';

// Create Mistral provider
const mistral = createMistral({
  apiKey: process.env.MISTRAL_API_KEY || '',
});

// Helper to get tool start messages
function getToolStartMessage(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'add_dependency':
      return `Installing ${args.packageName}...`;
    case 'create_file':
      return `Creating ${args.filename}...`;
    case 'edit_file':
      return `Editing ${args.filename}...`;
    case 'rename_file':
      return `Renaming ${args.oldFilename} to ${args.newFilename}...`;
    case 'delete_file':
      return `Deleting ${args.filename}...`;
    case 'submit_work':
      return `Submitting work for validation...`;
    case 'ask_user':
      return `Asking user: ${args.question}`;
    default:
      return `Executing ${toolName}...`;
  }
}

// Helper to get tool complete messages
function getToolCompleteMessage(toolName: string, result: unknown): string {
  const res = result as Record<string, unknown>;

  switch (toolName) {
    case 'add_dependency':
      return res.success
        ? `Package ${res.packageName}@${res.version} installed successfully`
        : `Failed to install package: ${res.error}`;
    case 'create_file':
      return res.success
        ? `File created: ${res.filename}`
        : `Failed to create file: ${res.error}`;
    case 'edit_file':
      return res.success
        ? `File updated: ${res.filename}`
        : `Failed to edit file: ${res.error}`;
    case 'rename_file':
      return res.success
        ? `File renamed to ${res.newFilename}`
        : `Failed to rename file: ${res.error}`;
    case 'delete_file':
      return res.success
        ? `File deleted: ${res.filename}`
        : `Failed to delete file: ${res.error}`;
    case 'submit_work':
      return res.success
        ? 'Work submitted successfully'
        : `Work submission failed: ${res.error}`;
    case 'ask_user':
      return 'Waiting for user response';
    default:
      return `${toolName} completed`;
  }
}

// Handle validation and preview after submit_work
async function handleValidationAndPreview(
  messageId: string
): Promise<{ success: boolean; errors?: Array<{ type: string; message: string }> }> {
  const pendingWork = getPendingWork(messageId);

  if (!pendingWork || pendingWork.files.size === 0) {
    return { success: true };
  }

  for (const [filename, { code }] of pendingWork.files) {
    statusBroadcaster.sendValidationStart(messageId, 'dependency check');
    const dependencyErrors = await checkDependencies(code, filename);
    if (dependencyErrors.length > 0) {
      return { success: false, errors: dependencyErrors.map((e) => ({ type: e.type, message: e.message })) };
    }

    statusBroadcaster.sendValidationStart(messageId, 'TypeScript compilation');
    const tsErrors = await validateTypeScript(code, filename);
    if (tsErrors.length > 0) {
      return { success: false, errors: tsErrors.map((e) => ({ type: e.type, message: e.message })) };
    }

    statusBroadcaster.sendValidationStart(messageId, 'ESLint check');
    const eslintErrors = await validateESLint(code, filename);
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

    statusBroadcaster.sendValidationComplete(messageId);

    statusBroadcaster.sendPreviewStart(messageId);
    await previewManager.start({ designName: filename.replace('.tsx', '') });
    const status = previewManager.getStatus();
    if (status.port) {
      statusBroadcaster.sendPreviewReady(messageId, status.port);
    }
  }

  clearPendingWork(messageId);
  return { success: true };
}

async function checkDependencies(code: string, filename: string) {
  const pipeline = new ValidationPipeline(
    join(process.cwd(), 'apps', 'preview'),
    process.cwd()
  );
  const result = await pipeline.validate(code, filename);
  return result.errors;
}

async function validateTypeScript(code: string, filename: string): Promise<Array<{ type: string; message: string }>> {
  const mod = await import('../validation/typescript.js');
  return mod.validateTypeScript(code, filename, join(process.cwd(), 'apps', 'preview'));
}

async function validateESLint(code: string, filename: string): Promise<Array<{ type: string; message: string; severity?: string }>> {
  const mod = await import('../validation/eslint.js');
  return mod.validateESLint(code, filename, join(process.cwd(), 'apps', 'preview'), process.cwd());
}

// Create the agent with ToolLoopAgent
export function createAgent(messageId: string) {
  const model = mistral('codestral-2508');

  return new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools: allTools as Record<string, Tool>,
    stopWhen: stepCountIs(10),

    // Called when the agent operation begins
    experimental_onStart: (_event) => {
      console.log('[AGENT] Starting agent for message:', messageId);
      statusBroadcaster.sendGenerationStart(messageId);
    },

    // Called when each step (LLM call) begins
    experimental_onStepStart: (_event) => {
      console.log('[AGENT] Step', _event.stepNumber, 'starting for message:', messageId);
      statusBroadcaster.sendGenerationThinking(messageId);
    },

    // Called right before a tool's execute function runs
    experimental_onToolCallStart: (event) => {
      const toolName = event.toolCall.toolName;
      const args = event.toolCall.input as Record<string, unknown>;
      console.log('[AGENT] Tool starting:', toolName);
      statusBroadcaster.sendToolCallStart(
        messageId,
        toolName,
        getToolStartMessage(toolName, args)
      );
    },

    // Called right after a tool's execute function completes
    experimental_onToolCallFinish: async (event) => {
      const toolName = event.toolCall.toolName;
      console.log('[AGENT] Tool finished:', toolName);

      const message = event.success
        ? getToolCompleteMessage(toolName, event.output)
        : `Tool error: ${event.error}`;

      statusBroadcaster.sendToolCallComplete(messageId, toolName, message);

      // Handle submit_work - run validation
      if (toolName === 'submit_work' && event.success) {
        try {
          const validationResult = await handleValidationAndPreview(messageId);
          if (!validationResult.success && validationResult.errors) {
            const errorMessages = validationResult.errors.map((e) => e.message).join(', ');
            throw new Error(`Validation failed: ${errorMessages}`);
          }
        } catch (error) {
          statusBroadcaster.sendValidationStart(messageId, 'failed');
          throw error;
        }
      }
    },

    // Called after each agent step completes
    onStepFinish: (event) => {
      console.log('[AGENT] Step', event.stepNumber, 'finished for message:', messageId);
    },

    // Called when all agent steps are finished
    onFinish: (_event) => {
      console.log('[AGENT] Agent finished for message:', messageId);
      statusBroadcaster.sendGenerationComplete(messageId, _event.response.text);
    },
  });
}

// Run agent with a prompt
export async function runAgent(messageId: string, prompt: string) {
  const agent = createAgent(messageId);

  const result = await agent.generate({
    prompt,
  });

  return result;
}
