/**
 * Utility functions for jady-js
 */

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
