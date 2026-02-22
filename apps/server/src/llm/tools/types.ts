export interface ToolExecutionResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}
