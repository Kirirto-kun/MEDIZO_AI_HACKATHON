// Shared cross-client types. Populated in SP-1 when packages/core is extracted.
export type Result<T> = { success: true; data: T } | { success: false; error: string };

export * from './case';
export * from './mobile-surface';
