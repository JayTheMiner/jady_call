import { JadyConfig, JadyResponse, JadyErrorCodes } from '../types';
import { createError } from '../utils';

export default async function fetchAdapter(config: JadyConfig): Promise<JadyResponse> {
  const headers = { ...(config.headers || {}) } as Record<string, string>;

  // 1. Auth Handling
  if (config.auth) {
    const { username, password, bearer } = config.auth as any;
    // Only add if not already present (case-insensitive check needed in real impl, simplified here)
    if (!headers['Authorization'] && !headers['authorization']) {
      if (username !== undefined) {
        // Basic Auth
        const encoded = typeof btoa !== 'undefined' 
          ? btoa(unescape(encodeURIComponent(`${username}:${password || ''}`)))
          : Buffer.from(`${username}:${password || ''}`).toString('base64');
        headers['authorization'] = `Basic ${encoded}`;
      } else if (bearer) {
        // Bearer Auth
        headers['authorization'] = `Bearer ${bearer}`;
      }
    }
  }

  // 2. Body & Files Handling
  let body: any = config.data;
  const isBodyAllowed = !config.method || !['GET', 'HEAD'].includes(config.method.toUpperCase());

  if (!isBodyAllowed) {
    body = undefined;
  } else if (config.files) {
    if (config.data && (typeof config.data !== 'object' || config.data.constructor !== Object)) {
      throw createError('data must be a plain object when using files', JadyErrorCodes.ENETWORK, config);
    }

    const formData = new FormData();
    
    // Append data fields
    if (config.data && typeof config.data === 'object') {
      Object.keys(config.data).forEach(key => {
        const value = config.data[key];
        if (value === null || value === undefined) return;
        
        const append = (v: any) => {
          formData.append(key, v instanceof Date ? v.toISOString() : String(v));
        };

        if (Array.isArray(value)) {
          value.forEach(v => append(v));
        } else {
          append(value);
        }
      });
    }

    // Append files
    Object.keys(config.files).forEach(key => {
      const fileOrFiles = config.files![key];
      const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
      
      files.forEach((file: any) => {
        if (file === null || file === undefined) return;
        if (file.file) {
          formData.append(key, file.file, file.filename);
        } else {
          formData.append(key, file);
        }
      });
    });

    body = formData;
    // Remove Content-Type to let browser set boundary
    delete headers['Content-Type'];
    delete headers['content-type'];
  } else if (body && typeof body === 'object' && 
             !(typeof FormData !== 'undefined' && body instanceof FormData) &&
             !(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) &&
             !(typeof Blob !== 'undefined' && body instanceof Blob) &&
             !(typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) &&
             !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)) {
    body = JSON.stringify(body, config.jsonReplacer);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
  }

  // 3. Timeout Handling
  const controller = new AbortController();
  
  const onSignalAbort = () => controller.abort();
  if (config.signal) {
    if (config.signal.aborted) {
      controller.abort();
    } else {
      config.signal.addEventListener('abort', onSignalAbort);
    }
  }

  const signal = controller.signal;
  let timeoutId: any;

  if (config.timeout && config.timeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), config.timeout);
  }

  try {
    const startTime = Date.now();
    const response = await fetch(config.url, {
      method: config.method,
      headers,
      body,
      signal,
      cache: config.cache,
      integrity: config.integrity,
      // @ts-ignore
      priority: config.priority,
      keepalive: config.platform?.keepAlive,
      referrer: config.platform?.referrer,
      referrerPolicy: config.platform?.referrerPolicy as ReferrerPolicy,
      credentials: config.withCredentials ? 'include' : 'same-origin',
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Check maxBodyLength (Content-Length)
    const maxBodyLength = config.platform?.maxBodyLength;
    if (maxBodyLength && maxBodyLength > 0) {
      const contentLength = Number(response.headers.get('content-length'));
      if (!isNaN(contentLength) && contentLength > maxBodyLength) {
         throw createError(`Content-Length ${contentLength} exceeds maxBodyLength ${maxBodyLength}`, JadyErrorCodes.ENETWORK, config);
      }
    }

    // 4. Response Processing
    let responseBody: any;
    let rawBody: string | undefined;
    let rawResponse = response;
    
    if (response.status === 204) {
      responseBody = null;
    } else {
    // Handle Download Progress
    if (config.onDownloadProgress && response.body) {
      const total = Number(response.headers.get('content-length')) || undefined;
      let loaded = 0;
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            loaded += value.byteLength;
            config.onDownloadProgress!({ loaded, total });
            controller.enqueue(value);
          }
        }
      });
      
      // Create a new Response with the monitored stream to allow .json(), .text() etc. to work
      rawResponse = new Response(stream, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      });
    }

    const contentType = rawResponse.headers.get('content-type');

    // Handle Text Decoding (responseEncoding)
    const useResponseEncoding = config.responseEncoding && config.responseEncoding.toLowerCase() !== 'utf-8';
    const getText = async () => {
      if (useResponseEncoding) {
        const buffer = await rawResponse.arrayBuffer();
        const decoder = new TextDecoder(config.responseEncoding);
        return decoder.decode(buffer);
      }
      return rawResponse.text();
    };

    // Handle saveRawBody, jsonReviver, or custom encoding
    if ((config.saveRawBody || config.jsonReviver || useResponseEncoding) && config.responseType !== 'stream' && config.responseType !== 'blob' && config.responseType !== 'arraybuffer' && config.responseType !== 'bytes') {
      const text = await getText();
      rawBody = text;

      if (config.responseType === 'json') {
        try {
          responseBody = JSON.parse(text, config.jsonReviver);
        } catch (e) {
          throw createError('JSON Parse Error', JadyErrorCodes.EPARSE, config, undefined, e);
        }
      } else if (config.responseType === 'text') {
        responseBody = text;
      } else {
        // Auto
        if (contentType && (contentType.includes('application/json') || contentType.includes('+json'))) {
          try {
            responseBody = JSON.parse(text, config.jsonReviver);
          } catch (e) {
            throw createError('JSON Parse Error', JadyErrorCodes.EPARSE, config, undefined, e);
          }
        } else {
          responseBody = text;
        }
      }
    } else {
      if (config.responseType === 'stream') {
        responseBody = rawResponse.body;
      } else if (config.responseType === 'json') {
        try {
          // Native .json() doesn't support reviver, so we must use text() if reviver is present (handled in if block above)
          // But if we are here, it means saveRawBody and jsonReviver are falsy.
          responseBody = await rawResponse.json();
        } catch (e) {
          throw createError('JSON Parse Error', JadyErrorCodes.EPARSE, config, undefined, e);
        }
      } else if (config.responseType === 'text') {
        responseBody = await rawResponse.text();
      } else if (config.responseType === 'blob') {
        responseBody = await rawResponse.blob();
      } else if (config.responseType === 'arraybuffer' || config.responseType === 'bytes') {
        responseBody = await rawResponse.arrayBuffer();
      } else {
        // Auto
        if (contentType && (contentType.includes('application/json') || contentType.includes('+json'))) {
          try {
            responseBody = await rawResponse.json();
          } catch (e) {
            throw createError('JSON Parse Error', JadyErrorCodes.EPARSE, config, undefined, e);
          }
        } else if (contentType && (contentType.includes('text/') || contentType.includes('xml'))) {
          responseBody = await rawResponse.text();
        } else {
          responseBody = await rawResponse.arrayBuffer();
        }
      }
    }
    }

    const responseHeaders: Record<string, string | string[]> = {};
    response.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      rawBody,
      config,
      duration,
      totalDuration: duration, // Will be updated by cors.ts
      url: response.url,
      ok: config.validateStatus ? config.validateStatus(response.status) : response.ok,
      attempts: []
    };
  } catch (error: unknown) {
    if (error && (error as any).code) {
      throw error;
    }

    const isAbortError = (error instanceof Error && error.name === 'AbortError') || 
                         (typeof error === 'object' && error !== null && (error as any).name === 'AbortError');
    if (isAbortError) {
      if (config.signal?.aborted) {
        throw createError('Canceled', JadyErrorCodes.ECANCELED, config, undefined, error);
      }
      throw createError('Request timed out', JadyErrorCodes.ETIMEDOUT, config, undefined, error);
    }
    throw createError(error instanceof Error ? error.message : String(error), JadyErrorCodes.ENETWORK, config, undefined, error);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (config.signal) {
      config.signal.removeEventListener('abort', onSignalAbort);
    }
  }
}