import { z } from 'zod';
import { FreshnessStatusSchema } from './document.js';

export const BranchStateSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  repository_id: z.string(),
  branch_id: z.string(),
  branch_name: z.string().optional(),
  target_branch: z.string().optional(),
  base_branch: z.string().optional(),
  last_rendered_target_commit: z.string().default(''),
  current_target_commit: z.string().default(''),
  last_rendered_base_commit: z.string().default(''),
  current_base_commit: z.string().default(''),
  last_rendered_worktree_fingerprint: z.string().default(''),
  current_worktree_fingerprint: z.string().default(''),
  status: FreshnessStatusSchema,
  pending_new_commits_count: z.number().default(0),
  pending_changed_files_count: z.number().default(0),
  rendered_commits_count: z.number().default(0),
  rendered_changed_files_count: z.number().default(0),
  rendered_insertions: z.number().default(0),
  rendered_deletions: z.number().default(0),
  // Aliases for backward compatibility
  last_rendered_head: z.string().default(''),
  current_head: z.string().default(''),
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
