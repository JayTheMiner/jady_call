// @ts-ignore
import { TextEncoder, TextDecoder } from 'util';

declare var global: any;
declare var jest: any;
declare var require: any;

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock global fetch
global.fetch = jest.fn();

// Fix for "TypeError: 'addEventListener' called on an object that is not a valid instance of EventTarget"
// We use a standalone mock that does NOT extend EventTarget to avoid JSDOM internal slot checks.
class MockAbortSignal {
  aborted = false;
  reason: any = undefined;
  onabort: any = null;
  private _listeners: Array<any> = [];

  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }

  addEventListener(type: string, listener: any) {
    if (type === 'abort') {
      this._listeners.push(listener);
    }
  }

  removeEventListener(type: string, listener: any) {
    if (type === 'abort') {
      this._listeners = this._listeners.filter(l => l !== listener);
    }
  }
}

class MockAbortController {
  signal = new MockAbortSignal();

  abort(reason: any) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason !== undefined ? reason : new Error('Aborted');
    
    const event = { type: 'abort', target: this.signal };
    if (this.signal.onabort) this.signal.onabort(event);
    // @ts-ignore
    this.signal._listeners.forEach(l => typeof l === 'function' ? l(event) : l.handleEvent(event));
  }
}

global.AbortController = MockAbortController as any;
global.AbortSignal = MockAbortSignal as any;

export {};