import { tool } from 'ai';
import { z } from 'zod';

export const askUserSchema = z.object({
  question: z
    .string()
    .describe('The question to ask the user'),
  context: z
    .string()
    .describe('Why this question is needed'),
  suggestions: z
    .array(z.string())
    .optional()
    .describe('Suggested answers the user can click'),
});

export type AskUserArgs = z.infer<typeof askUserSchema>;

export async function executeAskUser(args: AskUserArgs): Promise<{ success: boolean; question: string; context: string; suggestions?: string[] }> {
  return {
    success: true,
    question: args.question,
    context: args.context,
    suggestions: args.suggestions,
  };
}

export const askUserTool = tool({
  description: 'Request clarification from the user before continuing. Use this when you need more information to proceed with the task.',
  parameters: askUserSchema,
  execute: async (args: AskUserArgs) => {
    return executeAskUser(args);
  },
});
