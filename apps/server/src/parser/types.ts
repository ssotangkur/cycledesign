export interface InjectionResult {
  added: number;
  removed: number;
  duplicates: number;
  unchanged: number;
}

export interface InjectIdsResult {
  code: string;
  result: InjectionResult;
}
