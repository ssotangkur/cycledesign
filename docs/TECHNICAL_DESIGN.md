### 1. Design System Tools (Phase 4+)

**Location:** `apps/server/src/llm/tools/`

**Purpose:** Enable LLM to introspect design system during code generation

**Tools:**

- `list_components` - Return all available components with summaries (name, description, available props/variants)
- `get_component(name)` - Return full component definition (props, variants, states, composition rules)
- `get_tokens(type)` - Return design tokens by category (color, spacing, typography)
- `check_composition_rules(parent, child)` - Validate if a component can contain another
- `search_components(query)` - Find components by purpose/semantics

**LLM Instructions (system prompt):**
- Never modify or generate `id` props on components
- Use only components returned by design system tools
- Props must use semantic values from design system tokens
- Reference component names exactly as returned by `list_components`

---

### 2. File System Tools (Phase 3+)

**Location:** `apps/server/src/llm/tools/`

**Purpose:** Enable LLM to read and search workspace files during code generation

**`readFile`** - Read file contents with optional line range

**Parameters:**
```typescript
{
  path: string;           // Required: File path relative to workspace root
  startLine?: number;     // Optional: Starting line number (1-indexed, default: 1)
  endLine?: number;       // Optional: Ending line number (default: read to end)
}
```

**Returns:**
```typescript
{
  content: string;        // File contents (requested lines only)
  totalLines: number;     // Total lines in file
  linesRead: number;      // Number of lines actually read
  error?: string;         // Error message if applicable
}
```

**Features:**
- ✅ Supports reading specific line ranges (useful for large files)
- ✅ Always returns total line count (helps LLM understand file size)
- ✅ UTF-8 encoding
- ✅ Validates file exists within workspace directory
- ✅ Prevents path traversal attacks (no `..` in paths)
- ✅ Handles missing files gracefully

**Example Usage:**
```typescript
// Read entire file
readFile({ path: "designs/landing-page.tsx" })
// Returns: { content: "...", totalLines: 150, linesRead: 150 }

// Read specific lines (e.g., lines 10-20)
readFile({ path: "designs/landing-page.tsx", startLine: 10, endLine: 20 })
// Returns: { content: "...", totalLines: 150, linesRead: 11 }
```

**Error Cases:**
- File not found: `{ error: "File not found: designs/test.tsx", totalLines: 0, linesRead: 0 }`
- Path traversal attempt: `{ error: "Invalid path: path must be within workspace directory", totalLines: 0, linesRead: 0 }`
- Line number out of range: `{ error: "startLine (100) exceeds total lines (50)", totalLines: 50, linesRead: 0 }`

---

**`findFile`** - Search for files by content pattern with regex support

**Parameters:**
```typescript
{
  pattern: string;           // Required: Regex pattern to search for in file contents
  filePattern?: string;      // Optional: Regex pattern to filter which files to search (default: \\.(ts|tsx|js|jsx)$)
  directory?: string;        // Optional: Directory to search in (default: workspace root)
  maxResults?: number;       // Optional: Maximum results to return (default: 50)
}
```

**Returns:**
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

**Features:**
- ✅ Regex pattern matching for file contents
- ✅ Optional file path filtering (e.g., only search `.tsx` files)
- ✅ Recursive directory search
- ✅ Respects `.gitignore` patterns
- ✅ Configurable result limit
- ✅ Returns metadata about search scope
- ✅ Security: Only searches within workspace directory

**Example Usage:**
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

**Error Cases:**
- Invalid regex: `{ error: "Invalid regex pattern: Unterminated group", results: [], totalFiles: 0, totalMatches: 0 }`
- Directory not found: `{ error: "Directory not found: nonexistent/", results: [], totalFiles: 0, totalMatches: 0 }`

---

#### Security Constraints

**All MCP file tools enforce:**

