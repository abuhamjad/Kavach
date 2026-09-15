import '@testing-library/jest-dom';

// jsdom implements none of these, and the console touches all of them on mount
// (ParticleField, Reveal/AnimatedStat, the reduced-motion hook, the socket, and
// App's scroll reset). Stubbing them here keeps every suite quiet by default.

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

global.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
};

global.WebSocket = class {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
  }
  send() {}
  close() {}
};

window.matchMedia = window.matchMedia || function matchMedia(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  };
};

window.scrollTo = () => {};

// canvas is unimplemented in jsdom; returning null is the contract our canvas
// callers already guard for.
HTMLCanvasElement.prototype.getContext = () => null;
