# Design System Tools Reference

**Cross-Reference:** For complete architectural context, see [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) and [PRD.md](./PRD.md)

---

## Overview

**Location:** `apps/server/src/llm/tools/` (Phase 4+)

**Purpose:** Enable LLM to introspect the design system during code generation, ensuring all generated designs use only defined components, tokens, and composition rules.

The design system tools provide a programmatic interface for the LLM to:
- Discover available components and their capabilities
- Query design tokens (colors, spacing, typography)
- Validate component composition rules
- Search for components by semantic purpose

This ensures generated designs are always consistent with the defined design system, preventing visual drift and technical debt.

---

## Available Tools

### `list_components`

Return all available components with summaries including name, description, available props, and variants.

#### Parameters

```typescript
{
  category?: string;      // Optional: Filter by component category (e.g., "buttons", "inputs", "layout")
  includeDeprecated?: boolean;  // Optional: Include deprecated components (default: false)
}
```

#### Returns

```typescript
{
  components: Array<{
    name: string;           // Component identifier (exact name to use in code)
    description: string;    // Human-readable description
    category: string;       // Component category
    props: Array<{
      name: string;
      type: string;
      required: boolean;
      defaultValue?: string;
      description: string;
    }>;
    variants: Array<{
      name: string;
      description: string;
      props: Record<string, string>;
    }>;
    states: string[];       // Available states (e.g., "hover", "active", "disabled")
    deprecated: boolean;    // Whether component is deprecated
    replacement?: string;   // Replacement component name if deprecated
  }>;
  total: number;            // Total components available
  categories: string[];     // All available categories
}
```

#### Features

- ✅ Returns complete component inventory
- ✅ Includes prop types and descriptions
- ✅ Lists all available variants
- ✅ Indicates component states
- ✅ Category filtering for focused queries
- ✅ Deprecation warnings with migration paths

#### Example Usage

```typescript
// List all components
list_components({})
// Returns: { components: [...], total: 45, categories: ["buttons", "inputs", "layout", ...] }

// List only button components
list_components({ category: "buttons" })
// Returns: { components: [Button, IconButton, ToggleButton, ...], total: 5, categories: [...] }

// Include deprecated components (for migration purposes)
list_components({ includeDeprecated: true })
```

#### Example Response

```typescript
{
  components: [
    {
      name: "Button",
      description: "Primary action button with support for variants and sizes",
      category: "buttons",
      props: [
        {
          name: "variant",
          type: "'primary' | 'secondary' | 'tertiary'",
          required: false,
          defaultValue: "'primary'",
          description: "Visual style of the button"
        },
        {
          name: "size",
          type: "'small' | 'medium' | 'large'",
          required: false,
          defaultValue: "'medium'",
          description: "Physical size of the button"
        },
        {
          name: "disabled",
          type: "boolean",
          required: false,
          defaultValue: "false",
          description: "Whether the button is disabled"
        },
        {
          name: "children",
          type: "React.ReactNode",
          required: true,
          description: "Button label or content"
        }
      ],
      variants: [
        {
          name: "primary",
          description: "High-emphasis button for primary actions",
          props: {
            backgroundColor: "color.brand.primary",
            color: "color.text.inverse"
          }
        },
        {
          name: "secondary",
          description: "Medium-emphasis button for secondary actions",
          props: {
            backgroundColor: "color.surface.elevated",
            color: "color.text.primary"
          }
        }
      ],
      states: ["hover", "active", "focus", "disabled"],
      deprecated: false
    }
  ],
  total: 45,
  categories: ["buttons", "inputs", "layout", "typography", "feedback", "navigation"]
}
```

---

### `get_component(name)`

Return full component definition including props, variants, states, composition rules, and usage examples.

#### Parameters

```typescript
{
  name: string;           // Required: Exact component name from list_components
}
```

#### Returns

