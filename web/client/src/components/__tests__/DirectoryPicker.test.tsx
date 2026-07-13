import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectoryPicker } from '../DirectoryPicker';

const loadAll = vi.fn();
let state: { loading: boolean; error: string | null; loadAll: typeof loadAll };

vi.mock('../../stores/dataStore', () => ({
  useDataStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

describe('DirectoryPicker (只读看板数据网关)', () => {
  beforeEach(() => {
    loadAll.mockClear();
    state = { loading: false, error: null, loadAll };
  });

  it('加载完成且无错误时渲染子内容', () => {
    render(<DirectoryPicker><div>App Content</div></DirectoryPicker>);
    expect(screen.getByText('App Content')).toBeInTheDocument();
  });

  it('挂载时从 API 加载数据（不依赖 File System Access）', () => {
    render(<DirectoryPicker><div>x</div></DirectoryPicker>);
    expect(loadAll).toHaveBeenCalled();
  });

  it('加载中显示 spinner，不渲染子内容', () => {
    state = { loading: true, error: null, loadAll };
    const { container } = render(<DirectoryPicker><div>App Content</div></DirectoryPicker>);
    expect(screen.queryByText('App Content')).not.toBeInTheDocument();
    expect(container.querySelector('.ant-spin')).toBeTruthy();
  });

  it('加载失败显示错误态与重试按钮', async () => {
    state = { loading: false, error: '后端不可用', loadAll };
    render(<DirectoryPicker><div>App Content</div></DirectoryPicker>);
    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    expect(screen.queryByText('App Content')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('重试'));
    expect(loadAll).toHaveBeenCalled();
  });
});
