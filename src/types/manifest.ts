import { z } from 'zod';

export const PlatformSchema = z.enum(['android', 'ios']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ReleaseManifestSchema = z.object({
  id: z.string(),
  appId: z.string().min(1),
  platform: PlatformSchema,
  runtimeVersion: z.string().min(1),
  channel: z.string().default('production'),
  bundleHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a valid 64-char hex SHA-256 hash'),
  // Absolute URL, or a path resolved against serverUrl.
  bundleUrl: z.string().min(1),
  bundleSize: z.number().nonnegative(),
  isMandatory: z.boolean().default(false),
  rolloutPercentage: z.number().min(0).max(100).default(100),
  createdAt: z.string().datetime({ offset: true }),
});

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
