/**
 * jady.call Standard Interface Definitions
 */

export type Method =
  | 'get' | 'GET'
  | 'delete' | 'DELETE'
  | 'head' | 'HEAD'
  | 'options' | 'OPTIONS'
  | 'post' | 'POST'
  | 'put' | 'PUT'
  | 'patch' | 'PATCH'
  | 'purge' | 'PURGE'
  | 'link' | 'LINK'
  | 'unlink' | 'UNLINK';

export type ResponseType =
  | 'auto'
  | 'json'
  | 'text'
  | 'bytes'
  | 'arraybuffer'
  | 'stream'
  | 'blob'
  | 'document';

export type ParamsArrayFormat = 'repeat' | 'brackets' | 'comma' | 'index';

export type CookieMode = 'none' | 'browser' | 'manual';

export interface BasicAuth {
  username: string;
  password?: string;
}

export interface BearerAuth {
  bearer: string;
}

export interface JadyProgressEvent {
  loaded: number;
  total?: number;
}

export interface JadyPlatformOptions {
  cookies?: Record<string, string>;
  timeout?: {
    connect?: number;
    write?: number;
  };
  proxy?: string | {
    host: string;
    port: number;
    protocol?: string;
    auth?: BasicAuth;
    headers?: Record<string, string>;
  } | false;
  ssl?: {
    ca?: any;
    cert?: any;
    key?: any;
    [key: string]: any;
  };
  agent?: any;
  http2?: boolean;
  keepAlive?: boolean;
  maxHeaderSize?: number;
  maxContentLength?: number;
  maxBodyLength?: number;
  blockPrivateIP?: boolean;
  socketPath?: string;
  localAddress?: string;
  noProxy?: string[];
  family?: 4 | 6 | 0;
  lookup?: Function;
  preserveHeaderCase?: boolean;
  referrer?: string;
  referrerPolicy?: string;
  trace?: (event: string, ...args: any[]) => void;
  native?: Record<string, any>;
}

export interface JadyHooks {
  beforeRequest?: (config: JadyConfig) => JadyConfig | Promise<JadyConfig>;
  afterResponse?: (response: JadyResponse) => JadyResponse | Promise<JadyResponse>;
  beforeError?: (error: any) => any | Promise<any>;
  beforeRetry?: (error: any, retryCount: number) => void | boolean | JadyConfig | Promise<void | boolean | JadyConfig>;
  beforeRedirect?: (nextConfig: JadyConfig, response: JadyResponse) => void | Promise<void>;
}

export interface JadyConfig {
  // --- Basic ---
  baseUrl?: string;
  url: string;
  path?: Record<string, string | number>;
  method?: Method;
  
  // --- Data & Params ---
  params?: Record<string, any>;
  paramsArrayFormat?: ParamsArrayFormat;
  paramsSerializer?: (params: Record<string, any>) => string;
  
  data?: any;
  files?: Record<string, any | any[]>; // File, Blob, Stream, Path, or { file, filename, contentType }
  
  // --- Headers & Cookies ---
  headers?: Record<string, string | string[] | number | boolean | null | undefined>;
  cookieMode?: CookieMode;
  
  // --- Timeout ---
  timeout?: number;
  totalTimeout?: number;
  
  // --- Auth ---
  auth?: BasicAuth | BearerAuth;
  withCredentials?: boolean;
  
  // --- Flow Control ---
  redirect?: 'follow' | 'error' | 'manual';
  maxRedirects?: number;
  retry?: number;
  retryCondition?: (error: any, retryCount: number) => boolean | Promise<boolean>;
  retryDelay?: number | ((retryCount: number, error: any) => number);
  
  // --- Response Handling ---
  responseType?: ResponseType;
  responseEncoding?: string;
  saveRawBody?: boolean;
  decompress?: boolean;
  jsonReplacer?: any;
  jsonReviver?: any;
  validateStatus?: (status: number) => boolean;
  
  // --- Advanced ---
  adapter?: (config: JadyConfig) => Promise<JadyResponse>;
  requestId?: string;
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  
  // --- Fetch API Standard ---
  cache?: RequestCache; // 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached'
  priority?: 'high' | 'low' | 'auto';
  integrity?: string;
  signal?: AbortSignal;
  
  // --- Progress ---
  onUploadProgress?: (progressEvent: JadyProgressEvent) => void;
  onDownloadProgress?: (progressEvent: JadyProgressEvent) => void;
  
  // --- Meta & Hooks ---
  meta?: Record<string, any>;
  hooks?: JadyHooks;
  
  // --- Platform Specific ---
  platform?: JadyPlatformOptions;
}

export interface JadyTimings {
  dns?: number;
  connect?: number;
  send?: number;
  wait?: number;
  receive?: number;
  [key: string]: number | undefined;
}

export interface JadyAttempt {
  url: string;
  duration: number;
  status?: number;
  statusText?: string;
  headers?: Record<string, string | string[]>;
  error?: {
    code: string;
    message: string;
  };
}

export interface JadyResponse<T = any> {
  status: number;
  statusText: string;
  
  duration: number;
  totalDuration: number;
  timings?: JadyTimings;
  
  url: string;
  attempts: JadyAttempt[];
  
  request?: any; // Native Request Object
  config: JadyConfig;
  
  body: T;
  /**
   * Raw body data (string or buffer).
   * Only available if `saveRawBody: true` in config.
   */
  rawBody?: string | any; 
  
  headers: Record<string, string | string[]>;
  ok: boolean;
}

export interface JadyError extends Error {
  code: string;
  config: JadyConfig;
  response?: JadyResponse;
  timings?: JadyTimings;
  cause?: any;
}

/**
 * Standard Error Codes
 */
export const JadyErrorCodes = {
  ETIMEDOUT: 'ETIMEDOUT',
  ECANCELED: 'ECANCELED',
  ENETWORK: 'ENETWORK',
  EPARSE: 'EPARSE',
  EMAXREDIRECTS: 'EMAXREDIRECTS',
  EUNKNOWN: 'EUNKNOWN',
} as const;

export type JadyErrorCode = typeof JadyErrorCodes[keyof typeof JadyErrorCodes];
