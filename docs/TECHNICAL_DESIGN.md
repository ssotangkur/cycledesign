# CycleDesign Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Design Sys  │  │   Design    │  │   Component Preview     │ │
│  │    Mode     │  │    Mode     │  │      & Audit Mode       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                              │                                  │
│                    ┌─────────▼─────────┐                        │
│                    │   Property Editor │                        │
│                    └─────────┬─────────┘                        │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                         Backend Services                        │
│  ┌─────────────┐  ┌─────────▼─────────┐  ┌─────────────────┐   │
│  │   MCP       │◄─┤  Validation       │  │  Code Parser    │   │
│  │   Server    │  │  Engine           │  │  & Transformer  │   │
│  └─────────────┘  └───────────────────┘  └─────────────────┘   │
│         │                    │                      │           │
│         │              ┌─────▼─────┐          ┌────▼────┐       │
│         │              │ TypeScript│          │  Build  │       │
│         │              │  ESLint   │          │ Folder  │       │
│         │              │   Knip    │          │  (.tsx) │       │
│         │              └───────────┘          └─────────┘       │
│         │                                                    │
│  ┌──────▼────────────────────────────────────────────────┐   │
│  │              SQLite Database                          │   │
│  │  - Component usage index                              │   │
│  │  - Audit data                                         │   │
│  │  - (Regenerated from source on startup)               │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                      Filesystem (Git-tracked)                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ design-system/  │  │ designs/        │  │ rules/          │ │
│  │ *.ts, *.tsx     │  │ *.tsx           │  │ *.md            │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Layer | Technology | Rationale |
|-------|------------|-----------|
| UI Library | React 18+ | Component model aligns with design system concept |
| UI Components | MUI v7+ (latest stable) | Comprehensive component library, no CSS styling needed |
| Styling | MUI `sx` prop + Theme | Programmatic theming, aligns with no-CSS philosophy |
| State | Native React (`useState`, `useReducer`, Context) | Avoid external dependencies until proven necessary |
| Routing | React Router | Simple, well-understood |
| Prompt Input | MUI TextField + file upload | Text prompts and image upload for design generation |
| Property Editor | MUI components (dynamic forms) | Edit component instance data props |
| Design Rendering | Isolated iframe | Complete CSS/JS isolation from tool UI |

### Backend
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Node.js 20+ | JavaScript/TypeScript ecosystem |
| Framework | Express or Fastify | Minimal, flexible (prod only, dev uses Vite) |
| MCP Server | @modelcontextprotocol/sdk | Official MCP implementation |
| TypeScript | tsc + ts-node | Type checking and runtime compilation |
| ESLint | eslint | Linting with custom design system rules |
| Knip | knip | Detect unused exports/imports |
| AST Parsing | @typescript-eslint/parser | Parse TSX for ID injection |
| Code Transformation | Babel or TS Compiler | Wrap components with helpers |

### Database
| Purpose | Technology | Rationale |
|---------|------------|-----------|
| Component Index | SQLite (better-sqlite3) | Fast reads, file-based, no server |
| ORM | None (raw SQL) | Simple schema, no overhead |

### Version Control
| Purpose | Technology | Rationale |
|---------|------------|-----------|
| Git Operations | isomorphic-git | Pure JS git, works in browser or Node |
| Diff Viewing | diff or similar | Display changes between commits |

---

## Project Structure

