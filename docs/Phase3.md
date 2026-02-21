### 6.3. MCP Server Integration

**Purpose:** Expose design system and workspace files to LLM for introspection during code generation

**Location:** `apps/server/src/mcp/`

**MCP Tools Available to LLM:**

#### Design System Tools (Phase 4+)
- `list_components` - Return all available components with summaries
- `get_component(name)` - Return full component definition (props, variants)
- `get_tokens(type)` - Return design tokens by category
- `check_composition_rules(parent, child)` - Validate component nesting
- `search_components(query)` - Find components by semantic purpose

#### File System Tools (Phase 3+)

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
- File not found: `{ error: "File not found", totalLines: 0, linesRead: 0 }`
- Path traversal attempt: `{ error: "Invalid path", totalLines: 0, linesRead: 0 }`
- Line number out of range: `{ error: "startLine exceeds total lines", totalLines: 50, linesRead: 0 }`

---

**`findFile`** - Search for files by content pattern with regex support

**Parameters:**
```typescript
{
  pattern: string;           // Required: Regex pattern to search for
  filePattern?: string;      // Optional: Regex to filter files (default: \\.(ts|tsx|js|jsx)$)
  directory?: string;        // Optional: Directory to search (default: workspace root)
  maxResults?: number;       // Optional: Maximum results (default: 50)
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
  totalMatches: number; // Total matches found
  truncated: boolean;   // Whether results were truncated
}
```

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
```

**Error Cases:**
- Invalid regex: `{ error: "Invalid regex pattern", results: [], totalFiles: 0, totalMatches: 0 }`
- Directory not found: `{ error: "Directory not found", results: [], totalFiles: 0, totalMatches: 0 }`

---

#### Security Constraints

**All MCP file tools enforce:**
- ✅ Workspace boundary (reject paths with `..`)
- ✅ No absolute paths
- ✅ Symlink resolution and validation
- ✅ Directory traversal protection

**Example blocked requests:**
```typescript
// ❌ Blocked: Path traversal
readFile({ path: "../server/src/index.ts" })

// ❌ Blocked: Absolute path
readFile({ path: "/etc/passwd" })

// ✅ Allowed: Valid workspace files
readFile({ path: "designs/landing-page.tsx" })
```

---

#### LLM Instructions (system prompt)

**For Design System Tools (Phase 4+):**
- Never modify or generate `id` props on components
- Use only components returned by MCP tools
- Props must use semantic values from design system tokens
- Reference component names exactly as returned by `list_components`

**For File System Tools (Phase 3+):**
- Use `readFile` to inspect existing designs before editing
- Use `findFile` to locate component usage patterns
- Always check `totalLines` before reading large files (use line ranges for files >100 lines)
- Handle errors gracefully (file may not exist yet)
- Do not attempt to read files outside `workspace/` directory
- Respect `truncated` flag in `findFile` results

---

**Phase 3 Usage:**
In Phase 3 (free-form generation), MCP tools are **available but not enforced**. LLM can use any React components. The `readFile` and `findFile` tools are particularly useful for:
- Inspecting existing designs to maintain consistency
- Finding component usage patterns across the workspace
- Understanding the current state of generated code

MCP design system tools (`list_components`, `get_component`, etc.) become critical in Phase 4 (Design System Mode) when design system enforcement is enabled.

**See `TECHNICAL_DESIGN.md` section "MCP Server"** for complete tool definitions and implementation details.
