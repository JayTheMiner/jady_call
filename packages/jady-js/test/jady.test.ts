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
    (global.fetch as jest.Mock).mockClear();
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
          reject({ name: 'AbortError' });
        } else {
          options.signal?.addEventListener('abort', () => reject({ name: 'AbortError' }));
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
});