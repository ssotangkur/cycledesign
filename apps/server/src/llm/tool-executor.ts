import { statusBroadcaster } from '../features/status/StatusBroadcaster.js';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import {
  executeCreateFile,
  executeEditFile,
  executeRenameFile,
  executeDeleteFile,
  executeAddDependency,
  executeSubmitWork,
  executeAskUser,
} from './tools/tools.js';
import {
  createFileSchema,
  editFileSchema,
  renameFileSchema,
  deleteFileSchema,
  addDependencySchema,
  submitWorkSchema,
  askUserSchema,
} from './tools/tools.js';
import { ValidationService } from '../validation/validation-service.js';
import { normalizeToolName } from './tools/tools.js';

const MAX_LOG_LEN = 2048;

function truncateForLog(value: unknown): string {
  try {
    return JSON.stringify(value).substring(0, MAX_LOG_LEN);
  } catch {
    return String(value).substring(0, MAX_LOG_LEN);
  }
}

function workspaceFilePath(filename: string): string {
  const workspaceDir = process.env.WORKSPACE_DIR || resolve(process.cwd(), 'apps', 'server', 'workspace');
  return join(workspaceDir, 'designs', filename);
}

async function fileSizeOrFallback(filePath: string, fallback?: number): Promise<number | undefined> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return fallback;
  }
}

function getToolStartMessage(tool: string, args: string): string {
  try {
    const parsedArgs = JSON.parse(args);
    const name = normalizeToolName(tool);

    switch (name) {
      case 'add_dependency':
        return `Installing ${parsedArgs.packageName}...`;
      case 'create_file':
        return `Creating ${parsedArgs.filename}...`;
      case 'edit_file':
        return `Editing ${parsedArgs.filename}...`;
      case 'rename_file':
        return `Renaming ${parsedArgs.oldFilename} to ${parsedArgs.newFilename}...`;
      case 'delete_file':
        return `Deleting ${parsedArgs.filename}...`;
      case 'submit_work':
        return `Submitting work for validation...`;
      case 'ask_user':
        return `Asking user: ${parsedArgs.question}`;
      default:
        return `Executing ${tool}...`;
    }
  } catch {
    return `Executing ${tool}...`;
  }
}

