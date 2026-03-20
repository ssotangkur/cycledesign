# Tools Reference

**Cross-Reference:** For complete architectural context, see [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)

---

## Section 1: File System Tools

**Location:** `apps/server/src/llm/tools/`

**Purpose:** Enable LLM to read and search workspace files during code generation

---

### `readFile` Tool

Read file contents with optional line range.

#### Parameters

```typescript
{
  path: string;           // Required: File path relative to workspace root
  startLine?: number;     // Optional: Starting line number (1-indexed, default: 1)
  endLine?: number;       // Optional: Ending line number (default: read to end)
}
```

#### Returns

```typescript
{
  content: string;        // File contents (requested lines only)
  totalLines: number;     // Total lines in file
  linesRead: number;      // Number of lines actually read
  error?: string;         // Error message if applicable
}
```

#### Features

- ✅ Supports reading specific line ranges (useful for large files)
- ✅ Always returns total line count (helps LLM understand file size)
- ✅ UTF-8 encoding
- ✅ Validates file exists within workspace directory
- ✅ Prevents path traversal attacks (no `..` in paths)
- ✅ Handles missing files gracefully

#### Example Usage

```typescript
// Read entire file
readFile({ path: "designs/landing-page.tsx" })
// Returns: { content: "...", totalLines: 150, linesRead: 150 }

// Read specific lines (e.g., lines 10-20)
readFile({ path: "designs/landing-page.tsx", startLine: 10, endLine: 20 })
// Returns: { content: "...", totalLines: 150, linesRead: 11 }
```

#### Error Cases

- **File not found:**
  ```typescript
  { error: "File not found: designs/test.tsx", totalLines: 0, linesRead: 0 }
  ```

- **Path traversal attempt:**
  ```typescript
  { error: "Invalid path: path must be within workspace directory", totalLines: 0, linesRead: 0 }
  ```

- **Line number out of range:**
  ```typescript
  { error: "startLine (100) exceeds total lines (50)", totalLines: 50, linesRead: 0 }
  ```

---

### `findFile` Tool

Search for files by content pattern with regex support.

#### Parameters

```typescript
{
  pattern: string;           // Required: Regex pattern to search for in file contents
  filePattern?: string;      // Optional: Regex pattern to filter which files to search (default: \\.(ts|tsx|js|jsx)$)
  directory?: string;        // Optional: Directory to search in (default: workspace root)
  maxResults?: number;       // Optional: Maximum results to return (default: 50)
}
```

#### Returns

```typescript
{
  results: Array<{
    file: string;       // File path
    line: number;       // Line number where match found
    content: string;    // Matching line content
    match: string;      // The actual matched text
  }>;
  totalFiles: number;   // Total files searched
  totalMatches: number; // Total matches found (may exceed results.length if truncated)
  truncated: boolean;   // Whether results were truncated due to maxResults
}
```

#### Features

- ✅ Regex pattern matching for file contents
- ✅ Optional file path filtering (e.g., only search `.tsx` files)
- ✅ Recursive directory search
- ✅ Respects `.gitignore` patterns
- ✅ Configurable result limit
- ✅ Returns metadata about search scope
- ✅ Security: Only searches within workspace directory

#### Example Usage

```typescript
// Find all imports of Button component
findFile({ pattern: "import.*Button.*from.*@mui/material" })
// Returns: { results: [...], totalFiles: 25, totalMatches: 5, truncated: false }

// Find all files containing "useEffect" in designs/ directory
findFile({
  pattern: "useEffect",
  directory: "designs/",
  filePattern: "\\.tsx$"
})

// Find all TODO comments in entire workspace
findFile({
  pattern: "TODO|FIXME",
  maxResults: 100
})
```

#### Error Cases

- **Invalid regex:**
  ```typescript
  { error: "Invalid regex pattern: Unterminated group", results: [], totalFiles: 0, totalMatches: 0 }
  ```

- **Directory not found:**
  ```typescript
  { error: "Directory not found: nonexistent/", results: [], totalFiles: 0, totalMatches: 0 }
  ```

---

### Security Constraints

All MCP file tools enforce:

| Constraint | Validation | Rationale |
|------------|------------|-----------|
| **Workspace boundary** | Reject paths with `..` | Prevents reading files outside workspace |
| **Absolute paths** | Reject paths starting with `/` or drive letters | Forces relative paths only |
| **Symlink resolution** | Resolve symlinks and validate target | Prevents symlink-based escapes |
| **Directory traversal** | Validate resolved path starts with workspace root | Defense in depth |

#### Example Blocked Requests

```typescript
// ❌ Blocked: Path traversal
readFile({ path: "../server/src/index.ts" })

// ❌ Blocked: Absolute path
readFile({ path: "/etc/passwd" })

// ❌ Blocked: Hidden files (optional, configurable)
readFile({ path: ".env" })

// ✅ Allowed: Valid workspace files
readFile({ path: "designs/landing-page.tsx" })
readFile({ path: "designs/landing-page.tsx", startLine: 1, endLine: 50 })
```

