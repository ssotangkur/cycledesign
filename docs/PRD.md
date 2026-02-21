# CycleDesign PRD

## Product Vision

A web-based UI design tool that enforces design system consistency through a dual-mode workflow: designers first define a complete design system (components, layouts, palettes, typography, rules), then create designs that strictly adhere to it. The tool actively uses design system components like Lego blocks to automatically assemble designs from designer prompts. When a design request cannot be fulfilled, the tool provides actionable feedback on what is missing and suggests modifications to the design system.

---

## Problem Statement

Design systems are often created but inconsistently applied. Designers drift from established patterns, creating visual inconsistency and technical debt. Existing tools allow breaking rules; none enforce them with intelligent pushback and suggestions.

---

## Target Users

- **UX/UI Designers** creating component libraries and page designs
- **Design System Teams** maintaining and evolving design standards
- **Product Teams** ensuring brand consistency across products

---

## Core Features

### 1. Design System Mode

**Prompt-Driven Creation**
- All design system elements created via text prompts
- LLM generates code files following design system conventions
- Validation ensures generated elements meet semantic requirements

**Components**
- Define reusable UI components with props/variants
- Props must be semantically described, not CSS-like styles (e.g., `size="large"` not `width: 200px`)
- Variants replace custom styling (e.g., `variant="primary"` not `background: blue`)
- Component composition rules (what can contain what)
- State definitions (hover, active, disabled, etc.)

**Layouts**
- Grid systems, spacing scales, container definitions
- Flexbox layouts (row/column orientation)
- Responsive breakpoint rules

**Palettes**
- Color tokens with semantic naming
- Usage rules (which colors for which contexts)

**Typography**
- Font families, sizes, weights, line heights
- Type scale and hierarchy rules

**Rules**
- Custom constraints (e.g., "buttons must use primary palette")
- Accessibility requirements
- Composition restrictions

**Component Preview**
- Visualize components in isolation
- Interactively toggle props, variants, and states
- Preview all combinations to verify design system coverage

### 2. Design Mode

- Prompt-driven design generation (text prompts)
- Optional image prompt support (upload reference images)
- Tool automatically assembles designs using design system components as Lego blocks
- Component instances auto-populated with data values reflecting intended design/use case
- Data values stored in database, editable per instance
- **Select Mode**: Click to select component instances, opens property editor for modifying data props
- **Preview Mode**: Interact with components naturally (hover, active, disabled states work as intended)
- Component states cannot be manually forced—they respond to user interaction only
- Component palette populated ONLY from defined design system
- Property editors locked to design system values (semantic props/variants only, no CSS)
- Real-time validation feedback

### 3. Validation Engine

- Detects when design requests unavailable elements
- Explains what is missing
- Suggests design system additions/modifications
- Offers quick-fix options to update design system
- Identifies conflicting rules within the design system
- Analyzes design patterns to suggest new rules (e.g., repeated padding values, component combinations)
- Recommends custom component creation from frequently used component combinations
- **Design System Compatibility Validation** (background):
  - Automatically validates design system changes against all affected designs
  - Blocks saving incompatible design system changes
  - LLM generates suggestions to resolve breaking changes:
    - Make component more backward compatible (e.g., add prop aliases, support old variants)
    - Auto-update all affected designs to match new component API
  - Invariant: Current design system must always be compatible with all designs using it

### 4. Iterative Loop Support

**Phase 2**
- Design compatibility tracking (real-time validation on design system changes)
- Change impact analysis (shows affected designs before saving)
- LLM-assisted migration suggestions for breaking changes

**Phase 3**
- Git-based version control (local)
- Full change history and rollback to any commit
- Branching for experimental design system changes

### 5. Audit Mode

- Available in both Design System and Design modes
- Select a component to see:
  - List of all designs using that component
  - Usage count across all designs
- In Design mode, highlighted instances show where the audited component appears
- Supports impact assessment before design system changes

---

## Technical Requirements

### Frontend
- React (library only, no framework requirement)
- DOM-based rendering (no canvas needed)
- Local-first with sync capability

### Backend
- Document storage (designs + design systems)
- Version management
- Validation engine (design system constraint checking)
- Collaboration features (optional phase 2)

### Data Model

**Storage Format: Code-Based (TypeScript/JavaScript + Markdown)**
- Design systems defined as code files (`.ts`/`.tsx`)
- Design system rules documented in Markdown (`.md`)
- Designs defined as React code files (`.tsx`) referencing design system components
- Export format is the same React code stored on filesystem (not transformed/indexed version)
- Indexed version exists only in memory for rendering/audit functionality
- LLMs perform better with code than JSON
- Enables type safety through TypeScript
- Human-readable and editable directly on filesystem

**Version Control: Git-Based**
- Leverage git for version management
- Enables full change history (supports stretch goal)
- Branching for experimental design system changes
- Diff-friendly for reviewing changes
- Rollback to any commit

**UI ↔ Code Synchronization**
- Property editors update underlying code files on change
- Code changes reflect immediately in component preview
- Bidirectional binding between UI and code representation
- Property editor schema derived from component TypeScript definitions

