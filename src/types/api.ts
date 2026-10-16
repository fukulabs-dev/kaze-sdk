import { z } from 'zod';
import { PlatformSchema, ReleaseManifestSchema } from './manifest';

export const CheckUpdateRequestSchema = z.object({
  appId: z.string().min(1),
  platform: PlatformSchema,
  runtimeVersion: z.string().min(1),
  channel: z.string().default('production'),
  currentHash: z.string().optional(),
  deviceId: z.string().optional(),
});
export type CheckUpdateRequest = z.infer<typeof CheckUpdateRequestSchema>;

export const CheckUpdateResponseSchema = z.object({
  updateAvailable: z.boolean(),
  manifest: ReleaseManifestSchema.optional(),
});
export type CheckUpdateResponse = z.infer<typeof CheckUpdateResponseSchema>;

export const ReportUpdateRequestSchema = z.object({
  appId: z.string().min(1),
  releaseId: z.string().min(1),
  deviceId: z.string().min(1),
  status: z.enum(['installed', 'crashed']),
  error: z.string().optional(),
});
export type ReportUpdateRequest = z.infer<typeof ReportUpdateRequestSchema>;