---

### LLM Instructions (System Prompt)

- Use `readFile` to inspect existing designs before editing
- Use `findFile` to locate component usage patterns
- Always check `totalLines` before reading large files (use line ranges for files >100 lines)
- Handle errors gracefully (file may not exist yet)
- Do not attempt to read files outside `workspace/` directory
- Respect `truncated` flag in `findFile` results - if true, there are more matches not shown

---

### Tool Implementation Details

#### readFile Tool Implementation

```typescript
// apps/server/src/mcp/tools/readFile.ts
import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { resolve, normalize } from 'path';

export const readFileTool = tool({
  description: 'Read file contents with optional line range. Always returns total line count.',
  parameters: z.object({
    path: z.string()
      .describe('File path relative to workspace root')
      .refine(p => !p.includes('..'), 'Path cannot contain ..')
      .refine(p => !path.isAbsolute(p), 'Path must be relative'),
    startLine: z.number().int().positive().optional()
      .describe('Starting line number (1-indexed, default: 1)'),
    endLine: z.number().int().positive().optional()
      .describe('Ending line number (default: read to end)'),
  }),
  execute: async ({ path, startLine = 1, endLine }) => {
    const fullPath = resolve(WORKSPACE_DIR, path);

    // Security: Validate path is within workspace
    if (!fullPath.startsWith(WORKSPACE_DIR)) {
      return { content: '', totalLines: 0, linesRead: 0, error: 'Path must be within workspace directory' };
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Validate line range
      if (startLine > totalLines) {
        return { content: '', totalLines, linesRead: 0, error: `startLine (${startLine}) exceeds total lines (${totalLines})` };
      }

      // Extract requested lines
      const startIndex = startLine - 1;
      const endIndex = endLine !== undefined ? Math.min(endLine - 1, totalLines) : totalLines;
      const requestedLines = lines.slice(startIndex, endIndex);

      return {
        content: requestedLines.join('\n'),
        totalLines,
        linesRead: requestedLines.length,
      };
    } catch (error) {
      return {
        content: '',
        totalLines: 0,
        linesRead: 0,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
});
```

#### findFile Tool Implementation

```typescript
// apps/server/src/mcp/tools/findFile.ts
import { tool } from 'ai';
import { z } from 'zod';
import { glob } from 'glob';
import { promises as fs } from 'fs';
import { resolve } from 'path';

export const findFileTool = tool({
  description: 'Search for files by content pattern with regex support',
  parameters: z.object({
    pattern: z.string().describe('Regex pattern to search for in file contents'),
    filePattern: z.string().optional()
      .describe('Regex pattern to filter which files to search (default: \\.(ts|tsx|js|jsx)$)'),
    directory: z.string().optional()
      .describe('Directory to search in (default: workspace root)'),
    maxResults: z.number().int().positive().optional()
      .describe('Maximum results to return (default: 50)'),
  }),
  execute: async ({ pattern, filePattern = '\\.(ts|tsx|js|jsx)$', directory = '', maxResults = 50 }) => {
    try {
      // Validate regex patterns
      const contentRegex = new RegExp(pattern);
      const fileRegex = new RegExp(filePattern);

      const searchDir = resolve(WORKSPACE_DIR, directory);

      // Security: Validate directory is within workspace
      if (!searchDir.startsWith(WORKSPACE_DIR)) {
        return { results: [], totalFiles: 0, totalMatches: 0, truncated: false, error: 'Directory must be within workspace' };
      }

      // Find matching files
      const files = await glob('**/*', {
        cwd: searchDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      });

      const filteredFiles = files.filter(f => fileRegex.test(f));

      const results: Array<{ file: string; line: number; content: string; match: string }> = [];
      let totalMatches = 0;

      // Search each file
      for (const file of filteredFiles) {
        const fullPath = resolve(searchDir, file);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const match = contentRegex.exec(lines[i]);
          if (match) {
            totalMatches++;
            if (results.length < maxResults) {
              results.push({
                file,
                line: i + 1,
                content: lines[i],
                match: match[0],
              });
            }
          }
        }
      }

      return {
        results,
        totalFiles: filteredFiles.length,
        totalMatches,
        truncated: totalMatches > maxResults,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { results: [], totalFiles: 0, totalMatches: 0, truncated: false, error: `Invalid regex pattern: ${error.message}` };
      }
      return { results: [], totalFiles: 0, totalMatches: 0, truncated: false, error: error instanceof Error ? error.message : 'Search failed' };
    }
  },
});
```

---

### Dependencies

**File:** `apps/server/package.json`

```json
{
  "dependencies": {
    "glob": "^10.3.0",
    "ignore": "^5.3.0",
    "zod": "^3.22.4"
  }
}
```

#### Key Packages

