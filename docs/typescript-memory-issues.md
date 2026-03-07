# TypeScript Type Checking Memory Issues

## Problem

The TypeScript compiler is running out of memory (>8GB) when type-checking the server application.

## Root Cause

### Vercel AI SDK v6 + Zod v3 Compatibility Issue

The primary issue is a **known compatibility problem** between the Vercel AI SDK and Zod v3:

- The `ai` package (v6.0.100) has complex generic types that use Zod for schema validation
- When used with Zod v3, TypeScript loads Zod declarations **twice** due to module resolution issues
- This causes expensive structural type comparisons that consume massive memory
- The `ai` SDK type definition file is **248KB** (`dist/index.d.ts`)

Reference: [AI SDK Docs - TypeScript Performance with Zod](https://ai-sdk.dev/docs/troubleshooting/typescript-performance-zod)

## Solution

### ✅ Upgrade Zod to v4.1.8 or Later (FIXED)

```bash
npm install zod@^4.3.6
```

This is the **official fix** recommended by the Vercel AI SDK team. Zod v4 has improved module resolution that prevents the duplicate type loading issue.

**Critical:** Make sure ALL dependencies use Zod v4. Check with:
```bash
npm list zod
```

If you see mixed versions (some v3, some v4), you need to:
1. Remove unused AI SDK providers (e.g., `@ai-sdk/openai` if not used)
2. Force reinstall: `npm install zod@^4.3.6`

**Changes made:**
- Removed `@ai-sdk/openai` (unused, was pulling in Zod v3)
- Upgraded `zod` from v3.25.76 to v4.3.6
- All AI SDK dependencies now use Zod v4 consistently

**Result:** TypeScript typecheck now completes with 4GB memory (previously failed at 8GB+)

### Alternative: Update TypeScript Configuration

If upgrading Zod isn't possible, ensure your `tsconfig.json` uses:

```json
{
  "compilerOptions": {
    "moduleResolution": "nodenext"
  }
}
```

This is already configured in the project but alone is not sufficient with Zod v3.

## Additional Optimizations Applied

### 1. Disable Declaration Generation During Typecheck
```json
{
  "compilerOptions": {
    "declaration": false,
    "declarationMap": false,
    "composite": false
  }
}
```

### 2. Use Incremental Builds
```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo"
  }
}
```

### 3. Exclude Test Files
```json
{
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts"
  ]
}
```

### 4. Increase Node.js Memory Limit
```json
{
  "scripts": {
    "typecheck": "cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc ..."
  }
}
```

## Files Using AI SDK Types

The following files import from the `ai` package (potential memory hotspots):

- `src/ws/index.ts` - CoreMessage
- `src/routes/completion.ts` - ModelMessage  
- `src/llm/agent.ts` - ToolLoopAgent, Tool
- `src/llm/types.ts` - ModelMessage, ToolSet
- `src/llm/providers/qwen.ts` - generateText, streamText, ToolSet, ModelMessage
- `src/llm/providers/mistral.ts` - generateText, streamText, ToolSet, ModelMessage
- `src/llm/tools/*.ts` (7 files) - tool

## Diagnostic Tools

To investigate TypeScript performance issues:

```bash
# Generate trace for analysis
npx tsc --noEmit --generateTrace ./trace

# Show files being processed  
npx tsc --noEmit --explainFiles > files.txt

# Show diagnostic info
npx tsc --noEmit --diagnostics

# Check for circular dependencies
npx madge --circular --extensions ts src/

# Profile memory usage
node --inspect-brk node_modules/typescript/bin/tsc --noEmit
```

## GitHub Actions Considerations

GitHub Actions runners have limited memory:
- Standard runners: ~7GB RAM
- May need to use larger runners if issues persist
- The Zod v4 upgrade should resolve memory issues on CI

## References

- [AI SDK - TypeScript Performance with Zod](https://ai-sdk.dev/docs/troubleshooting/typescript-performance-zod)
- [TypeScript Performance Guidelines](https://github.com/microsoft/TypeScript/wiki/Performance)
- [Zod v4 Migration Guide](https://zod.dev/v4)
