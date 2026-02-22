export interface ValidationError {
  type: 'typescript' | 'eslint' | 'knip' | 'dependency';
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  suggestion?: string;
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}



export interface ESLintError {
  file: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  severity: number;
}

export interface KnipError {
  file: string;
  line?: number;
  message: string;
  type: 'unused' | 'unresolved';
}
