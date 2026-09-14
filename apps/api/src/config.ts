import { z } from 'zod';

const runtimeSchema = z
  .object({
    AI_PROVIDER: z.enum(['disabled', 'gemini']).default('disabled'),
    GEMINI_API_KEY: z.string().trim().min(1).optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  })
  .superRefine((config, context) => {
    if (config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'GEMINI_API_KEY is required when AI_PROVIDER is gemini.',
        path: ['GEMINI_API_KEY'],
      });
    }
  });

export type RuntimeConfig = Readonly<z.infer<typeof runtimeSchema>>;

export class ConfigurationError extends Error {
  public constructor() {
    super('Server configuration is invalid. Check the local environment configuration.');
    this.name = 'ConfigurationError';
  }
}

export function loadRuntimeConfig(environment: Record<string, string | undefined>): RuntimeConfig {
  const result = runtimeSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError();
  }

  return Object.freeze(result.data);
}
