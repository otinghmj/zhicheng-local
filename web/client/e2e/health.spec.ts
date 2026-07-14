import { test, expect } from '@playwright/test';

test.describe('Server health', () => {
  test('all main pages load with their expected title', async ({ page }) => {
    const pages = [
      ['/', undefined],
      ['/collection', '采集任务'],
      ['/pipeline', '待处理队列'],
      ['/reports', '评估报告'],
      ['/interview-prep', '面试准备'],
      ['/resumes', '简历管理'],
      ['/applications', '投递跟踪'],
    ] as const;

    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible({ timeout: 10000 });
      if (title) await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10000 });
    }
  });
});