```typescript
{
  component: {
    name: string;
    description: string;
    category: string;
    props: Array<{
      name: string;
      type: string;
      required: boolean;
      defaultValue?: string;
      description: string;
      tokenReference?: string;  // If prop references a design token
    }>;
    variants: Array<{
      name: string;
      description: string;
      props: Record<string, string>;
    }>;
    states: Array<{
      name: string;
      description: string;
      styleChanges: Record<string, string>;
    }>;
    composition: {
      canContain: string[];       // Components this can contain
      canBeContainedBy: string[]; // Components that can contain this
      maxChildren?: number;       // Maximum number of children allowed
    };
    examples: Array<{
      title: string;
      code: string;
      description: string;
    }>;
    deprecated: boolean;
    replacement?: string;
    versionAdded: string;
    lastModified: string;
  };
  error?: string;  // Error message if component not found
}
```

#### Features

- ✅ Complete component specification
- ✅ Composition rules for validation
- ✅ Usage examples for reference
- ✅ Token references for semantic props
- ✅ Version tracking

#### Example Usage

```typescript
// Get Button component details
get_component({ name: "Button" })

// Get Card component details
get_component({ name: "Card" })
```

#### Example Response

```typescript
{
  component: {
    name: "Button",
    description: "Primary action button with support for variants and sizes",
    category: "buttons",
    props: [
      {
        name: "variant",
        type: "'primary' | 'secondary' | 'tertiary'",
        required: false,
        defaultValue: "'primary'",
        description: "Visual style of the button",
        tokenReference: "color.brand.*"
      },
      {
        name: "size",
        type: "'small' | 'medium' | 'large'",
        required: false,
        defaultValue: "'medium'",
        description: "Physical size of the button",
        tokenReference: "spacing.*"
      }
    ],
    variants: [
      {
        name: "primary",
        description: "High-emphasis button for primary actions",
        props: {
          backgroundColor: "color.brand.primary",
          color: "color.text.inverse",
          padding: "spacing.md"
        }
      }
    ],
    states: [
      {
        name: "hover",
        description: "Mouse pointer over button",
        styleChanges: {
          backgroundColor: "color.brand.primary.dark",
          transform: "translateY(-1px)"
        }
      },
      {
        name: "active",
        description: "Button being pressed",
        styleChanges: {
          backgroundColor: "color.brand.primary.darker",
          transform: "translateY(0)"
        }
      }
    ],
    composition: {
      canContain: ["Icon", "Text", "Spinner"],
      canBeContainedBy: ["Card", "Modal", "Toolbar", "Form"],
      maxChildren: 3
    },
    examples: [
      {
        title: "Primary Button",
        code: `<Button variant="primary" size="medium">Click Me</Button>`,
        description: "Standard primary action button"
      },
      {
        title: "Secondary Button with Icon",
        code: `<Button variant="secondary" size="large"><Icon name="download" /> Download</Button>`,
        description: "Secondary button with leading icon"
      }
    ],
    deprecated: false,
    versionAdded: "1.0.0",
    lastModified: "2026-03-01"
  }
}
```

#### Error Cases

- **Component not found:**
  ```typescript
  { error: "Component not found: NonExistentComponent", component: null }
  ```

- **Ambiguous name:**
  ```typescript
  { error: "Multiple components match 'Input'. Use exact name from list_components", component: null }
  ```

---

### `get_tokens(type)`

Return design tokens by category including color, spacing, typography, and other semantic values.

#### Parameters

```typescript
{
  type: 'color' | 'spacing' | 'typography' | 'border' | 'shadow' | 'breakpoint' | 'z-index';
  category?: string;  // Optional: Subcategory filter (e.g., "brand", "neutral", "semantic" for colors)
}
```

#### Returns

```typescript
{
  tokens: Array<{
    name: string;           // Token identifier (e.g., "color.brand.primary")
    value: string;          // Token value (e.g., "#0066CC", "16px", "1rem")
    description: string;    // Usage description
    category: string;       // Token category
    subcategory?: string;   // Token subcategory
    aliases: string[];      // Alternative names (deprecated or legacy)
    usedBy: string[];       // Components that use this token
  }>;
  total: number;
  type: string;
}
```

