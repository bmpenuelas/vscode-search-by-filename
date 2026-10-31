export interface Options { ignoreCase: boolean; useRegex: boolean; includeIgnored: boolean }
export interface SearchFile { id: string; name: string; lowerName: string; relativePath: string; normal: boolean }
export interface SearchResult { ids: string[]; total: number; error?: string }
export const optionKeys = ['ignoreCase', 'useRegex', 'includeIgnored'] as const;
export type OptionKey = typeof optionKeys[number];
