import { z } from 'zod';
import { FreshnessStatusSchema } from './document.js';

export const CatalogBranchEntrySchema = z.object({
  branch_id: z.string(),
  branch_name: z.string(),
  document_id: z.string(),
  document_path: z.string(),
  status: FreshnessStatusSchema,
  last_rendered_head: z.string(),
  last_rendered_at: z.string().datetime(),
  new_commits_count: z.number().default(0),
  changed_files_count: z.number().default(0),
});

export type CatalogBranchEntry = z.infer<typeof CatalogBranchEntrySchema>;

export const CatalogRepositoryEntrySchema = z.object({
  repository_id: z.string(),
  name: z.string(),
  path: z.string(),
  default_branch: z.string(),
  branches: z.array(CatalogBranchEntrySchema).default([]),
});

export type CatalogRepositoryEntry = z.infer<typeof CatalogRepositoryEntrySchema>;

export const CatalogSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  updated_at: z.string().datetime(),
  repositories: z.array(CatalogRepositoryEntrySchema).default([]),
});

export type Catalog = z.infer<typeof CatalogSchema>;
