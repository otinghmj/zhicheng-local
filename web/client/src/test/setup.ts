import '@testing-library/jest-dom/vitest';

// Mock File System Access API
const mockHandle: Partial<FileSystemDirectoryHandle> = {
  kind: 'directory',
  name: 'test-dir',
  getDirectoryHandle: vi.fn(),
  getFileHandle: vi.fn(),
  values: vi.fn(),
  queryPermission: vi.fn().mockResolvedValue('granted'),
  requestPermission: vi.fn().mockResolvedValue('granted'),
};

Object.defineProperty(window, 'showDirectoryPicker', {
  value: vi.fn().mockResolvedValue(mockHandle),
  writable: true,
});

// Mock IndexedDB
const mockStore: Record<string, unknown> = {};
const mockObjectStore = {
  put: vi.fn((value: unknown, key: string) => {
    mockStore[key] = value;
    return { oncomplete: null, onerror: null };
  }),
  get: vi.fn((key: string) => {
    const req = { result: mockStore[key] ?? null, onsuccess: null as (() => void) | null, onerror: null };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  delete: vi.fn((key: string) => {
    delete mockStore[key];
    return { oncomplete: null, onerror: null };
  }),
};

const mockTransaction = {
  objectStore: vi.fn().mockReturnValue(mockObjectStore),
  oncomplete: null as (() => void) | null,
  onerror: null,
};

// Auto-resolve transaction oncomplete
const origPut = mockObjectStore.put;
mockObjectStore.put = vi.fn((...args: [unknown, string]) => {
  const result = origPut(...args);
  setTimeout(() => mockTransaction.oncomplete?.(), 0);
  return result;
});
const origDelete = mockObjectStore.delete;
mockObjectStore.delete = vi.fn((...args: [string]) => {
  const result = origDelete(...args);
  setTimeout(() => mockTransaction.oncomplete?.(), 0);
  return result;
});

const mockDb = {
  transaction: vi.fn().mockReturnValue(mockTransaction),
  createObjectStore: vi.fn(),
};

const mockOpenRequest = {
  result: mockDb,
  onupgradeneeded: null as (() => void) | null,
  onsuccess: null as (() => void) | null,
  onerror: null,
};

Object.defineProperty(window, 'indexedDB', {
  value: {
    open: vi.fn().mockImplementation(() => {
      setTimeout(() => mockOpenRequest.onsuccess?.(), 0);
      return mockOpenRequest;
    }),
  },
  writable: true,
});

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
