import { z } from 'zod';

export const RendererModeSchema = z.enum(['agent-assisted', 'deterministic', 'external-model']);
export type RendererMode = z.infer<typeof RendererModeSchema>;

export const RefreshScopeSchema = z.enum(['current', 'stale', 'all', 'none']);
export type RefreshScope = z.infer<typeof RefreshScopeSchema>;

export const FreshnessModeSchema = z.enum(['required', 'auto', 'check_only', 'allow_stale']);
export type FreshnessMode = z.infer<typeof FreshnessModeSchema>;

export const ConfigSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  storage_path: z.string(),
  default_base_ref: z.string().default('origin/main'),
  default_refresh_scope: RefreshScopeSchema.default('current'),
  include_working_tree: z.boolean().default(true),
  default_renderer_mode: RendererModeSchema.default('deterministic'),
  default_freshness_mode: FreshnessModeSchema.default('required'),
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
