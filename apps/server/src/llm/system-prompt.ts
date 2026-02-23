import { readFileSync } from 'fs';
import { join } from 'path';

const PROMPT_PATH = join(process.cwd(), 'resources/prompts/system-prompt.md');

export const SYSTEM_PROMPT = readFileSync(PROMPT_PATH, 'utf-8');
