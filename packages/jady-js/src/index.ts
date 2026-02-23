import { JadyConfig, JadyResponse, Method } from './types';
import { dispatchRequest } from './cors';
import { mergeConfig } from './utils';

export * from './types';

export interface JadyInstance {
  <T = any>(config: JadyConfig): Promise<JadyResponse<T>>;
  create(config?: Partial<JadyConfig>): JadyInstance;

  get<T = any>(url: string, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  delete<T = any>(url: string, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  head<T = any>(url: string, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  options<T = any>(url: string, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  post<T = any>(url: string, data?: any, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  put<T = any>(url: string, data?: any, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
  patch<T = any>(url: string, data?: any, config?: Partial<JadyConfig>): Promise<JadyResponse<T>>;
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


export function create(defaultConfig: Partial<JadyConfig> = {}): JadyInstance {
  const instance = async function<T = any>(config: JadyConfig) {
    const merged = mergeConfig(defaultConfig, config);
    const res = await dispatchRequest(merged);
    return attachAliases(res as JadyResponse<T>);
  } as JadyInstance;

  instance.create = (childConfig?: Partial<JadyConfig>) => create(mergeConfig(defaultConfig, childConfig || {}));

  const noBodyMethods: Method[] = ['get', 'delete', 'head', 'options'];
  noBodyMethods.forEach((method) => {
    (instance as any)[method] = (url: string, config: Partial<JadyConfig> = {}) => {
      return instance({ ...config, url, method });
    };
  });

  const bodyMethods: Method[] = ['post', 'put', 'patch'];
  bodyMethods.forEach((method) => {
    (instance as any)[method] = (url: string, data: any, config: Partial<JadyConfig> = {}) => {
      return instance({ ...config, url, method, data });
    };
  });

  return instance;
}

const jady = create({});

export const call = jady;
export default jady;