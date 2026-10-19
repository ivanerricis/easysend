import { healthResponseSchema, type HealthResponse } from '@easysend/shared';

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const init: RequestInit = { headers: { Accept: 'application/json' } };
  if (signal) init.signal = signal;
  const response = await fetch('/api/health', init);
  if (!response.ok) throw new ApiError(`Health check failed with status ${response.status}`);
  const parsed = healthResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError('Unexpected health response');
  return parsed.data;
}