#### Features

- ✅ All token categories supported
- ✅ Semantic naming enforced
- ✅ Usage tracking (which components use each token)
- ✅ Alias support for deprecated tokens
- ✅ Category filtering

#### Example Usage

```typescript
// Get all color tokens
get_tokens({ type: "color" })

// Get only brand colors
get_tokens({ type: "color", category: "brand" })

// Get spacing tokens
get_tokens({ type: "spacing" })

// Get typography tokens
get_tokens({ type: "typography" })
```

#### Example Response

```typescript
// get_tokens({ type: "color", category: "brand" })
{
  tokens: [
    {
      name: "color.brand.primary",
      value: "#0066CC",
      description: "Primary brand color for main actions and key elements",
      category: "color",
      subcategory: "brand",
      aliases: ["color.primary", "color.brand.blue"],
      usedBy: ["Button", "Link", "Badge", "ProgressBar"]
    },
    {
      name: "color.brand.secondary",
      value: "#6B7280",
      description: "Secondary brand color for supporting elements",
      category: "color",
      subcategory: "brand",
      aliases: [],
      usedBy: ["Button", "Text", "Icon"]
    },
    {
      name: "color.brand.accent",
      value: "#F59E0B",
      description: "Accent color for highlights and attention",
      category: "color",
      subcategory: "brand",
      aliases: [],
      usedBy: ["Badge", "Highlight", "Notification"]
    }
  ],
  total: 3,
  type: "color"
}

// get_tokens({ type: "spacing" })
{
  tokens: [
    {
      name: "spacing.xs",
      value: "4px",
      description: "Extra small spacing for tight layouts",
      category: "spacing",
      aliases: [],
      usedBy: ["Button", "Input", "Card"]
    },
    {
      name: "spacing.sm",
      value: "8px",
      description: "Small spacing for compact layouts",
      category: "spacing",
      aliases: [],
      usedBy: ["Button", "Input", "Card", "Modal"]
    },
    {
      name: "spacing.md",
      value: "16px",
      description: "Medium spacing for standard layouts",
      category: "spacing",
      aliases: [],
      usedBy: ["Button", "Card", "Modal", "Form"]
    },
    {
      name: "spacing.lg",
      value: "24px",
      description: "Large spacing for spacious layouts",
      category: "spacing",
      aliases: [],
      usedBy: ["Card", "Modal", "Section"]
    },
    {
      name: "spacing.xl",
      value: "32px",
      description: "Extra large spacing for hero sections",
      category: "spacing",
      aliases: [],
      usedBy: ["Hero", "Section", "Page"]
    }
  ],
  total: 5,
  type: "spacing"
}

// get_tokens({ type: "typography" })
{
  tokens: [
    {
      name: "typography.heading.xl",
      value: {
        fontFamily: "Inter",
        fontSize: "48px",
        fontWeight: "700",
        lineHeight: "1.1",
        letterSpacing: "-0.02em"
      },
      description: "Extra large heading for page titles",
      category: "typography",
      subcategory: "heading",
      aliases: [],
      usedBy: ["Heading", "PageTitle", "Hero"]
    },
    {
      name: "typography.body.md",
      value: {
        fontFamily: "Inter",
        fontSize: "16px",
        fontWeight: "400",
        lineHeight: "1.5",
        letterSpacing: "0"
      },
      description: "Medium body text for standard content",
      category: "typography",
      subcategory: "body",
      aliases: [],
      usedBy: ["Text", "Paragraph", "Card", "Modal"]
    }
  ],
  total: 12,
  type: "typography"
}
```

#### Error Cases

- **Invalid token type:**
  ```typescript
  { error: "Invalid token type: 'invalid'. Must be one of: color, spacing, typography, border, shadow, breakpoint, z-index", tokens: [], total: 0, type: "" }
  ```

- **Category not found:**
  ```typescript
  { error: "Category not found: 'nonexistent' for type 'color'", tokens: [], total: 0, type: "color" }
  ```

