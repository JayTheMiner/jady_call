import { JadyConfig, JadyResponse, JadyError, JadyErrorCodes } from './types';
import { buildFullPath, mergeConfig, isAbsoluteURL, combineURLs, substitutePath, buildURL, createError, processHeaders } from './utils';
import fetchAdapter from './adapters/fetch';

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
  },
  adapter: fetchAdapter
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: any): boolean {
  return error.code !== JadyErrorCodes.ECANCELED &&
         error.code !== JadyErrorCodes.EMAXREDIRECTS &&
         error.code !== JadyErrorCodes.EPARSE;
}

function getRetryDelay(config: JadyConfig, retryCount: number, error: any, response?: JadyResponse): number {
  // Check Retry-After header
  if (response?.headers?.['retry-after']) {
    const retryAfter = parseInt(response.headers['retry-after'] as string, 10);
    if (!isNaN(retryAfter)) return retryAfter * 1000;
  }
  return typeof config.retryDelay === 'function' ? config.retryDelay(retryCount, error) : (config.retryDelay || 0);
}

/**
 * Core logic to process config and dispatch request.
 */
export async function dispatchRequest(userConfig: JadyConfig): Promise<JadyResponse> {
  // 1. Merge with defaults
  let config = mergeConfig(defaults, userConfig) as JadyConfig;
  const startTime = Date.now();

  // Process Headers (Normalize & Validate)
  config.headers = processHeaders(config.headers);

  // 2. URL Handling
  if (config.baseUrl && !isAbsoluteURL(config.url)) {
    config.url = buildFullPath(config.baseUrl, config.url);
  }

  // Path Params Substitution
  if (config.path) {
    config.url = substitutePath(config.url, config.path);
  }

  // Query Params Serialization
  config.url = buildURL(config.url, config.params, config.paramsSerializer, config.paramsArrayFormat);

  // 3. Validation (Fail Fast)
  if (!config.url) {
    throw new Error('url is required');
  }

  // 4. Hooks: beforeRequest
  if (config.hooks?.beforeRequest) {
    config = await config.hooks.beforeRequest(config);
  }

  let retryCount = 0;
  let redirectCount = 0;
  let response: JadyResponse | undefined;
  let error: any;

  while (true) {
    // Check Total Timeout
    if (config.totalTimeout && config.totalTimeout > 0) {
      if (Date.now() - startTime > config.totalTimeout) {
        throw createError('Total timeout exceeded', JadyErrorCodes.ETIMEDOUT, config);
      }
    }

    try {
      // 5. Adapter Execution
      if (!config.adapter) {
        throw createError('Adapter not implemented yet', JadyErrorCodes.EUNKNOWN, config);
      }
      
      response = await config.adapter(config);
      
      // 6. Validate Status
      const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300);
      if (validateStatus(response.status)) {
        // Success
        break;
      }

      // 7. Handle Redirects (3xx)
      if (config.redirect === 'follow' && response.status >= 300 && response.status < 400 && response.headers['location']) {
        if (redirectCount >= (config.maxRedirects || 10)) {
          throw createError('Max redirects exceeded', JadyErrorCodes.EMAXREDIRECTS, config, response);
        }

        const location = response.headers['location'] as string;
        let nextUrl = isAbsoluteURL(location) ? location : combineURLs(config.url.replace(/\/[^\/]*$/, ''), location);
        
        // Handle 301, 302, 303 -> Change to GET
        let nextMethod = config.method;
        let nextData = config.data;
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          nextMethod = 'GET';
          nextData = undefined;
        }

        // Create next config
        const nextConfig = { ...config, url: nextUrl, method: nextMethod, data: nextData };

        // Security: Strip headers on cross-domain redirect
        // Simple check: if host changes (implementation simplified for now)
        // In a real implementation, we would parse the URL to check host/port/protocol
        
        if (config.hooks?.beforeRedirect) {
          await config.hooks.beforeRedirect(nextConfig, response);
        }

        config = nextConfig;
        redirectCount++;
        continue;
      }

      // 8. Handle Retry on Error Status (e.g. 429, 5xx)
      // If validateStatus failed, we are here. Check if we should retry.
      // Default condition: 5xx or 429
      const isRetryStatus = response.status === 429 || response.status >= 500;
      
      if (isRetryStatus && retryCount < (config.retry || 0)) {
        const delay = getRetryDelay(config, retryCount + 1, null, response);

        // Check if waiting would exceed totalTimeout
        if (config.totalTimeout && config.totalTimeout > 0 && (Date.now() - startTime + delay > config.totalTimeout)) {
           throw createError('Total timeout exceeded during retry delay', JadyErrorCodes.ETIMEDOUT, config, response);
        }
        
        if (config.hooks?.beforeRetry) {
           const hookResult = await config.hooks.beforeRetry(createError(`Request failed with status ${response.status}`, JadyErrorCodes.ENETWORK, config, response), retryCount + 1);
           if (hookResult === false) throw createError(`Request failed with status ${response.status}`, JadyErrorCodes.ENETWORK, config, response);
           if (typeof hookResult === 'object') config = hookResult as JadyConfig;
        }

        await sleep(delay);
        retryCount++;
        continue;
      }

      // If not retrying, throw error for invalid status
      throw createError(`Request failed with status code ${response.status}`, JadyErrorCodes.ENETWORK, config, response);

    } catch (e: any) {
      error = e;
      response = error.response; // Recover response if available in error

      // Check if retry is allowed
      if (isRetryableError(error) && retryCount < (config.retry || 0)) {
        // Custom retry condition
        let shouldRetry = true;
        if (config.retryCondition) {
          shouldRetry = await config.retryCondition(error, retryCount + 1);
        }

        if (shouldRetry) {
          const delay = getRetryDelay(config, retryCount + 1, error);

          // Check if waiting would exceed totalTimeout
          if (config.totalTimeout && config.totalTimeout > 0 && (Date.now() - startTime + delay > config.totalTimeout)) {
             throw createError('Total timeout exceeded during retry delay', JadyErrorCodes.ETIMEDOUT, config, undefined, error);
          }
          
          if (config.hooks?.beforeRetry) {
            const hookResult = await config.hooks.beforeRetry(error, retryCount + 1);
            if (hookResult === false) break; // Stop retrying
            if (typeof hookResult === 'object') config = hookResult as JadyConfig;
          }

          await sleep(delay);
          retryCount++;
          continue;
        }
      }
      
      // If we are here, we are not retrying anymore.
      break;
    }
  }

  // 9. Final Error Handling or Success
  if (error) {
    if (config.hooks?.beforeError) {
      throw await config.hooks.beforeError(error);
    }
    throw error;
  }

  // 10. Hooks: afterResponse
  if (config.hooks?.afterResponse) {
    response = await config.hooks.afterResponse(response!);
  }

  return response!;
}
