#!/usr/bin/env node

/**
 * Chat Log Parser - Parse Qwen Code JSONL chat logs into human-readable transcripts
 *
 * Usage:
 *   npx tsx parse-chat-log.ts [options]
 *
 * Options:
 *   --session <uuid>     Load specific session by UUID
 *   --file <path>        Load specific JSONL file path
 *   --speaker <type>     Filter by speaker type (user|assistant|subagent|system)
 *   --agent <name>       Filter by agent name (e.g., issue-resolver)
 *   --tool <name>        Filter by tool name (e.g., run_shell_command)
 *   --search <regex>     Search messages by regex pattern
 *   --format <type>      Output format: text|markdown|json (default: text)
 *   --flatten            Don't indent nested conversations
 *   --no-color           Disable ANSI color codes
 *   --truncate <n>       Truncate messages to n characters (default: 500)
 *   --help               Show help
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// TypeScript Interfaces for JSONL Schema
// ============================================================================

interface ChatMessage {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'system' | 'tool_result';
  message?: {
    role: string;
    content?: string;
    parts?: Array<{
      text?: string;
      thought?: boolean;
      functionCall?: {
        id: string;
        name: string;
        args: Record<string, unknown>;
      };
    }>;
  };
  subtype?: string;
  systemPayload?: Record<string, unknown>;
  prompt_id?: string;
  toolCalls?: Array<{
    name: string;
    arguments: string;
    result?: string;
  }>;
  [key: string]: unknown;
}

interface ParsedMessage {
  timestamp: string;
  speaker: 'user' | 'assistant' | 'subagent' | 'system';
  agentName: string | null;
  depth: number;
  content: string;
  toolCalls: Array<{ name: string; arguments: string; result?: string }>;
  parentUuid: string | null;
  uuid: string;
  type: string;
  subtype?: string;
}

interface SessionInfo {
  id: string;
  project: string;
  started: string;
  ended: string;
  durationMs: number;
}

interface SessionStatistics {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  subagentMessages: number;
  systemMessages: number;
  toolCalls: number;
  apiErrors: number;
  tokensUsed: number;
}

interface ParsedOutput {
  session: SessionInfo;
  messages: ParsedMessage[];
  statistics: SessionStatistics;
}

// ============================================================================
// ANSI Color Codes
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  user: '\x1b[36m',        // Cyan
  assistant: '\x1b[32m',   // Green
  subagent: '\x1b[33m',    // Yellow
  system: '\x1b[90m',      // Gray
  thinking: '\x1b[35m',    // Magenta
  toolCall: '\x1b[34m',    // Blue
  result: '\x1b[32m',      // Green
  error: '\x1b[31m',       // Red
  header: '\x1b[1;36m',    // Bold Cyan
  separator: '\x1b[90m',   // Gray
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  session?: string;
  file?: string;
  speaker?: string;
  agent?: string;
  tool?: string;
  search?: string;
  format: 'text' | 'markdown' | 'json';
  flatten: boolean;
  noColor: boolean;
  truncate: number;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    format: 'text',
    flatten: false,
    noColor: false,
    truncate: 500,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--session':
        options.session = args[++i];
        break;
      case '--file':
        options.file = args[++i];
        break;
      case '--speaker':
        options.speaker = args[++i];
        break;
      case '--agent':
        options.agent = args[++i];
        break;
      case '--tool':
        options.tool = args[++i];
        break;
      case '--search':
        options.search = args[++i];
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'markdown' | 'json';
        break;
      case '--flatten':
        options.flatten = true;
        break;
      case '--no-color':
        options.noColor = true;
        break;
      case '--truncate':
        options.truncate = parseInt(args[++i], 10);
        break;
      case '--help':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateUuidFormat(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function validateSpeakerType(speaker: string): boolean {
  return ['user', 'assistant', 'subagent', 'system'].includes(speaker);
}

function validateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

function validateRequiredFields(line: Record<string, unknown>, lineNum: number): string[] {
  const errors: string[] = [];
  if (!line.uuid) errors.push(`Line ${lineNum}: Missing required field 'uuid'`);
  if (!line.timestamp) errors.push(`Line ${lineNum}: Missing required field 'timestamp'`);
  if (!line.type) errors.push(`Line ${lineNum}: Missing required field 'type'`);
  return errors;
}

// ============================================================================
// File Discovery
// ============================================================================

function findLatestChatLog(): string | null {
  const homeDir = os.homedir();
  const projectsDir = path.join(homeDir, '.qwen', 'projects');

  if (!fs.existsSync(projectsDir)) {
    console.error(`Error: Projects directory not found: ${projectsDir}`);
    process.exit(1);
  }

  // Find all project directories
  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(projectsDir, dirent.name));

  if (projectDirs.length === 0) {
    console.error('Error: No project directories found');
    process.exit(1);
  }

  // Find all JSONL files across all projects
  const jsonlFiles: Array<{ path: string; mtime: Date }> = [];

  for (const projectDir of projectDirs) {
    const chatsDir = path.join(projectDir, 'chats');
    if (!fs.existsSync(chatsDir)) continue;

    const files = fs.readdirSync(chatsDir, { withFileTypes: true })
      .filter(dirent => dirent.isFile() && dirent.name.endsWith('.jsonl'))
      .map(dirent => {
        const filePath = path.join(chatsDir, dirent.name);
        const stat = fs.statSync(filePath);
        return { path: filePath, mtime: stat.mtime };
      });

    jsonlFiles.push(...files);
  }

  if (jsonlFiles.length === 0) {
    console.error('Error: No chat log files found');
    process.exit(1);
  }

  // Return the most recently modified file
  jsonlFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return jsonlFiles[0].path;
}

function findChatLogBySession(sessionId: string): string | null {
  const homeDir = os.homedir();
  const projectsDir = path.join(homeDir, '.qwen', 'projects');

  if (!fs.existsSync(projectsDir)) {
    console.error(`Error: Projects directory not found: ${projectsDir}`);
    process.exit(1);
  }

  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(projectsDir, dirent.name));

  for (const projectDir of projectDirs) {
    const chatsDir = path.join(projectDir, 'chats');
    if (!fs.existsSync(chatsDir)) continue;

    const sessionFile = path.join(chatsDir, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      return sessionFile;
    }
  }

  return null;
}

// ============================================================================
// JSONL Parsing
// ============================================================================

function parseJsonlFile(filePath: string): { messages: ChatMessage[]; warnings: string[] } {
  const messages: ChatMessage[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // Handle BOM
  const cleanedContent = content.replace(/^\uFEFF/, '');
  const lines = cleanedContent.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    console.error('Error: Empty chat log file');
    process.exit(1);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const validationErrors = validateRequiredFields(parsed, i + 1);

      if (validationErrors.length > 0) {
        warnings.push(...validationErrors);
        continue;
      }

      messages.push(parsed as ChatMessage);
    } catch (error) {
      warnings.push(`Line ${i + 1}: Invalid JSON - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Sort by timestamp
  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return { messages, warnings };
}

// ============================================================================
// Speaker Identification
// ============================================================================

function identifySpeaker(message: ChatMessage): { speaker: ParsedMessage['speaker']; agentName: string | null } {
  if (message.type === 'user') {
    return { speaker: 'user', agentName: null };
  }

  if (message.type === 'system') {
    return { speaker: 'system', agentName: null };
  }

  if (message.type === 'tool_result') {
    return { speaker: 'system', agentName: null };
  }

  if (message.type === 'assistant') {
    // Check if this is a subagent message by looking at prompt_id
    const promptId = message.prompt_id as string | undefined;
    if (promptId) {
      // Extract agent name from prompt_id (e.g., "#issue-resolver-*" -> "issue-resolver")
      const match = promptId.match(/^#([a-z0-9-]+)-/i);
      if (match) {
        return { speaker: 'subagent', agentName: match[1] };
      }
    }
    return { speaker: 'assistant', agentName: null };
  }

  return { speaker: 'system', agentName: null };
}

// ============================================================================
// Parent-Child Hierarchy
// ============================================================================

function buildHierarchy(messages: ChatMessage[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const messageMap = new Map<string, ChatMessage>();

  // Build lookup map
  for (const msg of messages) {
    messageMap.set(msg.uuid, msg);
  }

  // Calculate depth for each message
  for (const msg of messages) {
    let depth = 0;
    let currentUuid: string | undefined = msg.parentUuid;

    while (currentUuid && messageMap.has(currentUuid)) {
      depth++;
      const parent = messageMap.get(currentUuid);
      currentUuid = parent?.parentUuid;
    }

    depthMap.set(msg.uuid, depth);
  }

  return depthMap;
}

// ============================================================================
// Message Formatting
// ============================================================================

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function formatTimeOnly(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toTimeString().substring(0, 8);
}

function truncateMessage(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + ' [...truncated]';
}

function colorize(text: string, color: string, noColor: boolean): string {
  if (noColor) return text;
  return `${COLORS[color as keyof typeof COLORS]}${text}${COLORS.reset}`;
}

function formatContent(content: string, options: {
  noColor: boolean;
  truncate: number;
  speaker: ParsedMessage['speaker'];
}): string {
  const { noColor, truncate, speaker } = options;
  let formatted = content;

  // Truncate if needed
  if (truncate > 0 && formatted.length > truncate) {
    formatted = truncateMessage(formatted, truncate);
  }

  // Clean up whitespace
  formatted = formatted.replace(/\n+/g, '\n').trim();

  return formatted;
}

function formatParsedMessage(msg: ParsedMessage, options: CliOptions): string {
  const { noColor, truncate, flatten } = options;
  const indent = flatten ? '' : '  '.repeat(msg.depth);
  const timeStr = formatTimeOnly(msg.timestamp);

  // Format speaker with color
  let speakerTag: string;
  let color: string;

  if (msg.speaker === 'user') {
    speakerTag = 'User';
    color = 'user';
  } else if (msg.speaker === 'subagent') {
    speakerTag = msg.agentName || 'Subagent';
    color = 'subagent';
  } else if (msg.speaker === 'assistant') {
    speakerTag = 'Qwen';
    color = 'assistant';
  } else {
    speakerTag = 'System';
    color = 'system';
  }

  let output = `${indent}[${colorize(timeStr, 'dim', noColor)}] ${colorize(speakerTag + ':', color, noColor)}`;

  // Format content sections
  const content = formatContent(msg.content, { noColor, truncate, speaker: msg.speaker });

  if (content) {
    // Check for thinking/reasoning content
    if (content.includes('[Thinking]') || content.toLowerCase().includes('thinking') || msg.subtype === 'thinking') {
      output += ` ${colorize('[Thinking]', 'thinking', noColor)} ${content.replace(/\[Thinking\]/gi, '').trim()}`;
    } else {
      output += ` ${content}`;
    }
  }

  // Format tool calls
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const toolCall of msg.toolCalls) {
      output += `\n${indent}             ${colorize('[ToolCall]', 'toolCall', noColor)} ${toolCall.name}`;
      if (toolCall.arguments && toolCall.arguments !== '{}') {
        const args = toolCall.arguments.substring(0, 100);
        output += ` (${args}${toolCall.arguments.length > 100 ? '...' : ''})`;
      }
      if (toolCall.result) {
        output += `\n${indent}             ${colorize('[Result]', 'result', noColor)} ${truncateMessage(toolCall.result, 100)}`;
      }
    }
  }

  // Format system payloads
  if (msg.subtype && msg.speaker === 'system') {
    output += ` ${colorize(`[${msg.subtype}]`, 'system', noColor)}`;
  }

  return output;
}

// ============================================================================
// Statistics Calculation
// ============================================================================

function calculateStatistics(messages: ParsedMessage[]): SessionStatistics {
  const stats: SessionStatistics = {
    totalMessages: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    subagentMessages: 0,
    systemMessages: 0,
    toolCalls: 0,
    apiErrors: 0,
    tokensUsed: 0,
  };

  for (const msg of messages) {
    switch (msg.speaker) {
      case 'user':
        stats.userMessages++;
        break;
      case 'assistant':
        stats.assistantMessages++;
        break;
      case 'subagent':
        stats.subagentMessages++;
        break;
      case 'system':
        stats.systemMessages++;
        break;
    }

    if (msg.toolCalls) {
      stats.toolCalls += msg.toolCalls.length;
    }

    if (msg.content.toLowerCase().includes('error') || msg.content.toLowerCase().includes('429')) {
      stats.apiErrors++;
    }
  }

  // Estimate tokens (rough estimate: ~4 chars per token)
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  stats.tokensUsed = Math.round(totalChars / 4);

  return stats;
}

function calculateSessionInfo(messages: ChatMessage[], filePath: string): SessionInfo {
  const timestamps = messages.map(m => new Date(m.timestamp).getTime());
  const started = Math.min(...timestamps);
  const ended = Math.max(...timestamps);

  // Extract project from file path
  const projectMatch = filePath.match(/\.qwen\/projects\/([^/]+)/);
  const project = projectMatch ? projectMatch[1].replace(/-/g, '/') : 'Unknown';

  return {
    id: messages[0]?.sessionId || 'Unknown',
    project: `/${project.replace(/^-/, '')}`,
    started: new Date(started).toISOString(),
    ended: new Date(ended).toISOString(),
    durationMs: ended - started,
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

// ============================================================================
// Filtering
// ============================================================================

function filterMessages(
  messages: ParsedMessage[],
  options: CliOptions
): ParsedMessage[] {
  let filtered = messages;

  // Filter by speaker
  if (options.speaker) {
    filtered = filtered.filter(msg => msg.speaker === options.speaker);
  }

  // Filter by agent name
  if (options.agent) {
    filtered = filtered.filter(msg =>
      msg.agentName?.toLowerCase().includes(options.agent!.toLowerCase())
    );
  }

  // Filter by tool
  if (options.tool) {
    filtered = filtered.filter(msg =>
      msg.toolCalls?.some(tc => tc.name.toLowerCase().includes(options.tool!.toLowerCase()))
    );
  }

  // Filter by regex search
  if (options.search) {
    const regex = validateRegex(options.search);
    if (!regex) {
      console.error(`Error: Invalid regex pattern: ${options.search}`);
      process.exit(1);
    }
    filtered = filtered.filter(msg =>
      regex.test(msg.content) ||
      msg.toolCalls?.some(tc => regex.test(tc.name) || regex.test(tc.arguments))
    );
  }

  return filtered;
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatTextOutput(parsed: ParsedOutput, options: CliOptions): string {
  const { noColor } = options;
  const lines: string[] = [];

  // Header
  const separator = '='.repeat(80);
  lines.push(colorize(separator, 'separator', noColor));
  lines.push(colorize(`Session: ${parsed.session.id}`, 'header', noColor));
  lines.push(colorize(`Project: ${parsed.session.project}`, 'header', noColor));
  lines.push(colorize(`Started: ${formatTimestamp(parsed.session.started)}`, 'header', noColor));
  lines.push(colorize(`Duration: ${formatDuration(parsed.session.durationMs)}`, 'header', noColor));
  lines.push(colorize(`Total Messages: ${parsed.statistics.totalMessages}`, 'header', noColor));
  lines.push(colorize(`Tokens Used: ~${formatTokenCount(parsed.statistics.tokensUsed)}`, 'header', noColor));
  lines.push(colorize(separator, 'separator', noColor));
  lines.push('');

  // Messages
  for (const msg of parsed.messages) {
    lines.push(formatParsedMessage(msg, options));
    lines.push('');
  }

  // Statistics
  lines.push(colorize(separator, 'separator', noColor));
  lines.push(colorize('Session Statistics:', 'header', noColor));
  lines.push(`- User Messages: ${parsed.statistics.userMessages}`);
  lines.push(`- Assistant Messages: ${parsed.statistics.assistantMessages}`);
  lines.push(`- Subagent Messages: ${parsed.statistics.subagentMessages}`);
  lines.push(`- System Messages: ${parsed.statistics.systemMessages}`);
  lines.push(`- Tool Calls: ${parsed.statistics.toolCalls}`);
  lines.push(`- API Errors: ${parsed.statistics.apiErrors}`);
  lines.push(colorize(separator, 'separator', noColor));

  return lines.join('\n');
}

function formatMarkdownOutput(parsed: ParsedOutput, options: CliOptions): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Session: ${parsed.session.id}`);
  lines.push('');
  lines.push(`- **Project**: ${parsed.session.project}`);
  lines.push(`- **Started**: ${formatTimestamp(parsed.session.started)}`);
  lines.push(`- **Duration**: ${formatDuration(parsed.session.durationMs)}`);
  lines.push(`- **Total Messages**: ${parsed.statistics.totalMessages}`);
  lines.push(`- **Tokens Used**: ~${formatTokenCount(parsed.statistics.tokensUsed)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of parsed.messages) {
    const indent = options.flatten ? '' : '  '.repeat(msg.depth);
    const timeStr = formatTimeOnly(msg.timestamp);

    let speakerTag: string;
    if (msg.speaker === 'user') {
      speakerTag = 'User';
    } else if (msg.speaker === 'subagent') {
      speakerTag = msg.agentName || 'Subagent';
    } else if (msg.speaker === 'assistant') {
      speakerTag = 'Qwen';
    } else {
      speakerTag = 'System';
    }

    lines.push(`### [${timeStr}] ${speakerTag}`);
    lines.push('');

    if (msg.content) {
      lines.push(`${indent}${msg.content}`);
      lines.push('');
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const toolCall of msg.toolCalls) {
        lines.push(`${indent}**[ToolCall]** \`${toolCall.name}\``);
        if (toolCall.result) {
          lines.push(`${indent}**[Result]** ${truncateMessage(toolCall.result, 200)}`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Statistics
  lines.push('## Session Statistics');
  lines.push('');
  lines.push(`- User Messages: ${parsed.statistics.userMessages}`);
  lines.push(`- Assistant Messages: ${parsed.statistics.assistantMessages}`);
  lines.push(`- Subagent Messages: ${parsed.statistics.subagentMessages}`);
  lines.push(`- System Messages: ${parsed.statistics.systemMessages}`);
  lines.push(`- Tool Calls: ${parsed.statistics.toolCalls}`);
  lines.push(`- API Errors: ${parsed.statistics.apiErrors}`);

  return lines.join('\n');
}

function formatJsonOutput(parsed: ParsedOutput): string {
  return JSON.stringify(parsed, null, 2);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return tokens.toString();
}

// ============================================================================
// Help Text
// ============================================================================

function showHelp(): void {
  console.log(`
Chat Log Parser - Parse Qwen Code JSONL chat logs into human-readable transcripts

Usage:
  npx tsx parse-chat-log.ts [options]

Options:
  --session <uuid>     Load specific session by UUID
  --file <path>        Load specific JSONL file path
  --speaker <type>     Filter by speaker type (user|assistant|subagent|system)
  --agent <name>       Filter by agent name (e.g., issue-resolver)
  --tool <name>        Filter by tool name (e.g., run_shell_command)
  --search <regex>     Search messages by regex pattern
  --format <type>      Output format: text|markdown|json (default: text)
  --flatten            Don't indent nested conversations
  --no-color           Disable ANSI color codes
  --truncate <n>       Truncate messages to n characters (default: 500)
  --help               Show this help message

Examples:
  # Parse latest session
  npx tsx parse-chat-log.ts

  # Parse specific session
  npx tsx parse-chat-log.ts --session 68eb68a6-a83e-40ca-9e63-0711709426da

  # Filter by speaker
  npx tsx parse-chat-log.ts --speaker subagent

  # Filter by agent
  npx tsx parse-chat-log.ts --agent issue-resolver

  # Search for errors
  npx tsx parse-chat-log.ts --search "error|failed|429"

  # Export as markdown
  npx tsx parse-chat-log.ts --format markdown

  # JSON output
  npx tsx parse-chat-log.ts --format json
`);
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate options
  if (options.session && !validateUuidFormat(options.session)) {
    console.error(`Error: Invalid session UUID format: ${options.session}`);
    process.exit(1);
  }

  if (options.speaker && !validateSpeakerType(options.speaker)) {
    console.error(`Error: Invalid speaker type: ${options.speaker}. Must be one of: user, assistant, subagent, system`);
    process.exit(1);
  }

  if (options.search && !validateRegex(options.search)) {
    console.error(`Error: Invalid regex pattern: ${options.search}`);
    process.exit(1);
  }

  if (options.truncate < 0) {
    console.error('Error: Truncate length must be non-negative');
    process.exit(1);
  }

  // Find chat log file
  let filePath: string;
  if (options.file) {
    filePath = options.file;
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
  } else if (options.session) {
    const found = findChatLogBySession(options.session);
    if (!found) {
      console.error(`Error: Session not found: ${options.session}`);
      process.exit(1);
    }
    filePath = found;
  } else {
    const found = findLatestChatLog();
    if (!found) {
      console.error('Error: No chat logs found');
      process.exit(1);
    }
    filePath = found;
  }

  // Parse JSONL
  const { messages: rawMessages, warnings } = parseJsonlFile(filePath);

  if (warnings.length > 0) {
    console.error(`Warnings (${warnings.length} lines skipped):`);
    for (const warning of warnings.slice(0, 10)) {
      console.error(`  - ${warning}`);
    }
    if (warnings.length > 10) {
      console.error(`  ... and ${warnings.length - 10} more`);
    }
    console.error('');
  }

  if (rawMessages.length === 0) {
    console.error('Error: No valid messages found in chat log');
    process.exit(1);
  }

  // Build hierarchy
  const depthMap = buildHierarchy(rawMessages);

  // Transform to parsed messages
  const parsedMessages: ParsedMessage[] = rawMessages.map(msg => {
    const { speaker, agentName } = identifySpeaker(msg);
    const depth = depthMap.get(msg.uuid) || 0;

    // Extract content
    let content = '';
    if (msg.message?.content) {
      content = msg.message.content;
    } else if (msg.message?.parts && msg.message.parts.length > 0) {
      // Extract text from parts array (Qwen Code v0.13+ format)
      const textParts = msg.message.parts
        .filter(p => p.text && !p.thought)
        .map(p => p.text)
        .join('\n\n');
      const thoughtParts = msg.message.parts
        .filter(p => p.thought && p.text)
        .map(p => p.text);
      
      if (thoughtParts.length > 0) {
        content = `[Thinking] ${thoughtParts.join(' ')}\n\n${textParts}`.trim();
      } else {
        content = textParts;
      }
    } else if (typeof msg.message === 'string') {
      content = msg.message;
    } else if (msg.systemPayload) {
      content = JSON.stringify(msg.systemPayload).substring(0, 200);
    }

    // Extract tool calls from message parts (v0.13+ format)
    let toolCalls = msg.toolCalls || [];
    if (toolCalls.length === 0 && msg.message?.parts) {
      toolCalls = msg.message.parts
        .filter(p => p.functionCall)
        .map(p => ({
          name: p.functionCall!.name,
          arguments: JSON.stringify(p.functionCall!.args),
        }));
    }

    return {
      timestamp: msg.timestamp,
      speaker,
      agentName,
      depth: options.flatten ? 0 : depth,
      content,
      toolCalls,
      parentUuid: msg.parentUuid || null,
      uuid: msg.uuid,
      type: msg.type,
      subtype: msg.subtype,
    };
  });

  // Apply filters
  const filteredMessages = filterMessages(parsedMessages, options);

  if (filteredMessages.length === 0) {
    console.log('No matching messages found');
    process.exit(0);
  }

  // Calculate statistics
  const sessionInfo = calculateSessionInfo(rawMessages, filePath);
  const statistics = calculateStatistics(filteredMessages);

  const parsedOutput: ParsedOutput = {
    session: sessionInfo,
    messages: filteredMessages,
    statistics,
  };

  // Format output
  let output: string;
  switch (options.format) {
    case 'json':
      output = formatJsonOutput(parsedOutput);
      break;
    case 'markdown':
      output = formatMarkdownOutput(parsedOutput, options);
      break;
    case 'text':
    default:
      output = formatTextOutput(parsedOutput, options);
      break;
  }

  console.log(output);
}

main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