---

### `check_composition_rules(parent, child)`

Validate if a component can contain another component according to design system composition rules.

#### Parameters

```typescript
{
  parent: string;         // Required: Parent component name
  child: string;          // Required: Child component name
  context?: {           // Optional: Additional context for validation
    variant?: string;     // Parent variant (some variants have different rules)
    propPath?: string;    // Specific prop being validated (e.g., "leadingElement")
  };
}
```

#### Returns

```typescript
{
  valid: boolean;         // Whether composition is allowed
  reason?: string;        // Explanation if invalid
  suggestion?: string;    // Suggested alternative if invalid
  rule: {
    parent: string;
    allowedChildren: string[];
    maxChildren?: number;
    requiredChildren?: string[];
  };
}
```

#### Features

- ✅ Validates parent-child relationships
- ✅ Provides clear error messages
- ✅ Suggests valid alternatives
- ✅ Considers variant-specific rules
- ✅ Returns full composition rule for reference

#### Example Usage

```typescript
// Valid composition
check_composition_rules({ parent: "Card", child: "Button" })
// Returns: { valid: true, rule: {...} }

// Invalid composition
check_composition_rules({ parent: "Button", child: "Card" })
// Returns: { valid: false, reason: "...", suggestion: "..." }

// Variant-specific validation
check_composition_rules({
  parent: "Modal",
  child: "Button",
  context: { variant: "alert" }
})
```

#### Example Responses

```typescript
// Valid composition
{
  valid: true,
  rule: {
    parent: "Card",
    allowedChildren: ["Text", "Heading", "Button", "Image", "Icon", "Divider"],
    maxChildren: 10
  }
}

// Invalid composition
{
  valid: false,
  reason: "Button cannot contain Card. Buttons are leaf components meant for actions, not containers.",
  suggestion: "Consider using Card as the parent and placing Button inside it, or use Button within Card's action area.",
  rule: {
    parent: "Button",
    allowedChildren: ["Icon", "Text", "Spinner"],
    maxChildren: 3
  }
}

// Variant-specific (alert modal requires action buttons)
{
  valid: true,
  rule: {
    parent: "Modal",
    allowedChildren: ["Heading", "Text", "Button", "Divider"],
    requiredChildren: ["Button"],  // Alert variant requires action buttons
    maxChildren: 5
  }
}
```

---

### `search_components(query)`

Find components by purpose, semantics, or description using natural language search.

#### Parameters

```typescript
{
  query: string;          // Required: Natural language search query
  limit?: number;         // Optional: Maximum results to return (default: 10)
  includeDescriptionMatch?: boolean;  // Optional: Also search descriptions (default: true)
}
```

#### Returns

```typescript
{
  results: Array<{
    name: string;
    description: string;
    category: string;
    matchScore: number;     // Relevance score (0-1)
    matchReason: string;    // Why this component matched
    props: Array<{ name: string; type: string }>;
    variants: string[];
  }>;
  total: number;
  query: string;
  suggestions: string[];    // Related search terms
}
```

#### Features

- ✅ Natural language search
- ✅ Semantic matching (not just keyword)
- ✅ Relevance scoring
- ✅ Match explanations
- ✅ Related search suggestions

#### Example Usage

```typescript
// Search for clickable elements
search_components({ query: "clickable element for actions" })

// Search for layout components
search_components({ query: "container for organizing items horizontally" })

// Search with limit
search_components({ query: "text display", limit: 5 })
```

#### Example Response

