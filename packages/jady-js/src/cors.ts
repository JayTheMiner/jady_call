import { JadyConfig, JadyResponse, JadyError, JadyErrorCodes, JadyAttempt } from './types';
import { buildFullPath, mergeConfig, isAbsoluteURL, combineURLs, substitutePath, buildURL, createError, processHeaders, parseCookie } from './utils';
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

function sleep(ms: number, config: JadyConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = config.signal;
    if (signal?.aborted) {
      return reject(createError('Canceled', JadyErrorCodes.ECANCELED, config));
    }

    const timer = setTimeout(() => {
      resolve();
      signal?.removeEventListener('abort', onAbort);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(createError('Canceled', JadyErrorCodes.ECANCELED, config));
    };

    signal?.addEventListener('abort', onAbort);
  });
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

  // XSRF Handling (Browser only)
  if (typeof document !== 'undefined' && config.xsrfCookieName && config.xsrfHeaderName) {
    const xsrfValue = parseCookie(document.cookie, config.xsrfCookieName);
    if (xsrfValue && !config.headers[config.xsrfHeaderName.toLowerCase()]) {
      config.headers[config.xsrfHeaderName.toLowerCase()] = xsrfValue;
    }
  }

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

  if (config.auth) {
    const { username, bearer } = config.auth as any;
    if (username !== undefined && bearer !== undefined) {
      throw new Error('Cannot use both Basic and Bearer authentication');
    }
  }

  // 4. Hooks: beforeRequest
  if (config.hooks?.beforeRequest) {
    config = await config.hooks.beforeRequest(config);
  }

  let retryCount = 0;
  let redirectCount = 0;
  let response: JadyResponse | undefined;
  let error: any;
  const attempts: JadyAttempt[] = [];

  while (true) {
    const attemptStartTime = Date.now();
    // Check Total Timeout
    if (config.totalTimeout && config.totalTimeout > 0) {
      if (Date.now() - startTime > config.totalTimeout) {
        throw createError('Total timeout exceeded', JadyErrorCodes.ETIMEDOUT, config);
      }
    }

    try {
      // Reset error from previous attempts
      error = undefined;

      // 5. Adapter Execution
      if (!config.adapter) {
        throw createError('Adapter not implemented yet', JadyErrorCodes.EUNKNOWN, config);
      }
      
      response = await config.adapter(config);

      attempts.push({
        url: response.url,
        duration: response.duration,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
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

        // 명세에 따른 보안 조치: Cross-domain 리다이렉트 시 민감한 헤더를 제거합니다.
        // (주로 서버 환경에 해당하며, 브라우저는 자체 보안 정책을 따릅니다.)
        try {
          const currentOrigin = new URL(config.url).origin;
          const nextOrigin = new URL(nextUrl).origin;
          if (currentOrigin !== nextOrigin) {
            delete nextConfig.headers?.['authorization'];
            delete nextConfig.headers?.['cookie'];
          }
        } catch (e) { /* URL 파싱 에러는 무시 */ }
        
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
      
      const statusError = createError(`Request failed with status code ${response.status}`, JadyErrorCodes.ENETWORK, config, response);
      
      if (attempts.length > 0) {
        attempts[attempts.length - 1].error = { code: statusError.code, message: statusError.message };
      }

      if (isRetryStatus && retryCount < (config.retry || 0)) {
        const delay = getRetryDelay(config, retryCount + 1, statusError, response);

        // Check if waiting would exceed totalTimeout
        if (config.totalTimeout && config.totalTimeout > 0 && (Date.now() - startTime + delay > config.totalTimeout)) {
           throw createError('Total timeout exceeded during retry delay', JadyErrorCodes.ETIMEDOUT, config, response);
        }
        
        if (config.hooks?.beforeRetry) {
           const hookResult = await config.hooks.beforeRetry(statusError, retryCount + 1);
           if (hookResult === false) throw statusError;
           if (typeof hookResult === 'object') config = hookResult as JadyConfig;
        }

        await sleep(delay, config);
        retryCount++;
        continue;
      }

      // If not retrying, throw error for invalid status
      throw statusError; //생성해둔 에러 발생

    } catch (e: any) {
      error = e;
      response = error.response; // Recover response if available in error

      attempts.push({
        url: config.url,
        duration: Date.now() - attemptStartTime,
        error: { code: error.code || JadyErrorCodes.EUNKNOWN, message: error.message }
      });

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

          await sleep(delay, config);
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

  if (response) {
    response.attempts = attempts;
    response.totalDuration = Date.now() - startTime;
  }

  return response!;
}
