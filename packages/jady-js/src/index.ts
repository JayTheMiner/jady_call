import { JadyConfig, JadyResponse } from './types';
import { dispatchRequest } from './cors';
import { mergeConfig } from './utils';

export * from './types';

export interface JadyInstance {
  (config: JadyConfig): Promise<JadyResponse>;
  create(config?: Partial<JadyConfig>): JadyInstance;
}

export async function call<T = any>(config: JadyConfig): Promise<JadyResponse<T>> {
  return dispatchRequest(config) as Promise<JadyResponse<T>>;
}

export function create(defaultConfig: Partial<JadyConfig> = {}): JadyInstance {
  const instance = async function(config: JadyConfig) {
    const merged = mergeConfig(defaultConfig, config);
    return dispatchRequest(merged);
  } as JadyInstance;

  instance.create = (childConfig?: Partial<JadyConfig>) => create(mergeConfig(defaultConfig, childConfig || {}));

  return instance;
}

export default call;