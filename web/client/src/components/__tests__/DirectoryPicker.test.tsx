import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectoryPicker } from '../DirectoryPicker';
import { useFsStore } from '../../stores/fsStore';

vi.mock('../../stores/dataStore', () => ({
  useDataStore: vi.fn(() => ({ loading: false, loadAll: vi.fn() })),
}));

const noopRestore = vi.fn();

describe('DirectoryPicker', () => {
  beforeEach(() => {
    useFsStore.setState({
      dirHandle: null,
      status: 'idle',
      error: null,
      restoreHandle: noopRestore,
    });
    noopRestore.mockClear();
  });

  it('shows directory picker UI when no handle', () => {
    render(
      <DirectoryPicker>
        <div>App Content</div>
      </DirectoryPicker>,
    );

    expect(screen.getByText('选择工作目录')).toBeInTheDocument();
    expect(screen.getByText('选择目录')).toBeInTheDocument();
    expect(screen.queryByText('App Content')).not.toBeInTheDocument();
  });

  it('renders children when status is ready with handle', () => {
    useFsStore.setState({
      dirHandle: { kind: 'directory', name: 'test' } as FileSystemDirectoryHandle,
      status: 'ready',
      restoreHandle: noopRestore,
    });

    render(
      <DirectoryPicker>
        <div>App Content</div>
      </DirectoryPicker>,
    );

    expect(screen.getByText('App Content')).toBeInTheDocument();
    expect(screen.queryByText('选择工作目录')).not.toBeInTheDocument();
  });

  it('shows denied state with retry and pick buttons', () => {
    useFsStore.setState({ status: 'denied', error: '目录访问权限被拒绝', restoreHandle: noopRestore });

    render(
      <DirectoryPicker>
        <div>App Content</div>
      </DirectoryPicker>,
    );

    expect(screen.getByText('需要目录访问权限')).toBeInTheDocument();
    expect(screen.getByText('重新授权')).toBeInTheDocument();
    expect(screen.getByText('选择新目录')).toBeInTheDocument();
  });

  it('shows error state', () => {
    useFsStore.setState({ status: 'error', error: 'Something went wrong', restoreHandle: noopRestore });

    render(
      <DirectoryPicker>
        <div>App Content</div>
      </DirectoryPicker>,
    );

    expect(screen.getByText('目录访问失败')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls pickDirectory when button clicked', async () => {
    const pickDirectory = vi.fn();
    useFsStore.setState({ status: 'idle', pickDirectory, restoreHandle: noopRestore });

    render(
      <DirectoryPicker>
        <div>App Content</div>
      </DirectoryPicker>,
    );

    await userEvent.click(screen.getByText('选择目录'));
    expect(pickDirectory).toHaveBeenCalled();
  });
});
