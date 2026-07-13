import { create } from 'zustand';
import {
  pickDirectory as pickDir,
  isFsAccessSupported,
  saveHandle,
  loadHandle,
  clearHandle,
  verifyPermission,
  ensureDir,
  writeFile,
  fileExists,
} from '../lib/fs';

const APP_HEADER =
  '| # | 日期 | 公司 | 职位 | 评分 | 状态 | PDF | 报告 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';

const DIRS = ['data', 'config', 'reports', 'interview-prep', 'output', 'modes'];

const EMPTY_FILES: Record<string, string> = {
  'data/applications.md': APP_HEADER,
  'data/pipeline.md': '## Pending\n\n## Processed\n',
  'data/scan-history.tsv': '',
  'data/task-history.tsv': '',
  'data/activity-log.tsv': '',
  'data/metrics-history.tsv': '',
  'cv.md': '',
  'portals.yml': '',
  'config/profile.yml': '# Profile\n',
};

type FsStatus = 'idle' | 'restoring' | 'ready' | 'denied' | 'error' | 'unsupported';

interface FsState {
  dirHandle: FileSystemDirectoryHandle | null;
  status: FsStatus;
  error: string | null;

  pickDirectory: () => Promise<void>;
  restoreHandle: () => Promise<void>;
  disconnect: () => Promise<void>;
  initStructure: (handle: FileSystemDirectoryHandle) => Promise<void>;
}

export const useFsStore = create<FsState>((set, get) => ({
  dirHandle: null,
  status: 'idle',
  error: null,

  pickDirectory: async () => {
    if (!isFsAccessSupported()) {
      set({ status: 'unsupported', error: null });
      return;
    }
    try {
      const handle = await pickDir();
      await saveHandle(handle);
      const initialized = await fileExists(handle, 'data/applications.md');
      if (!initialized) {
        await get().initStructure(handle);
      }
      set({ dirHandle: handle, status: 'ready', error: null });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof Error && e.message === 'UNSUPPORTED_BROWSER') {
        set({ status: 'unsupported', error: null });
        return;
      }
      set({ status: 'error', error: (e as Error).message });
    }
  },

  restoreHandle: async () => {
    if (!isFsAccessSupported()) {
      set({ status: 'unsupported', error: null });
      return;
    }
    set({ status: 'restoring' });
    try {
      const handle = await loadHandle();
      if (!handle) {
        set({ status: 'idle' });
        return;
      }
      const granted = await verifyPermission(handle);
      if (!granted) {
        set({ status: 'denied', error: '目录访问权限被拒绝' });
        return;
      }
      set({ dirHandle: handle, status: 'ready', error: null });
    } catch {
      set({ status: 'idle' });
    }
  },

  disconnect: async () => {
    await clearHandle();
    set({ dirHandle: null, status: 'idle', error: null });
  },

  initStructure: async (handle) => {
    for (const dir of DIRS) {
      await ensureDir(handle, dir);
    }
    for (const [path, content] of Object.entries(EMPTY_FILES)) {
      const exists = await fileExists(handle, path);
      if (!exists) {
        await writeFile(handle, path, content);
      }
    }
  },
}));
