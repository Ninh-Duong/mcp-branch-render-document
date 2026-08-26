import { z } from 'zod';

export const HistoryEventTypeSchema = z.enum([
  'created',
  'updated',
  'rebuild_required',
  'update_failed',
  'archived',
]);
export type HistoryEventType = z.infer<typeof HistoryEventTypeSchema>;

export const HistoryEventSchema = z.object({
  type: HistoryEventTypeSchema,
  timestamp: z.string().datetime(),
  head: z.string().optional(),
  from_head: z.string().optional(),
  to_head: z.string().optional(),
  new_commits: z.number().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