| Constraint | Validation | Rationale |
|------------|------------|-----------|
| **Workspace boundary** | Reject paths with `..` | Prevents reading files outside workspace |
| **Absolute paths** | Reject paths starting with `/` or drive letters | Forces relative paths only |
| **Symlink resolution** | Resolve symlinks and validate target | Prevents symlink-based escapes |
| **Directory traversal** | Validate resolved path starts with workspace root | Defense in depth |

**Example blocked requests:**
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

**LLM Instructions (system prompt):**
- Use `readFile` to inspect existing designs before editing
- Use `findFile` to locate component usage patterns
- Always check `totalLines` before reading large files (use line ranges for files >100 lines)
- Handle errors gracefully (file may not exist yet)
- Do not attempt to read files outside `workspace/` directory
- Respect `truncated` flag in `findFile` results - if true, there are more matches not shown

---

**Tool Implementation Details:**

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

**Dependencies (`apps/server/package.json`):**

```json
{
  "dependencies": {
    "glob": "^10.3.0",
    "ignore": "^5.3.0",
    "zod": "^3.22.4"
  }
}
```

**Key Packages:**
- `glob` - File pattern matching for findFile
- `ignore` - .gitignore support for findFile
- `zod` - Schema validation for tool parameters

---

**Benefits:**

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

### 3. Preview Communication Bridge

**Purpose:** postMessage API for cross-origin communication between tool UI (port 3000) and preview iframe (port 3002)

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│              Tool Frontend (React + MUI)                    │
│  Port: 3000                                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   iframe (sandboxed)                  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │   Preview Vite (port 3002)                      │  │  │
│  │  │   - Loads @design/current.tsx                   │  │  │
│  │  │   - Wrappers (AuditWrapper, SelectionBox)       │  │  │
│  │  │   - Design system components                    │  │  │
│  │  │   - postMessage bridge to parent                │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    postMessage API
                              │
                    ┌─────────▼─────────┐
                    │  Communication    │
                    │  Bridge Hook      │
                    └───────────────────┘
```

**Message Types:**

**Parent (tool UI, port 3000) → Iframe (preview, port 3002):**
```typescript
interface ParentMessage {
  type: 'SET_MODE';
  payload: { mode: 'select' | 'preview' | 'audit' };
} | {
  type: 'HIGHLIGHT_COMPONENT';
  payload: { instanceId: string };
} | {
  type: 'UPDATE_PROPS';
  payload: { instanceId: string; props: Record<string, any> };
};
```

**Iframe (preview, port 3002) → Parent (tool UI, port 3000):**
```typescript
interface IframeMessage {
  type: 'MODE_READY';
  payload: { mode: string };
} | {
  type: 'COMPONENT_SELECTED';
  payload: { instanceId: string; componentName: string };
} | {
  type: 'ERROR';
  payload: { error: string };
};
```

**Implementation:**
```typescript
// Parent (tool UI, port 3000)
const iframeRef = useRef<HTMLIFrameElement>(null);

function sendMessageToIframe(message: ParentMessage) {
  iframeRef.current?.contentWindow?.postMessage(
    message,
    'http://localhost:3002'  // Preview origin (dynamic)
  );
}

// Iframe (preview, port 3002)
window.addEventListener('message', (event) => {
  if (event.origin !== 'http://localhost:3000') return;  // Tool origin
  
  const message: ParentMessage = event.data;
  
  switch (message.type) {
    case 'SET_MODE':
      setMode(message.payload.mode);
      break;
    case 'HIGHLIGHT_COMPONENT':
      highlightComponent(message.payload.instanceId);
      break;
  }
});
```

**Cross-Origin Security:**
- Explicit origin validation on both sides
- Only localhost origins allowed in development
- Production would require HTTPS + strict origin checking

**Use Cases:**
- **Mode switching**: Tool sends `SET_MODE` to change select/preview/audit modes
- **Component selection**: Wrapper sends `COMPONENT_SELECTED` when user clicks component
- **Highlighting**: Tool sends `HIGHLIGHT_COMPONENT` to show selection in preview
- **Mode confirmation**: Iframe sends `MODE_READY` when mode change complete

---
