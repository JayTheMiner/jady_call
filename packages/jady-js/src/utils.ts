import { JadyConfig, JadyResponse, JadyError } from './types';

/**
 * Utility functions for jady-js
 */

export function isDate(val: any): val is Date {
  return Object.prototype.toString.call(val) === '[object Date]';
}

export function isObject(val: any): val is Object {
  return val !== null && typeof val === 'object';
}

/**
 * Combines a base URL and a relative URL.
 * Handles slash normalization.
 */
export function combineURLs(baseURL: string, relativeURL: string): string {
  return relativeURL
    ? baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '')
    : baseURL;
}

/**
 * Checks if a URL is absolute.
 */
export function isAbsoluteURL(url: string): boolean {
  // A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
  // RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed by any combination of letters, digits, plus (+), period (.), or hyphen (-).
  return /^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(url);
}

/**
 * Builds the full URL by combining baseURL and requested URL.
 */
export function buildFullPath(baseURL?: string, requestedURL?: string): string {
  if (baseURL && !isAbsoluteURL(requestedURL || '')) {
    return combineURLs(baseURL, requestedURL || '');
  }
  return requestedURL || '';
}

/**
 * Deep merges two objects.
 * Simple implementation for config merging.
 */
export function mergeConfig(config1: any, config2: any): any {
  const result = { ...config1 };
  for (const key in config2) {
    const val = config2[key];
    // Only deep merge plain objects to preserve class instances (like AbortSignal, FormData)
    if (val && typeof val === 'object' && !Array.isArray(val) && val.constructor === Object) {
      result[key] = mergeConfig(result[key] || {}, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function encode(val: string): string {
  return encodeURIComponent(val)
    .replace(/%3A/gi, ':')
    .replace(/%24/gi, '$')
    .replace(/%2C/gi, ',')
    .replace(/%20/g, '+')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']');
}

/**
 * Substitutes path parameters in the URL.
 */
export function substitutePath(url: string, pathParams?: Record<string, string | number>): string {
  if (!pathParams) return url;
  let newUrl = url;
  for (const key in pathParams) {
    if (Object.prototype.hasOwnProperty.call(pathParams, key)) {
      const val = pathParams[key];
      const encodedVal = encodeURIComponent(String(val));
      newUrl = newUrl.replace(new RegExp(`\\{${key}\\}|:${key}\\b`, 'g'), encodedVal);
    }
  }
  return newUrl;
}

/**
 * Builds the URL with query parameters.
 */
export function buildURL(url: string, params?: any, paramsSerializer?: (params: any) => string, paramsArrayFormat?: string): string {
  if (!params) {
    return url;
  }

  let serializedParams;

  if (paramsSerializer) {
    serializedParams = paramsSerializer(params);
    // Remove leading '?' if present
    if (serializedParams && serializedParams.startsWith('?')) {
      serializedParams = serializedParams.slice(1);
    }
  } else if (typeof URLSearchParams !== 'undefined' && params instanceof URLSearchParams) {
    serializedParams = params.toString();
  } else {
    const parts: string[] = [];

    Object.keys(params).forEach(key => {
      let val = params[key];
      if (val === null || typeof val === 'undefined') {
        return;
      }

      if (Array.isArray(val)) {
        const format = paramsArrayFormat || 'repeat';
        
        // Filter null/undefined
        const validValues = val.filter((v: any) => v !== null && typeof v !== 'undefined');
        if (validValues.length === 0) return;

        if (format === 'comma') {
          const stringifiedValues = validValues.map((v: any) => {
             if (isDate(v)) return v.toISOString();
             if (isObject(v)) throw new Error(`Nested object in params is not supported: ${key}`);
             return String(v);
          });
          parts.push(`${encode(key)}=${encode(stringifiedValues.join(','))}`);
          return;
        }
        
        let indexCounter = 0;
        validValues.forEach((v: any) => {
          let currentKey = key;
          if (format === 'brackets') currentKey = `${key}[]`;
          else if (format === 'index') {
            currentKey = `${key}[${indexCounter}]`;
            indexCounter++;
          }
          
          if (isDate(v)) {
            v = v.toISOString();
          } else if (isObject(v)) {
            throw new Error(`Nested object in params is not supported: ${key}`);
          }
          parts.push(`${encode(currentKey)}=${encode(String(v))}`);
        });
        return;
      }

      if (isDate(val)) {
        val = val.toISOString();
      } else if (isObject(val)) {
        throw new Error(`Nested object in params is not supported: ${key}`);
      }

      parts.push(`${encode(key)}=${encode(String(val))}`);
    });

    serializedParams = parts.join('&');
  }

  if (serializedParams) {
    const hashmarkIndex = url.indexOf('#');
    let hash = '';
    if (hashmarkIndex !== -1) {
      hash = url.slice(hashmarkIndex);
      url = url.slice(0, hashmarkIndex);
    }
    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams + hash;
  }

  return url;
}

export function createError(message: string, code: string, config: JadyConfig, response?: JadyResponse, originalError?: any): JadyError {
  const error = new Error(message) as JadyError;
  error.code = code;
  error.config = config;
  error.response = response;
  if (originalError) {
    error.stack = originalError.stack;
    error.cause = originalError;
  }
  return error;
}

/**
 * Normalizes and validates headers.
 * - Keys are normalized to lowercase.
 * - Null/Undefined values are removed.
 * - Validates against invalid characters.
 */
export function processHeaders(headers: any): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers || typeof headers !== 'object') return normalized;

  Object.keys(headers).forEach(key => {
    if (!key) return;
    // Basic validation for header name
    if (/[^a-zA-Z0-9\-!#$%&'*+.^_`|~]/.test(key)) {
      throw new Error(`Invalid header name: "${key}"`);
    }

    const value = headers[key];
    if (value === null || typeof value === 'undefined') return;

    let strValue: string;
    if (Array.isArray(value)) {
      strValue = value.join(',');
    } else if (isDate(value)) {
      strValue = value.toUTCString();
    } else {
      strValue = String(value);
    }

    if (/[\r\n]/.test(strValue)) throw new Error(`Invalid header value for "${key}"`);

    normalized[key.toLowerCase()] = strValue;
  });

  return normalized;
}

export function parseCookie(cookieString: string, name: string): string | null {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}
