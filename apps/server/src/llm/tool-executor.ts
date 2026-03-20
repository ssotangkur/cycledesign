import { statusBroadcaster } from '../features/status/StatusBroadcaster.js';
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

function getToolStartMessage(tool: string, args: string): string {
  try {
    const parsedArgs = JSON.parse(args);
    
    switch (tool) {
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
  
  switch (tool) {
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
  const toolName = toolCall.function.name;
  const argsString = toolCall.function.arguments;
  
  console.log('[TOOL] executeTool called for:', toolName);
  
  if (!argsString || argsString.trim() === '' || argsString === '{}') {
    return {
      success: false,
      error: `Tool '${toolName}' requires arguments but none were provided. Please ask the user to provide the necessary details.`,
      message: `The ${toolName} tool needs more information to execute. Consider using ask_user tool to get the required arguments from the user.`,
    };
  }
  
  try {
    const args = JSON.parse(argsString);
    console.log('[TOOL] Parsed args for', toolName + ':', JSON.stringify(args).substring(0, 150));
    
    switch (toolName) {
      case 'create_file': {
        console.log('[TOOL] Validating create_file schema');
        const validatedArgs = createFileSchema.parse(args);
        console.log('[TOOL] Executing create_file:', validatedArgs.filename);
        return await executeCreateFile(validatedArgs, messageId);
      }
      case 'edit_file': {
        console.log('[TOOL] Validating edit_file schema');
        const validatedArgs = editFileSchema.parse(args);
        console.log('[TOOL] Executing edit_file:', validatedArgs.filename);
        return await executeEditFile(validatedArgs);
      }
      case 'rename_file': {
        console.log('[TOOL] Validating rename_file schema');
        const validatedArgs = renameFileSchema.parse(args);
        console.log('[TOOL] Executing rename_file:', validatedArgs.oldFilename, '->', validatedArgs.newFilename);
        return await executeRenameFile(validatedArgs);
      }
      case 'delete_file': {
        console.log('[TOOL] Validating delete_file schema');
        const validatedArgs = deleteFileSchema.parse(args);
        console.log('[TOOL] Executing delete_file:', validatedArgs.filename);
        return await executeDeleteFile(validatedArgs);
      }
      case 'add_dependency': {
        console.log('[TOOL] Validating add_dependency schema');
        const validatedArgs = addDependencySchema.parse(args);
        console.log('[TOOL] Executing add_dependency:', validatedArgs.packageName);
        return await executeAddDependency(validatedArgs, messageId);
      }
      case 'submit_work': {
        console.log('[TOOL] Validating submit_work schema');
        submitWorkSchema.parse(args);
        console.log('[TOOL] Executing submit_work');
        return await executeSubmitWork();
      }
      case 'ask_user': {
        console.log('[TOOL] Validating ask_user schema');
        const validatedArgs = askUserSchema.parse(args);
        console.log('[TOOL] Executing ask_user:', validatedArgs.question);
        return await executeAskUser(validatedArgs);
      }
      default:
        console.error('[TOOL] Unknown tool:', toolName);
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error('[TOOL] Error executing tool', toolName + ':', (error as Error).message);
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
    const toolName = toolCall.function.name;
    console.log('[TOOL] Executing tool:', toolName, 'with args:', toolCall.function.arguments);

    statusBroadcaster.sendToolCallStart(messageId, toolName, getToolStartMessage(toolName, toolCall.function.arguments));

    try {
      const result = await executeTool(toolCall, messageId);
      console.log('[TOOL] Tool', toolName, 'completed successfully, result:', JSON.stringify(result).substring(0, 200));

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
