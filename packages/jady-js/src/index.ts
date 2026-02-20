import { JadyConfig, JadyResponse } from './types';
import { dispatchRequest } from './cors';

export * from './types';

export async function call<T = any>(config: JadyConfig): Promise<JadyResponse<T>> {
  return dispatchRequest(config) as Promise<JadyResponse<T>>;
}

export default call;