import { JadyConfig, JadyResponse } from './types';
import { buildFullPath, mergeConfig } from './utils';

/**
 * Default configuration for jady.call
 */
const defaults: Partial<JadyConfig> = {
  method: 'GET',
  timeout: 30000,
  totalTimeout: 0,
  paramsArrayFormat: 'repeat',
  cookieMode: 'none',
  redirect: 'follow',
  maxRedirects: 10,
  retry: 0,
  retryDelay: 0,
  responseType: 'auto',
  responseEncoding: 'utf-8',
  decompress: true,
  validateStatus: (status: number) => status >= 200 && status < 300,
  headers: {
    'Accept': 'application/json, text/plain, */*'
  }
};

/**
 * Core logic to process config and dispatch request.
 */
export async function dispatchRequest(userConfig: JadyConfig): Promise<JadyResponse> {
  // 1. Merge with defaults
  const config = mergeConfig(defaults, userConfig) as JadyConfig;

  // 2. URL Handling
  if (config.baseUrl && !config.url.startsWith('http')) {
    config.url = buildFullPath(config.baseUrl, config.url);
  }

  // 3. Validation (Fail Fast)
  if (!config.url) {
    throw new Error('url is required');
  }

  // TODO: Implement Adapter logic, Hooks, Retry, etc.
  throw new Error('Adapter not implemented yet');
}
