import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFsStore } from '../fsStore';

vi.mock('../../lib/fs', () => ({
  pickDirectory: vi.fn(),
  isFsAccessSupported: vi.fn(() => true),
  saveHandle: vi.fn(),
  loadHandle: vi.fn(),
  clearHandle: vi.fn(),
  verifyPermission: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}));

const fsMock = await import('../../lib/fs');

describe('fsStore', () => {
  beforeEach(() => {
    useFsStore.setState({ dirHandle: null, status: 'idle', error: null });
    vi.clearAllMocks();
  });

  describe('pickDirectory', () => {
    it('sets status to ready on success with initialized dir', async () => {
      const mockHandle = { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle;
      vi.mocked(fsMock.pickDirectory).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.fileExists).mockResolvedValue(true);

      await useFsStore.getState().pickDirectory();

      const state = useFsStore.getState();
      expect(state.status).toBe('ready');
      expect(state.dirHandle).toBe(mockHandle);
    });

    it('initializes structure for empty directory', async () => {
      const mockHandle = { kind: 'directory', name: 'empty' } as FileSystemDirectoryHandle;
      vi.mocked(fsMock.pickDirectory).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.fileExists).mockResolvedValue(false);
      vi.mocked(fsMock.ensureDir).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.writeFile).mockResolvedValue(undefined);

      await useFsStore.getState().pickDirectory();

      expect(fsMock.ensureDir).toHaveBeenCalled();
      expect(fsMock.writeFile).toHaveBeenCalled();
      expect(useFsStore.getState().status).toBe('ready');
    });

    it('saves handle without user account context', async () => {
      const mockHandle = { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle;
      vi.mocked(fsMock.pickDirectory).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.fileExists).mockResolvedValue(true);

      await useFsStore.getState().pickDirectory();

      expect(fsMock.saveHandle).toHaveBeenCalledWith(mockHandle);
    });

    it('sets error status on failure', async () => {
      vi.mocked(fsMock.pickDirectory).mockRejectedValue(new Error('Access denied'));

      await useFsStore.getState().pickDirectory();

      expect(useFsStore.getState().status).toBe('error');
      expect(useFsStore.getState().error).toBe('Access denied');
    });

    it('ignores AbortError (user cancelled)', async () => {
      const abort = new DOMException('User cancelled', 'AbortError');
      vi.mocked(fsMock.pickDirectory).mockRejectedValue(abort);

      await useFsStore.getState().pickDirectory();

      expect(useFsStore.getState().status).toBe('idle');
    });

    it('sets unsupported status when File System Access API is unavailable', async () => {
      vi.mocked(fsMock.isFsAccessSupported).mockReturnValueOnce(false);

      await useFsStore.getState().pickDirectory();

      expect(useFsStore.getState().status).toBe('unsupported');
      expect(fsMock.pickDirectory).not.toHaveBeenCalled();
    });
  });

  describe('restoreHandle', () => {
    it('sets idle when no saved handle', async () => {
      vi.mocked(fsMock.loadHandle).mockResolvedValue(null);

      await useFsStore.getState().restoreHandle();

      expect(useFsStore.getState().status).toBe('idle');
    });

    it('sets denied when permission not granted', async () => {
      const mockHandle = { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle;
      vi.mocked(fsMock.loadHandle).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.verifyPermission).mockResolvedValue(false);

      await useFsStore.getState().restoreHandle();

      expect(useFsStore.getState().status).toBe('denied');
    });

    it('sets ready when permission granted', async () => {
      const mockHandle = { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle;
      vi.mocked(fsMock.loadHandle).mockResolvedValue(mockHandle);
      vi.mocked(fsMock.verifyPermission).mockResolvedValue(true);

      await useFsStore.getState().restoreHandle();

      expect(useFsStore.getState().status).toBe('ready');
      expect(useFsStore.getState().dirHandle).toBe(mockHandle);
    });

    it('loads handle without user account context', async () => {
      vi.mocked(fsMock.loadHandle).mockResolvedValue(null);

      await useFsStore.getState().restoreHandle();

      expect(fsMock.loadHandle).toHaveBeenCalledWith();
    });

    it('sets unsupported status when File System Access API is unavailable', async () => {
      vi.mocked(fsMock.isFsAccessSupported).mockReturnValueOnce(false);

      await useFsStore.getState().restoreHandle();

      expect(useFsStore.getState().status).toBe('unsupported');
      expect(fsMock.loadHandle).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('clears handle and resets to idle', async () => {
      useFsStore.setState({
        dirHandle: { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle,
        status: 'ready',
      });

      await useFsStore.getState().disconnect();

      expect(useFsStore.getState().dirHandle).toBeNull();
      expect(useFsStore.getState().status).toBe('idle');
    });
  });
});