```typescript
// search_components({ query: "clickable element for actions" })
{
  results: [
    {
      name: "Button",
      description: "Primary action button with support for variants and sizes",
      category: "buttons",
      matchScore: 0.95,
      matchReason: "Matches 'clickable' (interactive component), 'actions' (primary purpose)",
      props: [
        { name: "variant", type: "'primary' | 'secondary' | 'tertiary'" },
        { name: "size", type: "'small' | 'medium' | 'large'" },
        { name: "disabled", type: "boolean" }
      ],
      variants: ["primary", "secondary", "tertiary"]
    },
    {
      name: "IconButton",
      description: "Icon-only button for compact actions",
      category: "buttons",
      matchScore: 0.88,
      matchReason: "Matches 'clickable' (interactive component), 'actions' (icon-based actions)",
      props: [
        { name: "icon", type: "string" },
        { name: "size", type: "'small' | 'medium' | 'large'" },
        { name: "ariaLabel", type: "string" }
      ],
      variants: ["default", "raised"]
    },
    {
      name: "Link",
      description: "Hyperlink for navigation and external links",
      category: "navigation",
      matchScore: 0.72,
      matchReason: "Matches 'clickable' (interactive navigation element)",
      props: [
        { name: "href", type: "string" },
        { name: "variant", type: "'primary' | 'secondary' | 'subtle'" },
        { name: "external", type: "boolean" }
      ],
      variants: ["primary", "secondary", "subtle"]
    }
  ],
  total: 3,
  query: "clickable element for actions",
  suggestions: ["interactive", "action", "trigger", "navigation", "button variants"]
}

// search_components({ query: "container for organizing items horizontally" })
{
  results: [
    {
      name: "Flex",
      description: "Flexbox container for flexible layouts with row/column orientation",
      category: "layout",
      matchScore: 0.92,
      matchReason: "Matches 'container' (layout component), 'horizontally' (flex-direction: row)",
      props: [
        { name: "direction", type: "'row' | 'column'" },
        { name: "gap", type: "SpacingToken" },
        { name: "align", type: "'start' | 'center' | 'end' | 'stretch'" }
      ],
      variants: []
    },
    {
      name: "Toolbar",
      description: "Horizontal toolbar for grouping actions and controls",
      category: "layout",
      matchScore: 0.85,
      matchReason: "Matches 'container' (groups items), 'horizontally' (horizontal layout)",
      props: [
        { name: "variant", type: "'default' | 'dense'" },
        { name: "alignment", type: "'start' | 'center' | 'end' | 'spread'" }
      ],
      variants: ["default", "dense"]
    }
  ],
  total: 2,
  query: "container for organizing items horizontally",
  suggestions: ["flexbox", "row layout", "horizontal stack", "grouping", "arrangement"]
}
```

---

## TypeScript Type Definitions

```typescript
// apps/server/src/llm/tools/types/design-system.ts

// === List Components ===

export interface ListComponentsParams {
  category?: string;
  includeDeprecated?: boolean;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description: string;
  tokenReference?: string;
}

export interface ComponentVariant {
  name: string;
  description: string;
  props: Record<string, string>;
}

export interface ComponentSummary {
  name: string;
  description: string;
  category: string;
  props: ComponentProp[];
  variants: ComponentVariant[];
  states: string[];
  deprecated: boolean;
  replacement?: string;
}

export interface ListComponentsResult {
  components: ComponentSummary[];
  total: number;
  categories: string[];
}

// === Get Component ===

export interface ComponentState {
  name: string;
  description: string;
  styleChanges: Record<string, string>;
}

export interface CompositionRule {
  canContain: string[];
  canBeContainedBy: string[];
  maxChildren?: number;
  requiredChildren?: string[];
}

export interface ComponentExample {
  title: string;
  code: string;
  description: string;
}

export interface ComponentDefinition extends ComponentSummary {
  states: ComponentState[];
  composition: CompositionRule;
  examples: ComponentExample[];
  versionAdded: string;
  lastModified: string;
}

export interface GetComponentParams {
  name: string;
}

export interface GetComponentResult {
  component: ComponentDefinition | null;
  error?: string;
}

// === Get Tokens ===

export type TokenType = 'color' | 'spacing' | 'typography' | 'border' | 'shadow' | 'breakpoint' | 'z-index';

export interface DesignToken {
  name: string;
  value: string | Record<string, string>;
  description: string;
  category: string;
  subcategory?: string;
  aliases: string[];
  usedBy: string[];
}

export interface GetTokensParams {
  type: TokenType;
  category?: string;
}

export interface GetTokensResult {
  tokens: DesignToken[];
  total: number;
  type: string;
  error?: string;
}

// === Check Composition Rules ===

export interface CompositionContext {
  variant?: string;
  propPath?: string;
}

export interface CheckCompositionParams {
  parent: string;
  child: string;
  context?: CompositionContext;
}

export interface CompositionRuleResult {
  parent: string;
  allowedChildren: string[];
  maxChildren?: number;
  requiredChildren?: string[];
}

export interface CheckCompositionResult {
  valid: boolean;
  reason?: string;
  suggestion?: string;
  rule: CompositionRuleResult;
}

// === Search Components ===

export interface SearchComponentResult {
  name: string;
  description: string;
  category: string;
  matchScore: number;
  matchReason: string;
  props: Array<{ name: string; type: string }>;
  variants: string[];
}

export interface SearchComponentsParams {
  query: string;
  limit?: number;
  includeDescriptionMatch?: boolean;
}

export interface SearchComponentsResult {
  results: SearchComponentResult[];
  total: number;
  query: string;
  suggestions: string[];
}
```

