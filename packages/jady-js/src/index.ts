import { JadyConfig, JadyResponse } from './types';
import { dispatchRequest } from './cors';
import { mergeConfig } from './utils';

export * from './types';

export interface JadyInstance {
  (config: JadyConfig): Promise<JadyResponse>;
  create(config?: Partial<JadyConfig>): JadyInstance;
}

function attachAliases<T>(res: JadyResponse<T>): JadyResponse<T> {
  // axios 호환: res.data === res.body
  if (!Object.getOwnPropertyDescriptor(res, "data")) {
    Object.defineProperty(res, "data", {
      enumerable: false,     // console.log에 안보이게
      configurable: false,
      get() {
        return res.body;
      }
    });
  }

  return res;
}


export async function call<T = any>(config: JadyConfig): Promise<JadyResponse<T>> {
  const res = await dispatchRequest(config) as JadyResponse<T>;
  return attachAliases(res);
}

export function create(defaultConfig: Partial<JadyConfig> = {}): JadyInstance {
  const instance = async function(config: JadyConfig) {
  const merged = mergeConfig(defaultConfig, config);
  const res = await dispatchRequest(merged);
  return attachAliases(res);
} as JadyInstance;

  instance.create = (childConfig?: Partial<JadyConfig>) => create(mergeConfig(defaultConfig, childConfig || {}));

  return instance;
}

export default call;