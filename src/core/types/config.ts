import { z } from 'zod';

export const RendererModeSchema = z.enum(['agent-assisted', 'deterministic', 'external-model']);
export type RendererMode = z.infer<typeof RendererModeSchema>;

export const RefreshScopeSchema = z.enum(['current', 'stale', 'all', 'none']);
export type RefreshScope = z.infer<typeof RefreshScopeSchema>;

export const FreshnessModeSchema = z.enum(['required', 'auto', 'check_only', 'allow_stale']);
export type FreshnessMode = z.infer<typeof FreshnessModeSchema>;

export const StorageModeSchema = z.enum(['repo-local', 'global', 'custom']);
export type StorageMode = z.infer<typeof StorageModeSchema>;

export const ConfigSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  storage_mode: StorageModeSchema.default('repo-local'),
  storage_path: z.string().nullable().optional(),
  default_base_ref: z.string().optional(),
  default_refresh_scope: RefreshScopeSchema.default('current'),
  include_working_tree: z.boolean().default(false),
  default_renderer_mode: RendererModeSchema.default('deterministic'),
  default_freshness_mode: FreshnessModeSchema.default('required'),
  auto_update_gitignore: z.boolean().default(true),
  max_diff_bytes: z.number().default(1024 * 1024 * 5), // 5MB
  secret_patterns: z.array(z.string()).default([
    '**/.env*',
    '**/*.pem',
    '**/*.key',
    '**/id_rsa*',
    '**/credentials*',
    '**/secrets*',
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
