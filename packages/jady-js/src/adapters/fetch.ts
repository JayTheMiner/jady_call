import { JadyConfig, JadyResponse, JadyErrorCodes } from '../types';
import { createError, buildURL } from '../utils';

export default async function fetchAdapter(config: JadyConfig): Promise<JadyResponse> {
  const headers = { ...(config.headers || {}) } as Record<string, string>;

  // 1. Auth Handling
  if (config.auth) {
    const { username, password, bearer } = config.auth as any;
    // Headers are already normalized to lowercase by processHeaders
    if (!headers['authorization']) {
      if (username !== undefined) {
        const encoded = typeof btoa !== 'undefined' 
          ? btoa(unescape(encodeURIComponent(`${username}:${password || ''}`)))
          : Buffer.from(`${username}:${password || ''}`).toString('base64');
        headers['authorization'] = `Basic ${encoded}`;
      } else if (bearer) {
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
    delete headers['Content-Type'];
    delete headers['content-type'];
  } else if (body && typeof body === 'object' && 
             !(typeof FormData !== 'undefined' && body instanceof FormData) &&
             !(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) &&
             !(typeof Blob !== 'undefined' && body instanceof Blob) &&
             !(typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) &&
             !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)) {
             
    // application/x-www-form-urlencoded 확인 후 직렬화
    const contentTypeKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    const contentType = contentTypeKey ? headers[contentTypeKey] : undefined;

    if (contentType && contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
      // 객체를 쿼리 스트링(a=1&b=2)으로 변환
      body = buildURL('', body, config.paramsSerializer, config.paramsArrayFormat).replace(/^\?/, '');
    } else {
      body = JSON.stringify(body, config.jsonReplacer);
      if (!contentTypeKey) {
        headers['content-type'] = 'application/json';
      }
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
      method: (config.method || 'GET').toUpperCase(),
      headers,
      body,
      signal,
      cache: config.cache,
      integrity: config.integrity,
      priority: config.priority as any,
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
      const contentLengthHeader = typeof response.headers.get === 'function' ? response.headers.get('content-length') : undefined;
      const contentLength = Number(contentLengthHeader);
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
      if (config.onDownloadProgress && response.body) {
        const totalStr = typeof response.headers.get === 'function' ? response.headers.get('content-length') : undefined;
        const total = Number(totalStr) || undefined;
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
        
        rawResponse = new Response(stream, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText
        });
      }

      // 테스트 환경 모킹 객체에 `.get()` 메서드가 없는 경우를 위한 방어 코드 추가
      const contentType = typeof rawResponse.headers.get === 'function' 
        ? rawResponse.headers.get('content-type') 
        : (rawResponse.headers as any)['content-type'] || null;

      const useResponseEncoding = config.responseEncoding && config.responseEncoding.toLowerCase() !== 'utf-8';
      const getText = async () => {
        if (useResponseEncoding) {
          const buffer = await rawResponse.arrayBuffer();
          const decoder = new TextDecoder(config.responseEncoding);
          return decoder.decode(buffer);
        }
        return rawResponse.text();
      };

      if ((config.saveRawBody || config.jsonReviver || useResponseEncoding) && config.responseType !== 'stream' && config.responseType !== 'blob' && config.responseType !== 'arraybuffer' && config.responseType !== 'bytes') {
        const text = await getText();
        rawBody = text;

        // Helper function to parse JSON with BOM removal
        const parseJSON = (jsonText: string) => {
          // Remove UTF-8 BOM if present
          const cleanText = jsonText.replace(/^\uFEFF/, '').trim();
          // Return null for empty response (spec compliance)
          if (cleanText.length === 0) {
            return null;
          }
          return JSON.parse(cleanText, config.jsonReviver);
        };

        if (config.responseType === 'json') {
          try {
            responseBody = parseJSON(text);
          } catch (e) {
            throw createError('JSON Parse Error', JadyErrorCodes.EPARSE, config, undefined, e);
          }
        } else if (config.responseType === 'text') {
          responseBody = text;
        } else {
          if (contentType && (contentType.includes('application/json') || contentType.includes('+json'))) {
            try {
              responseBody = parseJSON(text);
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
            const jsonText = await rawResponse.text();
            const cleanText = jsonText.replace(/^\uFEFF/, '').trim();
            responseBody = cleanText.length === 0 ? null : JSON.parse(cleanText, config.jsonReviver);
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
          if (contentType && (contentType.includes('application/json') || contentType.includes('+json'))) {
            try {
              const jsonText = await rawResponse.text();
              const cleanText = jsonText.replace(/^\uFEFF/, '').trim();
              responseBody = cleanText.length === 0 ? null : JSON.parse(cleanText, config.jsonReviver);
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
    if (typeof response.headers.forEach === 'function') {
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });
    }

    //Set-Cookie 헤더를 배열(String[])로 반환 처리 (환경 호환성 확보)
    if (typeof response.headers.getSetCookie === 'function') {
      const setCookies = response.headers.getSetCookie();
      if (setCookies && setCookies.length > 0) {
        responseHeaders['set-cookie'] = setCookies;
      }
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      rawBody,
      config,
      duration,
      totalDuration: duration,
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