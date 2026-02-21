import jady, { create } from '../src/index';
import { JadyConfig } from '../src/types';

// Helper to mock fetch response
function mockFetchResponse(body: any, status = 200, headers = {}) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  });
}

describe('jady-js', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    jest.useRealTimers();
  });

  afterEach(() => {

    jest.useRealTimers();
  });

  test('should make a basic GET request', async () => {
    mockFetchResponse({ data: 'success' }, 200, { 'content-type': 'application/json' });

    const response = await jady({ url: 'https://api.example.com/users' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: 'success' });
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/users', expect.objectContaining({
      method: 'GET'
    }));
  });

  test('should make a POST request with JSON body', async () => {
    mockFetchResponse({ created: true }, 201, { 'content-type': 'application/json' });
    const postData = { name: 'jady', version: 1 };

    const response = await jady({
      url: 'https://api.example.com/users',
      method: 'POST',
      data: postData,
    });

    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/users', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify(postData),
    }));
  });

  test('should handle multipart/form-data for file uploads', async () => {
    mockFetchResponse({ uploaded: true });

    // Spy on FormData to check what's being appended
    const appendSpy = jest.spyOn(FormData.prototype, 'append');

    const file = new Blob(['file content'], { type: 'text/plain' });
    const textData = { description: 'A test file' };

    await jady({
      url: 'https://api.example.com/upload',
      method: 'POST',
      data: textData,
      files: {
        theFile: file,
      },
    });

    expect(appendSpy).toHaveBeenCalledWith('description', 'A test file');
    expect(appendSpy).toHaveBeenCalledWith('theFile', expect.objectContaining({
      type: 'text/plain'
    }));

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const fetchOptions = fetchCall[1];
    expect(fetchOptions.body).toBeInstanceOf(FormData);

    appendSpy.mockRestore();
  });

  test('should handle path parameters substitution', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/users/{id}/posts/:postId',
      path: { id: 123, postId: 'abc' }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users/123/posts/abc',
      expect.anything()
    );
  });

  test('should serialize query parameters', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/search',
      params: { q: 'hello world', page: 1, filters: ['a', 'b'] },
      paramsArrayFormat: 'comma'
    });

    // Expected: q=hello+world&page=1&filters=a,b
    // Note: implementation uses encodeURIComponent which encodes space to %20 or + depending on logic.
    // Our utils.ts replaces %20 with +.
    const expectedUrl = 'https://api.example.com/search?q=hello+world&page=1&filters=a,b';
    expect(global.fetch).toHaveBeenCalledWith(expectedUrl, expect.anything());
  });

  test('should retry on 500 error', async () => {
    // First call fails with 500
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Server Error',
        arrayBuffer: async () => new TextEncoder().encode('Server Error').buffer
      })
      // Second call succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true })
      });

    const response = await jady({
      url: 'https://api.example.com/flaky',
      retry: 1,
      retryDelay: 10 // fast retry for test
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('should execute hooks', async () => {
    mockFetchResponse({ ok: true });

    const config: JadyConfig = {
      url: 'https://test.com',
      headers: { 'X-Original': 'true' },
      hooks: {
        beforeRequest: (cfg) => {
          cfg.headers = { ...cfg.headers, 'X-Added': 'hook' };
          return cfg;
        },
        afterResponse: (res) => {
          res.headers['x-response-hook'] = 'processed';
          return res;
        }
      }
    };

    const response = await jady(config);

    // Check Request Hook
    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-original': 'true',
          'X-Added': 'hook'
        })
      })
    );

    // Check Response Hook
    expect(response.headers['x-response-hook']).toBe('processed');
  });

  test('should create instance with defaults', async () => {
    mockFetchResponse({});

    const api = create({
      baseUrl: 'https://api.base.com',
      headers: { 'Authorization': 'Bearer token' }
    });

    await api({ url: '/endpoint' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.base.com/endpoint',
      expect.objectContaining({
        headers: expect.objectContaining({
          'authorization': 'Bearer token'
        })
      })
    );
  });

  test('should handle timeout', async () => {
    // Mock fetch to hang (never resolve) or use fake timers
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        } else {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const requestPromise = jady({
      url: 'https://timeout.com',
      timeout: 1000
    });

    // Fast-forward time
    jest.advanceTimersByTime(1001);

    await expect(requestPromise).rejects.toMatchObject({
      code: 'ETIMEDOUT'
    });

    jest.useRealTimers();
  });

  test('should follow redirects and change method to GET on 301 from POST', async () => {
    const originalUrl = 'https://api.example.com/create';
    const redirectUrl = 'https://api.example.com/new-location';

    // First call: 301 Redirect
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 301,
      statusText: 'Moved Permanently',
      headers: new Headers({ 'Location': redirectUrl }),
      // No body methods needed for redirect response
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    // Second call: 200 OK
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
    });

    const response = await jady({
      url: originalUrl,
      method: 'POST',
      data: { some: 'data' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Check second call (GET to new URL, no body)
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(secondCall[0]).toBe(redirectUrl);
    expect(secondCall[1].method).toBe('GET');
    expect(secondCall[1].body).toBeUndefined();
  });

  test('should handle basic auth', async () => {
    mockFetchResponse({ authenticated: true });

    await jady({
      url: 'https://api.example.com/auth',
      auth: { username: 'user', password: 'password' }
    });

    // "user:password" in base64 is "dXNlcjpwYXNzd29yZA=="
    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'authorization': 'Basic dXNlcjpwYXNzd29yZA=='
        })
      })
    );
  });

  test('should handle bearer auth', async () => {
    mockFetchResponse({ authenticated: true });

    await jady({
      url: 'https://api.example.com/auth',
      auth: { bearer: 'my-token' }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'authorization': 'Bearer my-token'
        })
      })
    );
  });

  test('should cancel request via signal', async () => {
    const controller = new AbortController();
    
    // Mock fetch to wait
    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        } else {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const promise = jady({
      url: 'https://api.example.com/cancel',
      signal: controller.signal
    });

    // Abort immediately
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'ECANCELED'
    });
  });

  test('should save raw body when requested', async () => {
    const body = { data: 'raw' };
    mockFetchResponse(body, 200, { 'content-type': 'application/json' });

    const response = await jady({
      url: 'https://api.example.com/raw',
      saveRawBody: true,
      responseType: 'json'
    });

    expect(response.body).toEqual(body);
    expect(response.rawBody).toBe(JSON.stringify(body));
  });

  test('should handle JSON parse error (EPARSE)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => 'invalid json',
      json: async () => { throw new Error('Unexpected token'); }
    });

    await expect(jady({
      url: 'https://api.example.com/bad-json',
      responseType: 'json'
    })).rejects.toMatchObject({
      code: 'EPARSE'
    });
  });

  test('should throw EMAXREDIRECTS when redirect limit exceeded', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ 'Location': '/loop' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(jady({
      url: 'https://api.example.com/loop',
      maxRedirects: 2
    })).rejects.toMatchObject({
      code: 'EMAXREDIRECTS'
    });
    
    // Initial + 2 redirects = 3 calls
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('should retry on 429 Too Many Requests', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => 'Too Many Requests',
        arrayBuffer: async () => new TextEncoder().encode('Too Many Requests').buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true })
      });

    const response = await jady({
      url: 'https://api.example.com/rate-limit',
      retry: 1
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('should normalize headers to lowercase', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/headers',
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'Value'
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-custom-header': 'Value'
        })
      })
    );
  });

  test('should handle custom validateStatus', async () => {
    mockFetchResponse({ error: 'not found' }, 404);

    const response = await jady({
      url: 'https://api.example.com/404',
      validateStatus: (status) => status === 404
    });

    expect(response.status).toBe(404);
    expect(response.ok).toBe(true);
  });

  test('should handle different paramsArrayFormat options', async () => {
    mockFetchResponse({});

    // Brackets
    await jady({
      url: 'https://api.example.com/search',
      params: { ids: [1, 2] },
      paramsArrayFormat: 'brackets'
    });
    
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://api.example.com/search?ids[]=1&ids[]=2',
      expect.anything()
    );

    // Index
    await jady({
      url: 'https://api.example.com/search',
      params: { ids: [1, 2] },
      paramsArrayFormat: 'index'
    });
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://api.example.com/search?ids[0]=1&ids[1]=2',
      expect.anything()
    );
  });

  test('should stop retry if beforeRetry hook returns false', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => 'Error',
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    const beforeRetry = jest.fn().mockReturnValue(false);

    await expect(jady({
      url: 'https://api.example.com/retry-hook',
      retry: 3,
      hooks: { beforeRetry }
    })).rejects.toMatchObject({
      code: 'ENETWORK'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(beforeRetry).toHaveBeenCalled();
  });

  test('should handle network error (ENETWORK)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network Failure'));

    await expect(jady({
      url: 'https://api.example.com/network-error'
    })).rejects.toMatchObject({
      code: 'ENETWORK',
      message: 'Network Failure'
    });
  });

  test('should use custom paramsSerializer', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/custom-params',
      params: { a: 1, b: 2 },
      paramsSerializer: (params) => {
        return Object.keys(params).map(key => `${key}-${params[key]}`).join(';');
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/custom-params?a-1;b-2',
      expect.anything()
    );
  });

  test('should add XSRF header from cookie in browser environment', async () => {
    // Mock document.cookie for JSDOM
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'XSRF-TOKEN=abc-123',
    });

    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/xsrf',
      method: 'POST',
      xsrfCookieName: 'XSRF-TOKEN',
      xsrfHeaderName: 'X-XSRF-TOKEN'
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-xsrf-token': 'abc-123'
        })
      })
    );
  });

  test('should respect Retry-After header', async () => {
    jest.useFakeTimers();
    
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'Retry-After': '1' }), // 1 second
        text: async () => 'Service Unavailable',
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ success: true })).buffer
      });

    const requestPromise = jady({
      url: 'https://api.example.com/retry-after',
      retry: 1
    });

    // Wait for the retry logic to process the first response and schedule the timeout
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Advance time to trigger retry (1000ms)
    jest.advanceTimersByTime(1000);

    const response = await requestPromise;
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    jest.useRealTimers();
  });

  test('should combine baseUrl and url correctly', async () => {
    mockFetchResponse({});

    await jady({
      baseUrl: 'https://api.example.com/v1/',
      url: '/users'
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://api.example.com/v1/users',
      expect.anything()
    );

    await jady({
      baseUrl: 'https://api.example.com/v1',
      url: 'users'
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://api.example.com/v1/users',
      expect.anything()
    );
  });

  test('should filter null and undefined params', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/search',
      params: {
        valid: 'value',
        empty: null,
        missing: undefined,
        list: ['a', null, 'b']
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/search?valid=value&list=a&list=b',
      expect.anything()
    );
  });

  test('should respect totalTimeout across retries', async () => {
    jest.useFakeTimers();
    
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const requestPromise = jady({
      url: 'https://api.example.com/total-timeout',
      retry: 3,
      retryDelay: 1000,
      totalTimeout: 1500
    });

    // Initial request fails. Retry 1 scheduled (delay 1000ms).
    // Current elapsed: 0. Next elapsed: 1000. 1000 < 1500. OK.
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    
    // Retry 1 fails. Retry 2 scheduled (delay 1000ms).
    // Current elapsed: 1000. Next elapsed: 2000. 2000 > 1500. Fail.
    await expect(requestPromise).rejects.toMatchObject({
      code: 'ETIMEDOUT'
    });

    jest.useRealTimers();
  });

  test('should use custom retryCondition', async () => {
    let calls = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('Network Error');
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ success: true })).buffer
      };
    });
    // Retry only if error message contains "Network"
    const retryCondition = jest.fn((error) => error.message.includes('Network'));

    await jady({
      url: 'https://api.example.com/retry-condition',
      retry: 1,
      retryCondition,
      retryDelay: 1
    });

    expect(retryCondition).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('should handle arraybuffer response', async () => {
    const buffer = new TextEncoder().encode('binary data').buffer;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => buffer
    });

    const response = await jady({
      url: 'https://api.example.com/binary',
      responseType: 'arraybuffer'
    });

    expect(response.body).toEqual(buffer);
  });

  test('should serialize Date params to ISO string', async () => {
    mockFetchResponse({});
    const date = new Date('2023-01-01T00:00:00.000Z');

    await jady({
      url: 'https://api.example.com/date',
      params: { date }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      // jady decodes %3A back to : for readability, so we expect unencoded colons
      'https://api.example.com/date?date=' + date.toISOString(),
      expect.anything()
    );
  });

  test('should handle headers processing (array join, null removal)', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/headers-proc',
      headers: {
        'X-List': ['a', 'b'],
        'X-Null': null,
        'X-Undefined': undefined,
        'X-Keep': 'value'
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-list': 'a,b',
          'x-keep': 'value'
        })
      })
    );
    
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers).not.toHaveProperty('x-null');
    expect(headers).not.toHaveProperty('x-undefined');
  });

  test('should prioritize manual Authorization header over auth config', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/auth-priority',
      auth: { username: 'user', password: 'pw' },
      headers: {
        'Authorization': 'Bearer manual-token'
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'authorization': 'Bearer manual-token'
        })
      })
    );
  });

  test('should force text response with responseType: text', async () => {
    const data = { key: 'value' };
    mockFetchResponse(data, 200, { 'content-type': 'application/json' });

    const response = await jady({
      url: 'https://api.example.com/text-response',
      responseType: 'text'
    });

    expect(typeof response.body).toBe('string');
    expect(response.body).toBe(JSON.stringify(data));
  });

  test('should serialize boolean and number params', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/types',
      params: {
        flag: true,
        num: 123,
        zero: 0,
        falseFlag: false
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/types?flag=true&num=123&zero=0&falseFlag=false',
      expect.anything()
    );
  });

  test('should handle params edge cases (empty array, empty string)', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/params-edge',
      params: {
        emptyArr: [],
        emptyStr: '',
        nullVal: null,
        undefinedVal: undefined
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/params-edge?emptyStr=',
      expect.anything()
    );
  });

  test('should handle JSON data serialization rules', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/json-rules',
      method: 'POST',
      data: {
        val: null,
        ignored: undefined,
        nan: NaN,
        inf: Infinity
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: JSON.stringify({
          val: null,
          nan: null,
          inf: null
        })
      })
    );
  });

  test('should format header values correctly', async () => {
    mockFetchResponse({});
    const date = new Date('2023-01-01T00:00:00.000Z');

    await jady({
      url: 'https://api.example.com/header-format',
      headers: {
        'X-Date': date,
        'X-Bool-True': true,
        'X-Bool-False': false
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-date': date.toUTCString(),
          'x-bool-true': 'true',
          'x-bool-false': 'false'
        })
      })
    );
  });

  test('should handle redirect modes', async () => {
    // Manual
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ 'Location': '/new' }),
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    const response = await jady({
      url: 'https://api.example.com/manual',
      redirect: 'manual',
      validateStatus: (status) => status >= 200 && status < 400
    });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/new');

    // Error (Default validateStatus fails on 302)
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ 'Location': '/new' }),
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    await expect(jady({
      url: 'https://api.example.com/error',
      redirect: 'error'
    })).rejects.toMatchObject({
      code: 'ENETWORK'
    });
  });

  test('should support URLSearchParams in params', async () => {
    mockFetchResponse({});
    const params = new URLSearchParams();
    params.append('key', 'value');
    params.append('arr', '1');
    params.append('arr', '2');

    await jady({
      url: 'https://api.example.com/search',
      params
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/https:\/\/api\.example\.com\/search\?key=value&arr=1&arr=2/),
      expect.anything()
    );
  });

  test('should support URLSearchParams in data (post)', async () => {
    mockFetchResponse({});
    const params = new URLSearchParams({ key: 'value' });

    await jady({
      url: 'https://api.example.com/post',
      method: 'POST',
      data: params
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: params
      })
    );
    
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const headers = callArgs[1].headers;
    // fetchAdapter adds application/json if body is object and NOT URLSearchParams etc.
    // So here it should NOT be added (browser/fetch adds it automatically).
    expect(headers).not.toHaveProperty('content-type');
    expect(headers).not.toHaveProperty('Content-Type');
  });

  test('should handle hash in URL correctly with params', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/page#section',
      params: { page: 1 }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/page?page=1#section',
      expect.anything()
    );
  });

  test('should fail on 304 with default validateStatus', async () => {
    mockFetchResponse({}, 304);

    await expect(jady({
      url: 'https://api.example.com/cache'
    })).rejects.toMatchObject({
      code: 'ENETWORK'
    });
  });

  test('should pass fetch specific options', async () => {
    mockFetchResponse({});
    
    await jady({
      url: 'https://api.example.com/options',
      cache: 'no-cache',
      integrity: 'sha256-abc',
      priority: 'high',
      withCredentials: true,
      platform: {
        keepAlive: true,
        referrer: 'https://google.com',
        referrerPolicy: 'no-referrer'
      }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cache: 'no-cache',
        integrity: 'sha256-abc',
        priority: 'high',
        credentials: 'include',
        keepalive: true,
        referrer: 'https://google.com',
        referrerPolicy: 'no-referrer'
      })
    );
  });

  test('should use jsonReplacer and jsonReviver', async () => {
    // Replacer
    mockFetchResponse({ raw: 'value' });
    
    const replacer = (key: string, value: any) => {
      if (key === 'secret') return undefined;
      return value;
    };

    await jady({
      url: 'https://api.example.com/replacer',
      method: 'POST',
      data: { public: 'visible', secret: 'hidden' },
      jsonReplacer: replacer
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: JSON.stringify({ public: 'visible' })
      })
    );

    // Reviver
    const reviver = (key: string, value: any) => {
      if (key === 'date') return new Date(value);
      return value;
    };
    
    const dateStr = '2023-01-01T00:00:00.000Z';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ date: dateStr })
    });

    const response = await jady({
      url: 'https://api.example.com/reviver',
      responseType: 'json',
      jsonReviver: reviver
    });

    expect(response.body.date).toBeInstanceOf(Date);
    expect(response.body.date.toISOString()).toBe(dateStr);
  });

  test('should report download progress', async () => {
    if (typeof ReadableStream === 'undefined' || typeof Response === 'undefined') return;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      }
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '5' }),
      body: stream
    });

    const onDownloadProgress = jest.fn();

    await jady({
      url: 'https://api.example.com/download',
      onDownloadProgress,
      responseType: 'arraybuffer'
    });

    expect(onDownloadProgress).toHaveBeenCalledTimes(2);
    expect(onDownloadProgress).toHaveBeenNthCalledWith(1, { loaded: 3, total: 5 });
    expect(onDownloadProgress).toHaveBeenNthCalledWith(2, { loaded: 5, total: 5 });
  });

  test('should return stream when responseType is stream', async () => {
    if (typeof ReadableStream === 'undefined') return;
    
    const stream = new ReadableStream({ start(c) { c.close(); } });
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: stream
    });

    const response = await jady({
      url: 'https://api.example.com/stream',
      responseType: 'stream'
    });

    expect(response.body).toBe(stream);
  });

  test('should pass meta data to response', async () => {
    mockFetchResponse({});
    const meta = { id: 'test-req' };

    const response = await jady({
      url: 'https://api.example.com/meta',
      meta
    });

    expect(response.config.meta).toEqual(meta);
  });

  test('should allow 304 with custom validateStatus', async () => {
    mockFetchResponse({}, 304);

    const response = await jady({
      url: 'https://api.example.com/304',
      validateStatus: (status) => status === 304
    });

    expect(response.status).toBe(304);
    expect(response.ok).toBe(true);
  });

  test('should execute beforeError hook', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const beforeError = jest.fn(async (err) => {
      err.message = 'Modified Error';
      return err;
    });

    await expect(jady({
      url: 'https://api.example.com/error',
      hooks: { beforeError }
    })).rejects.toMatchObject({
      message: 'Modified Error'
    });

    expect(beforeError).toHaveBeenCalled();
  });

  test('should execute beforeRedirect hook', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ 'Location': '/new' }),
      arrayBuffer: async () => new ArrayBuffer(0)
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'ok',
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    const beforeRedirect = jest.fn();

    await jady({
      url: 'https://api.example.com/redirect',
      hooks: { beforeRedirect }
    });

    expect(beforeRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/new') }),
      expect.objectContaining({ status: 302 })
    );
  });

  test('should handle ReadableStream as request body', async () => {
    if (typeof ReadableStream === 'undefined') return;
    
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream data'));
        controller.close();
      }
    });

    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/upload-stream',
      method: 'POST',
      data: stream
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: stream
      })
    );
    
    // Should NOT have application/json content-type
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers).not.toHaveProperty('content-type');
  });

  test('should enforce maxBodyLength', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '1024' }),
      text: async () => 'large body'
    });

    await expect(jady({
      url: 'https://api.example.com/large',
      platform: {
        maxBodyLength: 100
      }
    })).rejects.toMatchObject({
      code: 'ENETWORK',
      message: expect.stringContaining('exceeds maxBodyLength')
    });
  });

  test('should support responseEncoding', async () => {
    // Use iso-8859-1 which is widely supported in Node.js environments without full-icu
    // 0xFF in iso-8859-1 is 'ÿ'
    const buffer = new Uint8Array([0xFF]).buffer;
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => buffer
    });

    const response = await jady({
      url: 'https://api.example.com/encoding',
      responseEncoding: 'iso-8859-1'
    });

    expect(response.body).toBe('ÿ');
  });

  test('should throw error if url is missing', async () => {
    // @ts-ignore
    await expect(jady({})).rejects.toThrow('url is required');
  });

  test('should not mutate the original config object', async () => {
    mockFetchResponse({});
    const originalConfig = {
      url: 'https://api.example.com/mutate',
      headers: { 'X-Test': 'original' }
    };
    // Deep copy to compare later
    const configCopy = JSON.parse(JSON.stringify(originalConfig));

    await jady(originalConfig);

    expect(originalConfig).toEqual(configCopy);
  });

  test('should throw error if both basic and bearer auth are provided', async () => {
    await expect(jady({
      url: 'https://api.example.com/auth-error',
      auth: { username: 'user', bearer: 'token' } as any
    })).rejects.toThrow('Cannot use both Basic and Bearer authentication');
  });

  test('should handle slash normalization in baseUrl', async () => {
    mockFetchResponse({});

    // Case 1: No slash
    await jady({ baseUrl: 'https://api.example.com/v1', url: 'users' });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/v1/users', expect.anything());

    // Case 2: Both have slash
    await jady({ baseUrl: 'https://api.example.com/v1/', url: '/users' });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/v1/users', expect.anything());

    // Case 3: Base has slash
    await jady({ baseUrl: 'https://api.example.com/v1/', url: 'users' });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/v1/users', expect.anything());

    // Case 4: Url has slash
    await jady({ baseUrl: 'https://api.example.com/v1', url: '/users' });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/v1/users', expect.anything());
  });

  test('should encode special characters in path parameters', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/files/{path}/info',
      path: { path: 'folder/file.txt' }
    });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/files/folder%2Ffile.txt/info', expect.anything());

    await jady({
      url: 'https://api.example.com/search/:query',
      path: { query: 'hello world?' }
    });
    expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.com/search/hello%20world%3F', expect.anything());
  });

  test('should ignore request body for GET and HEAD methods', async () => {
    mockFetchResponse({});

    await jady({
      url: 'https://api.example.com/get',
      method: 'GET',
      data: { some: 'data' }
    });
    expect(global.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      method: 'GET',
      body: undefined
    }));

    await jady({
      url: 'https://api.example.com/head',
      method: 'HEAD',
      data: { some: 'data' }
    });
    expect(global.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      method: 'HEAD',
      body: undefined
    }));
  });

  test('should throw error for circular references in JSON data', async () => {
    const circular: any = { a: 1 };
    circular.self = circular;

    await expect(jady({
      url: 'https://api.example.com/circular',
      method: 'POST',
      data: circular
    })).rejects.toThrow(); // JSON.stringify throws TypeError
  });

  test('should convert boolean and date fields in multipart/form-data', async () => {
    mockFetchResponse({});
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    const date = new Date('2023-01-01T00:00:00.000Z');

    await jady({
      url: 'https://api.example.com/upload',
      method: 'POST',
      data: { isTrue: true, isFalse: false, date },
      files: { file: new Blob([]) }
    });

    expect(appendSpy).toHaveBeenCalledWith('isTrue', 'true');
    expect(appendSpy).toHaveBeenCalledWith('isFalse', 'false');
    expect(appendSpy).toHaveBeenCalledWith('date', date.toISOString());
    appendSpy.mockRestore();
  });

  test('should throw error if data is not a plain object when using files', async () => {
    await expect(jady({
      url: 'https://api.example.com/error',
      method: 'POST',
      data: 'string data', // Not a plain object
      files: { file: new Blob([]) }
    })).rejects.toThrow('data must be a plain object when using files');
  });

  test('should throw error for invalid header names or values', async () => {
    await expect(jady({
      url: 'https://api.example.com',
      headers: { 'Invalid Name': 'value' }
    })).rejects.toThrow('Invalid header name');

    await expect(jady({
      url: 'https://api.example.com',
      headers: { 'Valid-Name': 'Invalid\nValue' }
    })).rejects.toThrow('Invalid header value');
  });

  test('should preserve method and body on 307/308 redirects', async () => {
    const originalUrl = 'https://api.example.com/post';
    const redirectUrl = 'https://api.example.com/temp-post';
    const postData = { key: 'value' };

    // 307 Temporary Redirect
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 307,
        headers: new Headers({ 'Location': redirectUrl }),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        arrayBuffer: async () => new ArrayBuffer(0)
      });

    await jady({
      url: originalUrl,
      method: 'POST',
      data: postData
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(secondCall[0]).toBe(redirectUrl);
    expect(secondCall[1].method).toBe('POST');
    expect(secondCall[1].body).toBe(JSON.stringify(postData));
  });

  test('should strip sensitive headers on cross-domain redirects', async () => {
    const originalUrl = 'https://api.example.com/auth';
    const crossDomainUrl = 'https://other.example.com/login';

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ 'Location': crossDomainUrl }),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        arrayBuffer: async () => new ArrayBuffer(0)
      });

    await jady({
      url: originalUrl,
      headers: {
        'Authorization': 'Bearer secret',
        'Cookie': 'session=123',
        'X-Public': 'public'
      }
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    const headers = secondCall[1].headers;
    
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('cookie');
    expect(headers).toHaveProperty('x-public', 'public');
  });

  test('should support dynamic retryDelay function', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
        arrayBuffer: async () => new ArrayBuffer(0)
      });

    const retryDelay = jest.fn((retryCount) => retryCount * 1000);

    const promise = jady({
      url: 'https://api.example.com/dynamic-retry',
      retry: 1,
      retryDelay
    });

    // Allow microtasks to process
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(retryDelay).toHaveBeenCalledWith(1, expect.anything());

    // Advance time to trigger the retry
    jest.advanceTimersByTime(1000);

    await promise;
    expect(global.fetch).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('should stop retrying if totalTimeout is exceeded during delay', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    const promise = jady({
      url: 'https://api.example.com/timeout-retry',
      retry: 3,
      retryDelay: 2000, // 2s delay
      totalTimeout: 1000 // 1s total timeout
    });

    // Should fail immediately because 2000 > 1000
    await expect(promise).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      message: expect.stringContaining('Total timeout exceeded during retry delay')
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    
    jest.useRealTimers();
  });

  test('should populate attempts array in response', async () => {
    // First: 500 Error
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      // Second: 200 OK
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => '{}',
        arrayBuffer: async () => new ArrayBuffer(0)
      });

    const response = await jady({
      url: 'https://api.example.com/attempts',
      retry: 1,
      retryDelay: 1
    });

    expect(response.attempts).toHaveLength(2);
    expect(response.attempts[0].error).toBeDefined(); // First attempt failed
    expect(response.attempts[1].status).toBe(200);    // Second attempt succeeded
  });

  test('should return null body for 204 No Content', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0)
    });

    const response = await jady({
      url: 'https://api.example.com/204'
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});