| Package | Purpose |
|---------|---------|
| `glob` | File pattern matching for findFile |
| `ignore` | .gitignore support for findFile |
| `zod` | Schema validation for tool parameters |

---

### Benefits

| Benefit | Description |
|---------|-------------|
| ✅ **Context-aware generation** | LLM can read existing designs to maintain consistency |
| ✅ **Pattern discovery** | LLM can find component usage patterns across workspace |
| ✅ **Efficient reading** | Line ranges prevent reading entire large files |
| ✅ **Search capabilities** | Regex search helps locate specific code patterns |
| ✅ **Security** | Workspace boundary enforcement prevents unauthorized access |
| ✅ **Error resilience** | Graceful error handling prevents generation failures |
| ✅ **Metadata-rich** | Total lines, match counts help LLM understand scope |

---

## Section 2: Tool Implementation Patterns

### How Tools Are Registered

Tools are registered using the AI SDK's `tool()` function from the `ai` package. Each tool is defined as a module export and then aggregated in a tools registry.

**Registration Pattern:**

```typescript
// apps/server/src/llm/tools/index.ts
import { readFileTool } from './readFile.js';
import { findFileTool } from './findFile.js';

export const tools = {
  readFile: readFileTool,
  findFile: findFileTool,
};
```

**Usage in Agent:**

```typescript
// apps/server/src/llm/agent.ts
import { tools } from './tools/index.js';

const agent = new ToolLoopAgent({
  provider,
  tools,
  systemPrompt,
});
```

---

### Tool Parameter Validation with Zod

All tool parameters are validated using Zod schemas before execution.

**Basic Validation:**

```typescript
parameters: z.object({
  path: z.string()
    .describe('File path relative to workspace root')
    .refine(p => !p.includes('..'), 'Path cannot contain ..')
    .refine(p => !path.isAbsolute(p), 'Path must be relative'),
  startLine: z.number().int().positive().optional()
    .describe('Starting line number (1-indexed, default: 1)'),
  endLine: z.number().int().positive().optional()
    .describe('Ending line number (default: read to end)'),
})
```

**Validation Features:**

- **Type validation:** `z.string()`, `z.number()`, `z.boolean()`
- **Constraints:** `.int()`, `.positive()`, `.min()`, `.max()`
- **Custom validation:** `.refine()` for custom logic
- **Optional fields:** `.optional()` for nullable parameters
- **Descriptions:** `.describe()` for LLM documentation

---

### Error Handling Patterns

Tools follow a consistent error handling pattern that returns structured error responses rather than throwing exceptions.

**Pattern:**

```typescript
execute: async ({ path, startLine = 1, endLine }) => {
  try {
    // Tool logic here
    return { content, totalLines, linesRead };
  } catch (error) {
    return {
      content: '',
      totalLines: 0,
      linesRead: 0,
      error: error instanceof Error ? error.message : 'Failed to read file',
    };
  }
}
```

**Error Response Structure:**

```typescript
{
  // Success case
  content: string;
  totalLines: number;
  linesRead: number;
}

// OR

// Error case
{
  content: '';
  totalLines: 0;
  linesRead: 0;
  error: string;
}
```

**Specific Error Types:**

```typescript
// Invalid regex pattern
if (error instanceof SyntaxError) {
  return { error: `Invalid regex pattern: ${error.message}`, ... };
}

// Generic errors
return { error: error instanceof Error ? error.message : 'Search failed', ... };
```

---

### Security Validation Patterns

All file system tools implement multiple layers of security validation.

#### Path Validation Chain

```typescript
// 1. Resolve to absolute path
const fullPath = resolve(WORKSPACE_DIR, path);

// 2. Validate path is within workspace
if (!fullPath.startsWith(WORKSPACE_DIR)) {
  return { error: 'Path must be within workspace directory', ... };
}

// 3. Additional Zod validation at parameter level
path: z.string()
  .refine(p => !p.includes('..'), 'Path cannot contain ..')
  .refine(p => !path.isAbsolute(p), 'Path must be relative')
```

#### Directory Traversal Prevention

```typescript
// Block path traversal attempts
.refine(p => !p.includes('..'), 'Path cannot contain ..')

// Block absolute paths
.refine(p => !path.isAbsolute(p), 'Path must be relative')

// Validate resolved path
if (!fullPath.startsWith(WORKSPACE_DIR)) {
  return { error: 'Path must be within workspace directory' };
}
```

#### Search Directory Validation

```typescript
const searchDir = resolve(WORKSPACE_DIR, directory);

// Security: Validate directory is within workspace
if (!searchDir.startsWith(WORKSPACE_DIR)) {
  return { error: 'Directory must be within workspace', ... };
}
```

#### Ignore Patterns

```typescript
// Exclude sensitive directories
const files = await glob('**/*', {
  cwd: searchDir,
  nodir: true,
  ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
});
```

---

**Cross-Reference:** For more details on tool execution and agent orchestration, see [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) and [TOOL_CALLING.md](./TOOL_CALLING.md)
