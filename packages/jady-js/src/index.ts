import { JadyConfig, JadyResponse } from './types';

export * from './types';

export async function call<T = any>(config: JadyConfig): Promise<JadyResponse<T>> {
  // Implementation will go here
  throw new Error('Not implemented');
}

export default call;