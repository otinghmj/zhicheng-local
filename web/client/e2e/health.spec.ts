import { test, expect } from '@playwright/test';

test.describe('Server health', () => {
  test('homepage shows local directory picker', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('选择工作目录')).toBeVisible({ timeout: 10000 });
  });
});