---

## LLM Instructions (System Prompt)

When using design system tools, the LLM must follow these rules:

### Component Usage

1. **Always use `list_components` or `search_components` before generating new designs** to discover available components.

2. **Reference component names exactly** as returned by `list_components`. Do not invent component names or use aliases.

3. **Use `get_component(name)` to verify prop schemas** before generating component instances. Ensure all required props are provided.

4. **Never modify or generate `id` props** on components—these are system-managed.

5. **Use only components returned by design system tools**. Do not import or use external component libraries unless explicitly added via `add_dependency`.

### Token Usage

6. **Always use `get_tokens(type)` to query available tokens** before applying colors, spacing, or typography.

7. **Props must use semantic values from design system tokens**. For example:
   - ✅ `backgroundColor="color.brand.primary"`
   - ❌ `backgroundColor="#0066CC"` or `backgroundColor="blue"`

8. **Do not use CSS values directly**. Use token references:
   - ✅ `padding="spacing.md"`
   - ❌ `padding="16px"`

### Composition Rules

9. **Use `check_composition_rules(parent, child)` to validate component nesting** before generating component trees.

10. **Respect composition rules**. If a composition is invalid:
    - Do not generate the invalid structure
    - Suggest valid alternatives to the user
    - Consider suggesting design system modifications if the user's intent is valid

### Error Handling

11. **Handle tool errors gracefully**. If a component or token is not found:
    - Inform the user what was not found
    - Suggest alternatives based on search results
    - Offer to help expand the design system

12. **When validation fails**, explain:
    - What rule was violated
    - Why the rule exists (if known)
    - How to fix the violation

### Best Practices

13. **Prefer semantic search** with `search_components(query)` when unsure of component names.

14. **Check deprecation status** before using components. If a component is deprecated, use its replacement.

15. **Use composition rules proactively** to suggest better component structures, not just for validation.

---

## Usage Examples

### Example 1: Creating a New Design

```typescript
// Step 1: Discover available components
const components = await list_components({ category: "buttons" });
// Returns: [Button, IconButton, ToggleButton, ...]

// Step 2: Get detailed component info
const buttonDetails = await get_component({ name: "Button" });
// Returns: Full component definition with props, variants, states

// Step 3: Query color tokens for styling
const colors = await get_tokens({ type: "color", category: "brand" });
// Returns: [color.brand.primary, color.brand.secondary, ...]

// Step 4: Validate composition before generating
const composition = await check_composition_rules({
  parent: "Card",
  child: "Button"
});
// Returns: { valid: true, rule: {...} }

// Step 5: Generate design using discovered components
// <Card>
//   <Text variant="heading.md">Welcome</Text>
//   <Button variant="primary" size="medium">Get Started</Button>
// </Card>
```

