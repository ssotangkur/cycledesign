import { ToolLoopAgent, stepCountIs, type Tool } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import { allTools } from './tools/tools.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { wsBridge } from '../server.js';
import { ValidationService } from '../validation/validation-service.js';

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

// Create the agent with ToolLoopAgent
export function createAgent(messageId: string, sessionId: string) {
  const model = mistral('codestral-2508');

  const validationService = new ValidationService();

  // Register session for WebSocket routing
  wsBridge.registerSession(messageId, sessionId);

  return new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools: allTools as Record<string, Tool>,
    stopWhen: stepCountIs(10),

    // Called when the agent operation begins
    experimental_onStart: (_event) => {
      console.log('[AGENT] Starting agent for message:', messageId);
      wsBridge.broadcastStatusByMessageId(messageId, {
        status: 'generation_start',
        details: 'Starting AI generation...',
        timestamp: Date.now(),
      });
    },

    // Called when each step (LLM call) begins
    experimental_onStepStart: (_event) => {
      console.log('[AGENT] Step', _event.stepNumber, 'starting for message:', messageId);
      wsBridge.broadcastStatusByMessageId(messageId, {
        status: 'generation_thinking',
        details: 'AI is thinking...',
        timestamp: Date.now(),
      });
    },

    // Called right before a tool's execute function runs
    experimental_onToolCallStart: (event) => {
      const toolName = event.toolCall.toolName;
      const args = event.toolCall.input as Record<string, unknown>;
      console.log('[AGENT] Tool starting:', toolName);
      wsBridge.broadcastStatusByMessageId(messageId, {
        status: 'tool_call_start',
        tool: toolName,
        details: getToolStartMessage(toolName, args),
        timestamp: Date.now(),
      });
    },

    // Called right after a tool's execute function completes
    experimental_onToolCallFinish: async (event) => {
      const toolName = event.toolCall.toolName;
      console.log('[AGENT] Tool finished:', toolName);

      const message = event.success
        ? getToolCompleteMessage(toolName, event.output)
        : `Tool error: ${event.error}`;

      wsBridge.broadcastStatusByMessageId(messageId, {
        status: 'tool_call_complete',
        tool: toolName,
        details: message,
        timestamp: Date.now(),
      });

      // Handle submit_work - run validation
      if (toolName === 'submit_work' && event.success) {
        try {
          const validationResult = await validationService.validateAndPreparePreview(messageId);
          if (!validationResult.success && validationResult.errors) {
            const errorMessages = validationResult.errors.map((e) => e.message).join(', ');
            throw new Error(`Validation failed: ${errorMessages}`);
          }
        } catch (error) {
          wsBridge.broadcastStatusByMessageId(messageId, {
            status: 'validation_start',
            details: 'failed',
            timestamp: Date.now(),
          });
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
      wsBridge.broadcastStatusByMessageId(messageId, {
        status: 'generation_complete',
        details: _event.text,
        timestamp: Date.now(),
      });
    },
  });
}

// Run agent with a prompt
export async function runAgent(messageId: string, sessionId: string, prompt: string) {
  const agent = createAgent(messageId, sessionId);

  const result = await agent.generate({
    prompt,
  });

  return result;
}
