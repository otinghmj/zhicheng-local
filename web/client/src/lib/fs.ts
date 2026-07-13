const DB_NAME = 'zhicheng-fs';
const STORE_NAME = 'handles';

function handleKey(userId?: number | string): string {
  return userId ? `root-dir-${userId}` : 'root-dir';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle: FileSystemDirectoryHandle, userId?: number | string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, handleKey(userId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle(userId?: number | string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(handleKey(userId));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearHandle(userId?: number | string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(handleKey(userId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 是否支持 File System Access API（window.showDirectoryPicker）。
 * 只有 Chrome/Edge 等 Chromium 浏览器的独立窗口、安全上下文（localhost/https）才支持。
 * VS Code 内嵌 Simple Browser、Firefox、Safari 均不支持——用于给出友好引导，避免抛出看不懂的报错。
 */
export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFsAccessSupported()) {
    throw new Error('UNSUPPORTED_BROWSER');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function walkPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  let dir = root;
  for (const segment of parts) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return { dir, name };
}

export async function readFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string> {
  const { dir, name } = await walkPath(root, path, false);
  const fileHandle = await dir.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.text();
}

export async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const { dir, name } = await walkPath(root, path, true);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (const segment of parts) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

export async function fileExists(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  try {
    const { dir, name } = await walkPath(root, path, false);
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(
  root: FileSystemDirectoryHandle,
  path?: string,
): Promise<string[]> {
  let dir = root;
  if (path) {
    const parts = path.split('/').filter(Boolean);
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment);
    }
  }
  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') names.push(entry.name);
  }
  return names;
}

export async function readFileAsUrl(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string> {
  const { dir, name } = await walkPath(root, path, false);
  const fileHandle = await dir.getFileHandle(name);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}

export async function readFileOrDefault(
  root: FileSystemDirectoryHandle,
  path: string,
  defaultValue: string,
): Promise<string> {
  try {
    return await readFile(root, path);
  } catch {
    return defaultValue;
  }
}
