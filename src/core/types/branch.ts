import { z } from 'zod';

export const BranchStatusSchema = z.enum(['active', 'archived', 'deleted']);
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

export const BranchSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  repository_id: z.string(),
  branch_id: z.string(),
  branch_name: z.string(),
  base_ref: z.string(),
  document_id: z.string(),
  document_path: z.string().default('document.json'),
  status: BranchStatusSchema.default('active'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Branch = z.infer<typeof BranchSchema>;