```
cycledesign/
├── apps/
│   ├── web/                    # React frontend (single Vite instance)
│   │   ├── src/
│   │   │   ├── components/     # UI components for the tool
│   │   │   ├── modes/          # Design System Mode, Design Mode
│   │   │   ├── editors/        # Property editor, prompt input
│   │   │   ├── preview/        # iframe component for design rendering
│   │   │   └── hooks/          # React hooks for state/data
│   │   ├── index.html          # Main app entry point
│   │   ├── preview.html        # Preview entry point (loaded in iframe)
│   │   ├── vite.config.ts      # Vite config with multi-page setup
│   │   └── package.json
│   │
│   └── server/                 # Node.js backend
│       ├── src/
│       │   ├── mcp/            # MCP server implementation
│       │   ├── validation/     # TypeScript, ESLint, Knip runners
│       │   ├── parser/         # AST parsing, ID injection
│       │   ├── transformer/    # Component wrapping (writes to /build)
│       │   ├── database/       # SQLite schema and queries
│       │   └── git/            # Git operations (Phase 3)
│       └── package.json
│
├── packages/
│   ├── design-system-runtime/  # Runtime helpers for wrapped components
│   │   ├── src/
│   │   │   ├── wrappers/       # AuditHighlight, SelectionBox, etc.
│   │   │   └── context/        # Design system context provider
│   │   └── package.json
│   │
│   └── shared-types/           # Shared TypeScript types
│       ├── src/
│       │   ├── component.ts    # Component schema types
│       │   ├── design.ts       # Design document types
│       │   └── audit.ts        # Audit index types
│       └── package.json
│
├── workspace/                  # User's design system and designs (git-tracked)
│   ├── design-system/
│   │   ├── tokens/
│   │   │   ├── colors.ts
│   │   │   ├── spacing.ts
│   │   │   └── typography.ts
│   │   ├── components/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   └── ...
│   │   └── index.ts
│   │
│   ├── designs/
│   │   ├── landing-page.tsx
│   │   ├── dashboard.tsx
│   │   └── ...
│   │
│   └── rules/
│       ├── composition.md
│       └── accessibility.md
│
├── build/                      # Generated output (gitignored)
│   └── designs/                # Transformed .tsx files with wrappers
│
├── .cycledesign/
│   ├── index.db                # SQLite database (gitignored)
│   └── sessions/               # LLM conversation logs (JSONL)
│       ├── design-system-session.jsonl
│       └── *.jsonl
│
├── package.json                # Root workspace config
└── turbo.json                  # Turborepo config (if using monorepo)
```

---

## Design Rendering Isolation

**Approach: Sandboxed iframe with Vite multi-page app**

The LLM-generated design code renders in an isolated iframe to prevent:
- CSS style leakage between tool UI and user designs
- JavaScript errors in user code from crashing the tool
- Conflicts between design system runtime and tool runtime

**Single Vite Instance - Multi-Page Setup:**

```
┌─────────────────────────────────────────────────────────────┐
│              Vite Dev Server (single instance)              │
│                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │   Tool Frontend         │  │   Preview (iframe)      │  │
│  │   /index.html           │  │   /preview.html         │  │
│  │   (React + MUI)         │  │   (Design rendering)    │  │
│  │   Port: 3000            │  │   Port: 3000/preview    │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Vite Config (multi-page):**

```typescript
// apps/web/vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'preview.html'),
      },
    },
  },
});
```

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Frontend (React + MUI)              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   iframe (sandboxed)                  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │   preview.html (Vite entry point)               │  │  │
│  │  │   - Loads transformed design from /build        │  │  │
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

**iframe Attributes:**
```html
<iframe
  sandbox="allow-scripts allow-same-origin"
  src="http://localhost:3000/preview.html"
  title="Design Preview"
/>
```

**Communication Bridge:**

- Parent (tool) sends commands to iframe: `SET_MODE` (select/preview/audit), `HIGHLIGHT_COMPONENT`
- Iframe sends events to parent: `COMPONENT_SELECTED`, `MODE_READY`
- Use `postMessage` API with proper origin validation
- Include instance ID for component selection events

**Hot Reload Flow:**

```
1. LLM generates design code
        │
2. Post-LLM pipeline (validate, inject IDs, transform)
        │