### Example 2: Handling Invalid Composition

```typescript
// User request: "Put a Card inside a Button"

// Step 1: Check if this composition is valid
const result = await check_composition_rules({
  parent: "Button",
  child: "Card"
});

// Step 2: Handle invalid composition
if (!result.valid) {
  // Inform user and suggest alternatives
  console.log(result.reason);
  // "Button cannot contain Card. Buttons are leaf components meant for actions, not containers."

  console.log(result.suggestion);
  // "Consider using Card as the parent and placing Button inside it, or use Button within Card's action area."

  // Suggest valid alternative structure
  // <Card>
  //   <Text>Card content</Text>
  //   <Button variant="primary">Action</Button>
  // </Card>
}
```

### Example 3: Finding Components by Purpose

```typescript
// User request: "I need something clickable to trigger an action"

// Step 1: Search for components matching the description
const search = await search_components({
  query: "clickable element for triggering actions"
});

// Step 2: Review results
// Returns: [Button (0.95), IconButton (0.88), Link (0.72), ...]

// Step 3: Get details for top match
const button = await get_component({ name: "Button" });

// Step 4: Use component with correct props
// <Button variant="primary" onClick={handleClick}>
//   Click Me
// </Button>
```

### Example 4: Applying Design Tokens

```typescript
// User request: "Style this with our brand colors"

// Step 1: Query brand color tokens
const brandColors = await get_tokens({
  type: "color",
  category: "brand"
});

// Step 2: Query spacing tokens for layout
const spacing = await get_tokens({ type: "spacing" });

// Step 3: Apply tokens semantically
// <Card
//   backgroundColor="color.brand.primary"
//   padding="spacing.lg"
//   borderRadius="border.radius.md"
// >
//   <Text color="color.text.inverse">
//     Branded Content
//   </Text>
// </Card>
```

### Example 5: Handling Deprecated Components

```typescript
// Step 1: List components including deprecated ones
const components = await list_components({ includeDeprecated: true });

// Step 2: Check if intended component is deprecated
const legacyButton = components.find(c => c.name === "LegacyButton");

if (legacyButton?.deprecated) {
  // Step 3: Get replacement info
  console.log(`Deprecated: Use ${legacyButton.replacement} instead`);

  // Step 4: Get details for replacement
  const replacement = await get_component({
    name: legacyButton.replacement!
  });

  // Step 5: Use replacement component
  // <Button variant="primary">  // Instead of <LegacyButton>
  //   Click Me
  // </Button>
}
```

---

## Integration with Code Generation

### Tool Registration

Design system tools are registered alongside file system tools in the tools registry:

```typescript
// apps/server/src/llm/tools/index.ts
import { readFileTool } from './readFile.js';
import { findFileTool } from './findFile.js';
import { createFileTool } from './createFile.js';
import { listComponentsTool } from './design-system/listComponents.js';
import { getComponentTool } from './design-system/getComponent.js';
import { getTokensTool } from './design-system/getTokens.js';
import { checkCompositionTool } from './design-system/checkComposition.js';
import { searchComponentsTool } from './design-system/searchComponents.js';

export const tools = {
  // File system tools
  readFile: readFileTool,
  findFile: findFileTool,
  createFile: createFileTool,

  // Design system tools (Phase 4+)
  list_components: listComponentsTool,
  get_component: getComponentTool,
  get_tokens: getTokensTool,
  check_composition_rules: checkCompositionTool,
  search_components: searchComponentsTool,
};
```

### System Prompt Integration

The system prompt includes instructions for design system tool usage:

```typescript
// apps/server/src/llm/agent.ts
const systemPrompt = `
You are CycleDesign, an AI assistant for creating UI designs that adhere to a design system.

## Design System Rules

