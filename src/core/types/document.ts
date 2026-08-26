import { z } from 'zod';

export const FreshnessStatusSchema = z.enum([
  'FRESH',
  'STALE_NEW_COMMITS',
  'STALE_WORKTREE',
  'STALE_BASE_CHANGED',
  'REQUIRES_FULL_REBUILD',
  'UPDATING',
  'UPDATE_FAILED',
]);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

export const WorkingTreeStateSchema = z.enum(['clean', 'dirty']);
export type WorkingTreeState = z.infer<typeof WorkingTreeStateSchema>;

export const DocumentContentSchema = z.object({
  intent: z.record(z.string(), z.any()).default({}),
  scope: z.record(z.string(), z.any()).default({}),
  changes: z.array(z.any()).default([]),
  architecture: z.record(z.string(), z.any()).default({}),
  tests: z.record(z.string(), z.any()).default({}),
  dependencies: z.array(z.any()).default([]),
  risks: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  next_relevant_files: z.array(z.string()).default([]),
  summary: z.string().optional(),
});
export type DocumentContent = z.infer<typeof DocumentContentSchema>;

export const DocumentSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  document_id: z.string(),
  document_type: z.literal('branch-context').default('branch-context'),
  repository: z.object({
    id: z.string(),
    name: z.string(),
  }),
  branch: z.object({
    id: z.string(),
    name: z.string(),
  }),
  source: z.object({
    base_ref: z.string(),
    base_commit: z.string(),
    head_commit: z.string(),
    working_tree_state: WorkingTreeStateSchema.default('clean'),
    includes_uncommitted_changes: z.boolean().default(false),
  }),
  freshness: z.object({
    status: FreshnessStatusSchema,
    rendered_at: z.string().datetime(),
    analyzer_version: z.string().default('1.0.0'),
    renderer_version: z.string().default('1.0.0'),
  }),
  content: DocumentContentSchema,
  evidence_refs: z.array(z.string()).default([]),
});

export type BranchDocument = z.infer<typeof DocumentSchema>;
