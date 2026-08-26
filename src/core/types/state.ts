import { z } from 'zod';
import { FreshnessStatusSchema } from './document.js';

export const BranchStateSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  repository_id: z.string(),
  branch_id: z.string(),
  last_rendered_head: z.string(),
  current_head: z.string(),
  last_rendered_base_commit: z.string(),
  current_base_commit: z.string(),
  last_rendered_worktree_fingerprint: z.string(),
  current_worktree_fingerprint: z.string(),
  status: FreshnessStatusSchema,
  new_commits_count: z.number().default(0),
  changed_files_count: z.number().default(0),
  last_checked_at: z.string().datetime(),
  last_rendered_at: z.string().datetime(),
  last_valid_document_head: z.string().optional(),
  error: z.string().optional(),
  analyzer_version: z.string().default('1.0.0'),
  renderer_version: z.string().default('1.0.0'),
});

export type BranchState = z.infer<typeof BranchStateSchema>;