3. Write to /build/designs/*.tsx
        │
4. Vite HMR detects file change
        │
5. iframe auto-refreshes (or manual trigger)
        │
6. User sees updated design instantly
```

**Benefits:**
- Vite's fast HMR for instant preview updates
- Single dev server to manage
- Complete CSS/JS isolation via iframe
- Shared design system runtime package

---

## Conversation/Session Persistence

**Location:** `workspace/.cycledesign/sessions/`

**Structure:**
```
workspace/
└── .cycledesign/
    └── sessions/
        ├── session-1
        ├── session-2
        └── session-*
```

**Session Management Requirements:**

- Create new sessions with user-provided or auto-generated names
- Persist conversation messages (user prompts, LLM responses, system events)
- Load session messages for restoration
- List all available sessions with metadata (name, created/updated timestamps)
- Restore session context for LLM continuity (conversation history, current code, last validation state)
- Sessions must be mode-agnostic (support both Design and Design System modes)
- Sessions can span multiple design files
- Format should be human-readable and debuggable

**Benefits:**
- Standard format used by LLM tooling
- Easy to replay/debug conversations
- Session can be restored for continuity
- Sessions are mode-agnostic (work in both Design and Design System modes)
- Users can create multiple sessions for different tasks/contexts
- Git-tracked for version history (optional)
- Human-readable for debugging

---

## Core Systems

### 0. LLM Provider Integration

**Location:** `apps/server/src/llm/`

**Requirements:**

- Support multiple LLM providers via pluggable adapter interface
- Initial implementation: Qwen via OpenCode-Qwen-Proxy plugin
- Provider configuration via environment variables or config file (no UI for switching)
- Abstract provider-specific details behind common interface
- Session/conversation history passed with each request
- Handle provider-specific rate limits, errors, and retries

**Provider Adapter Interface:**

- Each provider implements a common adapter interface
- Adapters handle authentication, request formatting, response parsing
- Easy to add new providers (Claude, GPT-4, local models, etc.)

**Initial Provider: Qwen via Qwen-Proxy**

- Use OpenCode-Qwen-Proxy plugin approach
- Proxy handles Qwen API communication
- Backend calls proxy endpoint for LLM requests

---

### 1. MCP Server

**Location:** `apps/server/src/mcp/`

**Tools:**

- `list_components` - Return all available components with summaries (name, description, available props/variants)
- `get_component(name)` - Return full component definition (props, variants, states, composition rules)
- `get_tokens(type)` - Return design tokens by category (color, spacing, typography)
- `check_composition_rules(parent, child)` - Validate if a component can contain another
- `search_components(query)` - Find components by semantic purpose or description

**LLM Instructions (system prompt):**
- Never modify or generate `id` props on components
- Use only components returned by MCP tools
- Props must use semantic values from design system tokens
- Reference component names exactly as returned by `list_components`

---

### 2. Validation Engine

**Location:** `apps/server/src/validation/`

**Invariant:** The current design system must always be compatible with all designs using it.

**Three Validation Modes:**

**Design System Mode Validation** (creating components):
- TypeScript compilation check
- ESLint rules:
  - `semantic-props-only`: Component props must be semantic (e.g., `size`, `intent`) not CSS (e.g., `width`, `bg`)
  - `semantic-variants-only`: Variant values must be semantic tokens
- Knip check for unused imports/exports
- CSS-like styling allowed internally (MUI `sx`, styled-components), but not in exposed props

**Design Mode Validation** (using components):
- TypeScript compilation check
- ESLint rules:
  - `no-unknown-components`: Only imported design system components allowed
  - `valid-variant-values`: Variant props must match defined variant names
  - `composition-rules`: Enforce parent/child component nesting rules
- No CSS validation needed (components don't expose `sx` or similar)

**Design System Change Validation** (backward compatibility):
- Triggered on any design system component modification
- Query database for all designs using the modified component
- For each affected design:
  - Verify TypeScript compilation with new component definition
  - Detect breaking changes (removed props, renamed variants, etc.)
- Return compatibility result with list of breaking changes per design
- If incompatible, request LLM suggestions for resolution
- Block save until compatibility is restored

---

### 2b. Background Compatibility Validation

**Location:** `apps/server/src/validation/compatibility.ts`

**Trigger:** Any change to design system component files

**Process Requirements:**

1. Identify the changed component from the modified file
2. Query database for all designs using this component
3. Skip validation if no designs are affected
4. Run compatibility validation for each affected design:
   - Verify TypeScript compilation with new component definition
   - Detect breaking changes (removed props, renamed variants, type changes)
5. If incompatible, request LLM suggestions for resolution
6. Notify user with:
   - Component name being modified
   - Count of affected designs
   - List of specific breaking changes
   - LLM-generated resolution suggestions
7. Block save action until compatibility is restored

**LLM Suggestion Categories:**

1. **Make component more flexible:**
   - Make prop optional with default value
   - Support both old and new variant values (temporarily)
   - Widen prop type to accept both formats

2. **Update affected designs (preferred):**
   - List specific file/line changes needed
   - Generate migration code snippets
   - Offer to auto-fix all affected designs (update usages to new API)

**User Notification Requirements:**

- Display component name being modified
- Show count of affected designs
- List specific breaking changes detected
- Present LLM-generated suggestions:
  - Option to make component backward compatible
  - Option to auto-update all affected designs (preferred)
- Block save action until compatibility is restored

**Invariant Enforcement:**
- Design system changes that break existing designs cannot be saved
- User must resolve incompatibility before proceeding
- Resolution options:
  1. Accept suggestion to make component backward compatible
  2. Accept auto-fix to update all affected designs to new API
  3. Revert the design system change

---

### 3. Code Parser & ID Injector

**Location:** `apps/server/src/parser/`

**Requirements:**

- Query database for existing IDs before parsing
- Parse code using AST (Babel or TypeScript compiler)
- For each component instance:
  - Preserve existing valid IDs (not duplicated)
  - Inject new IDs for instances missing them
  - Detect and fix duplicate IDs (generate new unique ID)
- Calculate diff: added, removed, duplicated, unchanged IDs
- Update database index based on diff
- Write updated code (with IDs) back to source file
- Return diff summary to LLM with hint about system-managed IDs

**LLM Feedback:**

- Notify LLM when code has been modified with ID changes
- Include counts: IDs injected, removed, duplicates fixed
- Include reminder hint: "Do not modify or generate id props"
- LLM can reference specific instances by ID in subsequent prompts

---

### 4. Component Transformer

**Location:** `apps/server/src/transformer/`

**Wraps components with helper HOCs:**

```typescript
// Input (from user/LLM)
<Button variant="primary" size="large">Click me</Button>

// Output (in build folder)
<AuditWrapper 
  id="id_123456_0" 
  componentName="Button"
  highlight={auditMode && selectedComponentId === 'id_123456_0'}
>
  <SelectionBox>
    <Button variant="primary" size="large">Click me</Button>
  </SelectionBox>
</AuditWrapper>
```

**Wrapper Components:** `packages/design-system-runtime/src/wrappers/`

- `AuditWrapper`: Handles highlighting in audit mode
- `SelectionBox`: Shows selection bounding box in Select mode
- `MetadataProvider`: Attaches instance metadata for property editor

---

### 5. Database Schema

**Location:** `apps/server/src/database/`

```sql
-- Component usage index
CREATE TABLE component_usage (
  id TEXT PRIMARY KEY,
  component_name TEXT NOT NULL,
  design_file TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_component_name ON component_usage(component_name);
CREATE INDEX idx_design_file ON component_usage(design_file);

-- Design system metadata
CREATE TABLE design_system_versions (
  id TEXT PRIMARY KEY,
  git_commit TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

**Rebuild Process:**
```typescript
async function rebuildDatabaseIndex() {
  const designs = await glob('workspace/designs/*.tsx');
  
  await db.transaction(async () => {
    await db.run('DELETE FROM component_usage');
    
    for (const file of designs) {
      const code = await fs.readFile(file, 'utf-8');
      const { index } = await injectIds(code);
      
      for (const [componentName, instances] of Object.entries(index)) {
        for (const instance of instances) {
          await db.run(
            'INSERT INTO component_usage (component_name, design_file, instance_id) VALUES (?, ?, ?)',
            [componentName, file, instance.instanceId]
          );
        }
      }
    }
  });
}
```

---

### 6. UI ↔ Code Synchronization

**Location:** `apps/web/src/hooks/`

**Property Editor Flow:**

1. User selects component instance in Select Mode
2. Property editor loads instance metadata (component type, current prop values)
3. User modifies property value (locked to semantic options from design system)
4. Code file updated directly with new prop value
5. Build transformation triggered
6. Preview iframe refreshes via Vite HMR

**File Watching:**

- Watch source files for changes (chokidar or Vite HMR)
- Trigger rebuild and preview refresh on change
- Debounce rapid changes to avoid excessive rebuilds

---

## Data Flow

### Design Generation Flow

1. User submits text/image prompt
2. Backend queries design system via MCP (components, tokens, rules)
3. LLM generates structured JSON design spec
4. Code generator converts JSON to TSX
5. Validation pipeline runs (TypeScript, ESLint, Knip)
6. If validation fails: Show error panel with suggestions
7. If validation passes:
   - Inject IDs into component instances
   - Write updated code to source file
   - Wrap components for build folder
   - Update database index
   - Refresh preview iframe

---

## Performance Considerations

| Operation | Expected Time | Optimization Strategy |
|-----------|---------------|----------------------|
| Database rebuild (100 designs) | < 5 seconds | Incremental parsing, cache AST |
| ID injection | < 500ms | Only parse changed files |
| Build transformation | < 1 second | Parallel processing |
| Validation (TS + ESLint + Knip) | < 2 seconds | Incremental checks, caching |
| Audit query | < 50ms | Indexed SQLite queries |

---

## Security Considerations

1. **LLM Code Injection**: All LLM-generated code must pass validation before execution
2. **Sandboxed Execution**: Run validation in isolated context (vm2 or similar)
3. **File Access**: Restrict file operations to `workspace/` directory only
4. **XSS Prevention**: Sanitize any user-provided content before rendering

---

## Open Technical Decisions

1. **Monorepo vs Single Repo**: Turborepo for monorepo management?
2. **LLM Provider**: Which model(s) to support? (Claude, GPT-4, local?)
3. **Hot Reload**: File watching strategy (chokidar vs polling)?
4. **Build Folder Sync**: Auto-trigger on file change or manual?
5. **iframe Communication**: Custom postMessage or library like `postmate`?
