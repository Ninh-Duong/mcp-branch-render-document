import { z } from 'zod';

export const RepositorySchema = z.object({
  schema_version: z.string().default('1.0.0'),
  repository_id: z.string(),
  name: z.string(),
  path: z.string(),
  remote_urls: z.array(z.string()).default([]),
  default_branch: z.string().default('main'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Repository = z.infer<typeof RepositorySchema>;
