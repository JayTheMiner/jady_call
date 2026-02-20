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
    if (config2[key] && typeof config2[key] === 'object' && !Array.isArray(config2[key])) {
      result[key] = mergeConfig(result[key] || {}, config2[key]);
    } else {
      result[key] = config2[key];
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
        if (format === 'comma') {
          val = [val.join(',')];
        }
        
        val.forEach((v: any, i: number) => {
          if (v === null || typeof v === 'undefined') return;
          let currentKey = key;
          if (format === 'brackets') currentKey = `${key}[]`;
          else if (format === 'index') currentKey = `${key}[${i}]`;
          
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
    if (hashmarkIndex !== -1) {
      url = url.slice(0, hashmarkIndex);
    }
    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
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
