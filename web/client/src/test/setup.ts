import '@testing-library/jest-dom/vitest';

// Mock window.matchMedia (required by Ant Design)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock getComputedStyle (required by Ant Design animations)
const origGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = (elt: Element, pseudoElt?: string | null) => {
  const style = origGetComputedStyle(elt, pseudoElt);
  return new Proxy(style, {
    get(target, prop) {
      if (prop === 'animationName') return 'none';
      return Reflect.get(target, prop);
    },
  });
};

// Mock fetch for local health checks.
Object.defineProperty(window, 'fetch', {
  value: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, mode: 'local' }),
  }),
  writable: true,
});