**Component Identification & Audit Index**
- Single file per design on filesystem: `design.tsx` (clean React code with system-managed `id` props)
- LLM system instructions include rule: "Never modify or generate `id` props—they are system-managed"
- Post-LLM processing pipeline:
  1. TypeScript type validation
  2. ESLint validation (design system rules)
  3. Knip validation (unused imports/exports)
  4. Parse validated code
  5. Inject `id` props into any component instances missing them
  6. Write `id` props back to source file (persists for user/LLM reference)
  7. Wrap each component instance in system helper components (build folder)
  8. Sync component usage to database index (component ID → design file → instance IDs)
  9. Render from build folder output
- Users and LLMs can reference specific instances by `id` in prompts/edits
- Helper wrappers provide:
  - Audit mode highlighting
  - Selection bounding boxes
  - Instance metadata for property editors
- Audit mode queries database index for instant lookups
- Git tracks source code and build folder (gitignored) for complete version history

**Validation**
- Compile-time validation via TypeScript types
- Runtime validation for composition rules
- Git hooks for pre-commit design system integrity checks

**Database**
- SQLite for component usage index and audit data
- Database is a generated artifact (not versioned, stored in `.gitignore`)
- Rebuilt from source code on app startup or when git HEAD changes
- Parse time acceptable for MVP; optimization in later phases

### LLM Integration

**MCP (Model Context Protocol) Interface**
- Expose design system via MCP server for LLM introspection
- LLM queries components on-demand instead of full serialization
- Available MCP tools:
  - `list_components` - Browse available components
  - `get_component` - Fetch component details (props, variants, states)
  - `get_tokens` - Query color, typography, spacing tokens
  - `check_composition_rules` - Validate component nesting
  - `search_components` - Find components by purpose/semantics

**Design Generation Flow**
1. User submits prompt (text and/or image)
2. LLM introspects design system via MCP to understand available components
3. LLM returns design specification as structured JSON
4. Validation engine verifies against design system rules
5. If violations detected:
   - Reject and request LLM self-correction with error feedback
   - Or suggest design system modifications to user

**Output Format**
- LLM outputs component tree with instance data values
- Each node references design system component by ID
- Props/variants must match defined schemas

**Benefits**
- No context window limits on design system size
- LLM discovers components dynamically
- Reduced token usage per generation
- Design system can evolve without prompt template changes

---

## User Flows

### Flow 1: Create Design System
1. User creates new design system
2. Defines tokens (colors, typography, spacing)
3. Builds components from tokens
4. Sets composition rules
5. Saves version 1.0

### Flow 2: Create Design
1. User selects design system version
2. Creates new design document
3. Submits text/image prompt describing desired design
4. Tool generates design using design system components
5. User switches between Select/Preview modes to edit or interact
6. Receives real-time validation feedback

### Flow 3: Handle Violation
1. User attempts action outside design system (via prompt or property edit)
2. Tool blocks action, shows error panel
3. Error explains what's missing or which rule was violated
4. Suggestions offered:
   - Modify design to fit system
   - Add new token/component to system
   - Modify existing rule to accommodate design
5. User chooses path forward (overrides never allowed)

---

## Success Metrics

- Time to create initial design system
- Number of validation violations per design
- Design system iteration velocity
- User satisfaction (NPS)

---

## Open Questions

None currently.

**Resolved Approaches**
- **Export formats**: React code on filesystem is the export format (no transformation needed)
- **Collaboration**: Deferred to future enhancement
- **Design system migration & Figma/Sketch import**: Users upload screenshots as image prompts; tool attempts to rebuild designs using current design system components; violations trigger suggestions for design system additions to match source

---

## Phase Priorities

**Phase 1**: LLM Provider Integration
- Qwen provider integration via OpenCode-Qwen-Proxy
- Basic prompt UI (text input)
- Display LLM responses in UI
- No session persistence, no design system, no code generation

**Phase 2**: Session Persistence
- Save conversations to session files
- List and load previous sessions
- Restore conversation context for LLM continuity
- Mode-agnostic sessions (work across all modes)

**Phase 3**: Prompt-to-UI Rendering
- LLM generates React/TypeScript code from prompts using **tool calling** (structured output)
- Code rendered in isolated iframe (backend-managed Vite server)
- Backend controls preview server lifecycle (start/stop/restart)
- Real-time log streaming from preview server to UI
- Vite multi-instance setup (tool UI + preview on separate ports)
- Basic validation (TypeScript compilation)
- ID injection for generated components
- LLM can add npm dependencies to preview environment
- Tool calling with Zod schema for reliable code generation
- No design system enforcement yet (free-form generation)

**Phase 4**: Design System Mode
- Design System Mode (tokens, components, rules as code)
- MCP server for LLM introspection of design system
- Validation engine (semantic props, design system rules)
- ID injection with database index
- Select/Preview modes with property editors
- Build folder transformation with component wrappers

**Phase 5**: Design Mode & Audit
- Design Mode with design system enforcement
- Audit mode with component usage tracking
- Pattern detection (suggest rules from repeated patterns)
- Conflict detection in design system rules
- Component preview with all variant combinations

**Phase 6**: Compatibility & Version Control
- **Design system compatibility validation** (background)
- **LLM-assisted migration suggestions** for breaking changes
- **Change impact analysis** (shows affected designs before saving)
- Git-based version control (local)
- Remote git sync (cloud storage)
- Full change history and rollback to any point
- Screenshot import for migration/rebuild

**Phase 7**: Advanced Features
- AI-assisted design system gap analysis
- Branching workflows for experimental changes
- Cross-version compatibility matrix (historical analysis)