function getToolCompleteMessage(tool: string, result: unknown): string {
  const res = result as Record<string, unknown>;
  const name = normalizeToolName(tool);

  switch (name) {
    case 'add_dependency':
      return res.success
        ? `Package ${res.packageName}@${res.version} installed successfully`
        : `Failed to install package: ${res.error}`;
    case 'create_file': {
      if (!res.success) return `Failed to create file: ${res.error}`;
      const bytes = typeof res.bytes === 'number' ? ` (${res.bytes} bytes)` : '';
      const at = typeof res.path === 'string' ? ` at ${res.path}` : '';
      return `File created: ${res.filename}${bytes}${at}`;
    }
    case 'edit_file': {
      if (!res.success) return `Failed to edit file: ${res.error}`;
      const bytes = typeof res.bytes === 'number' ? ` (${res.bytes} bytes)` : '';
      const at = typeof res.path === 'string' ? ` at ${res.path}` : '';
      return `File updated: ${res.filename}${bytes}${at}`;
    }
    case 'rename_file':
      return res.success
        ? `File renamed ${res.oldFilename} -> ${res.newFilename}`
        : `Failed to rename file: ${res.error}`;
    case 'delete_file': {
      if (!res.success) return `Failed to delete file: ${res.error}`;
      const existed = res.existed === false ? ' (did not exist)' : '';
      return `File deleted: ${res.filename}${existed}`;
    }
    case 'submit_work':
      return res.success
        ? `Work submitted successfully: ${(res as { message?: string }).message ?? ''}`.trim()
        : `Work submission failed: ${res.error}`;
    case 'ask_user':
      return res.success
        ? `Waiting for user response: ${res.question ?? ''}`.trim()
        : `Ask user failed: ${res.error}`;
    default:
      return `${tool} completed`;
  }
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

async function executeTool(toolCall: ToolCall, messageId?: string): Promise<unknown> {
  const rawToolName = toolCall.function.name;
  const toolName = normalizeToolName(rawToolName);
  const argsString = toolCall.function.arguments;

  console.log('[TOOL] executeTool called for:', toolName, rawToolName !== toolName ? `(normalized from ${rawToolName})` : '');

  if (!argsString || argsString.trim() === '' || argsString === '{}') {
    return {
      success: false,
      error: `Tool '${toolName}' requires arguments but none were provided. Please ask the user to provide the necessary details.`,
      message: `The ${toolName} tool needs more information to execute. Consider using ask_user tool to get the required arguments from the user.`,
    };
  }

  try {
    const args = JSON.parse(argsString);
    console.log('[TOOL] Parsed args for', toolName + ':', truncateForLog(args));

    switch (toolName) {
      case 'create_file': {
        console.log('[TOOL] Validating create_file schema');
        const validatedArgs = createFileSchema.parse(args);
        console.log('[TOOL] Executing create_file:', validatedArgs.filename);
        const result = await executeCreateFile(validatedArgs, messageId);
        if (result.success) {
          const filePath = workspaceFilePath(validatedArgs.filename);
          const bytes = await fileSizeOrFallback(filePath, validatedArgs.code.length);
          console.log('[TOOL] File created:', validatedArgs.filename, `(${bytes ?? '?'} bytes)`, 'at', filePath);
          return { ...result, path: filePath, bytes };
        }
        return result;
      }
      case 'edit_file': {
        console.log('[TOOL] Validating edit_file schema');
        const validatedArgs = editFileSchema.parse(args);
        console.log('[TOOL] Executing edit_file:', validatedArgs.filename);
        const result = await executeEditFile(validatedArgs);
        if (result.success) {
          const filePath = workspaceFilePath(validatedArgs.filename);
          const bytes = await fileSizeOrFallback(filePath, undefined);
          console.log('[TOOL] File updated:', validatedArgs.filename, `(${bytes ?? '?'} bytes)`, 'at', filePath);
          return { ...result, path: filePath, bytes };
        }
        return result;
      }
      case 'rename_file': {
        console.log('[TOOL] Validating rename_file schema');
        const validatedArgs = renameFileSchema.parse(args);
        console.log('[TOOL] Executing rename_file:', validatedArgs.oldFilename, '->', validatedArgs.newFilename);
        const result = await executeRenameFile(validatedArgs);
        if (result.success) {
          console.log('[TOOL] File renamed:', validatedArgs.oldFilename, '->', validatedArgs.newFilename);
        }
        return result;
      }
      case 'delete_file': {
        console.log('[TOOL] Validating delete_file schema');
        const validatedArgs = deleteFileSchema.parse(args);
        console.log('[TOOL] Executing delete_file:', validatedArgs.filename);
        const result = await executeDeleteFile(validatedArgs);
        if (result.success) {
          console.log('[TOOL] File deleted:', validatedArgs.filename, '(existed)');
          return { ...result, existed: true };
        }
        return result;
      }
      case 'add_dependency': {
        console.log('[TOOL] Validating add_dependency schema');
        const validatedArgs = addDependencySchema.parse(args);
        console.log('[TOOL] Executing add_dependency:', validatedArgs.packageName);
        const result = await executeAddDependency(validatedArgs, messageId);
        if (result.success) {
          console.log('[TOOL] Package installed:', `${validatedArgs.packageName}@${validatedArgs.version ?? result.version ?? 'latest'}`);
        }
        return result;
      }
      case 'submit_work': {
        console.log('[TOOL] Validating submit_work schema');
        submitWorkSchema.parse(args);
        console.log('[TOOL] Executing submit_work');
        const result = await executeSubmitWork();
        console.log('[TOOL] Submit work result:', truncateForLog(result));
        return result;
      }
      case 'ask_user': {
        console.log('[TOOL] Validating ask_user schema');
        const validatedArgs = askUserSchema.parse(args);
        console.log('[TOOL] Executing ask_user:', validatedArgs.question);
        const result = await executeAskUser(validatedArgs);
        console.log('[TOOL] Ask user result:', truncateForLog(result));
        return result;
      }
      default:
        console.error('[TOOL] Unknown tool:', toolName, rawToolName !== toolName ? `(from ${rawToolName})` : '');
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      console.error('[TOOL] Error executing tool', toolName + ':', (error as Error).message, 'issues:', truncateForLog(issues));
    } else {
      console.error('[TOOL] Error executing tool', toolName + ':', (error as Error).message);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to execute tool ${toolName}`);
  }
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  messageId: string
) {
  console.log('[TOOL] executeToolCalls called with', toolCalls.length, 'tool calls for message:', messageId);
  const results = [];
  let shouldRunValidation = false;

  const validationService = new ValidationService();

  for (const toolCall of toolCalls) {
    const toolName = normalizeToolName(toolCall.function.name);
    console.log('[TOOL] Executing tool:', toolName, 'with args:', toolCall.function.arguments.substring(0, MAX_LOG_LEN));

    statusBroadcaster.sendToolCallStart(messageId, toolName, getToolStartMessage(toolName, toolCall.function.arguments));

    try {
      const result = await executeTool(toolCall, messageId);
      console.log('[TOOL] Tool', toolName, 'completed successfully, result:', truncateForLog(result));

      statusBroadcaster.sendToolCallComplete(messageId, toolName, getToolCompleteMessage(toolName, result));

      results.push({
        toolCallId: toolCall.id,
        result,
        success: true,
      });

      if (toolName === 'submit_work') {
        console.log('[TOOL] submit_work detected - validation will run after all tools complete');
        shouldRunValidation = true;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TOOL] Tool', toolName, 'failed:', errorMessage);

      statusBroadcaster.sendToolCallError(messageId, toolName, errorMessage);

      results.push({
        toolCallId: toolCall.id,
        error: errorMessage,
        success: false,
      });

      throw error;
    }
  }

  if (shouldRunValidation) {
    console.log('[TOOL] Running validation pipeline for message:', messageId);
    try {
      const validationResult = await validationService.validateAndPreparePreview(messageId);
      if (!validationResult.success && validationResult.errors) {
        const errorMessages = validationResult.errors.map((e: { message: string }) => e.message).join(', ');
        console.error('[TOOL] Validation failed:', errorMessages);
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      console.log('[TOOL] Validation completed successfully');
    } catch (error) {
      console.error('[TOOL] Validation error:', (error as Error).message);
      statusBroadcaster.sendValidationStart(messageId, 'failed');
      throw error;
    }
  }

  console.log('[TOOL] All', results.length, 'tool calls processed for message:', messageId);
  return results;
}

export { executeTool };