1. **Component Discovery**: Before generating any design, use \`list_components\` or \`search_components\` to discover available components.

2. **Token Usage**: Always use semantic tokens from the design system. Never use raw CSS values.
   - Use \`get_tokens("color")\` for colors
   - Use \`get_tokens("spacing")\` for spacing
   - Use \`get_tokens("typography")\` for typography

3. **Composition Validation**: Use \`check_composition_rules(parent, child)\` to validate component nesting.

4. **No ID Props**: Never generate or modify \`id\` props on components—these are system-managed.

5. **Exact Names**: Reference component names exactly as returned by tools. Do not use aliases or variations.

## Workflow

1. Understand the user's design request
2. Query the design system for relevant components and tokens
3. Validate your planned structure with composition rules
4. Generate code using only discovered components and tokens
5. If the request cannot be fulfilled, explain what's missing and suggest design system additions
`;
```

### Code Generation Pipeline

```
User Prompt
    ↓
┌─────────────────────────┐
│  ToolLoopAgent          │
│  (with system prompt)   │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  Design System Tools    │
│  - list_components      │
│  - get_component        │
│  - get_tokens           │
│  - check_composition    │
│  - search_components    │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  Code Generation        │
│  (using discovered      │
│   components/tokens)    │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  Validation Pipeline    │
│  - TypeScript check     │
│  - ESLint (rules)       │
│  - Composition check    │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  ID Injection           │
│  (system-managed)       │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  Preview Server         │
│  (Vite, port 3002)      │
└─────────────────────────┘
```

### Validation Integration

Design system tools integrate with the validation pipeline:

```typescript
// apps/server/src/validation/validation-service.ts
export class ValidationService {
  async validateDesignSystemCompliance(
    code: string,
    messageId: string
  ): Promise<{
    success: boolean;
    violations: Array<{
      type: 'composition' | 'token' | 'component';
      message: string;
      suggestion: string;
    }>;
  }> {
    // Parse generated code
    const ast = parse(code);

    // Check all component usage against design system
    const violations: Array<{
      type: 'composition' | 'token' | 'component';
      message: string;
      suggestion: string;
    }> = [];

    for (const node of ast.componentInstances) {
      // Validate component exists
      const component = await get_component({ name: node.name });
      if (!component) {
        violations.push({
          type: 'component',
          message: `Unknown component: ${node.name}`,
          suggestion: 'Use list_components to discover available components'
        });
      }

      // Validate composition
      if (node.parent) {
        const composition = await check_composition_rules({
          parent: node.parent,
          child: node.name
        });
        if (!composition.valid) {
          violations.push({
            type: 'composition',
            message: composition.reason!,
            suggestion: composition.suggestion!
          });
        }
      }

      // Validate token usage in props
      for (const prop of node.props) {
        if (isTokenValue(prop.value)) {
          const token = await get_tokens({ type: extractTokenType(prop.value) });
          if (!token.tokens.find(t => t.name === prop.value)) {
            violations.push({
              type: 'token',
              message: `Unknown token: ${prop.value}`,
              suggestion: 'Use get_tokens to discover available tokens'
            });
          }
        }
      }
    }

    return {
      success: violations.length === 0,
      violations
    };
  }
}
```

---

## Benefits

| Benefit | Description |
|---------|-------------|
| ✅ **Consistency** | All designs use the same components and tokens |
| ✅ **Discoverability** | LLM can explore design system capabilities |
| ✅ **Validation** | Composition rules prevent invalid structures |
| ✅ **Semantic Props** | Token references instead of CSS values |
| ✅ **Error Prevention** | Clear feedback when rules are violated |
| ✅ **Evolution** | Design system can grow without breaking existing designs |
| ✅ **Documentation** | Component examples and descriptions guide usage |

---

## Cross-References

- **[TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)** - Architecture and tool location
- **[PRD.md](./PRD.md)** - Product requirements for design system mode
- **[TOOLS-REFERENCE.md](./TOOLS-REFERENCE.md)** - File system tools reference
- **[TOOL_CALLING.md](./TOOL_CALLING.md)** - Tool calling interface specification

---

**Phase:** 4+ (Design System Mode)
**Status:** Planned
**Location:** `apps/server/src/llm/tools/design-system/`
