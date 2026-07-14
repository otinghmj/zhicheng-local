import { expect, test } from '@playwright/test';

test.describe('面试准备完整查看链路', () => {
  test('读取 Agent 生成物并完成查看、筛选、切换和跳转', async ({ page }) => {
    await page.goto('/interview-prep');

    const storyPanel = page.locator('.prep-story-panel');
    const detailPanel = page.locator('.prep-detail-panel');
    await expect(page.getByRole('heading', { name: '面试准备' })).toBeVisible();
    await expect(storyPanel).toContainText('共 2 条故事');

    const firstStory = storyPanel.locator('.prep-story').filter({ hasText: '制造知识助手验证' });
    await expect(firstStory).toHaveCount(1);
    await firstStory.click();
    await expect(firstStory).toContainText('S · 情境');
    await expect(firstStory).toContainText('R · 结果');

    const storySearch = storyPanel.getByPlaceholder('搜索标题 / 内容关键词');
    await storySearch.fill('工单');
    await expect(storyPanel.locator('.prep-story')).toHaveCount(1);
    await expect(storyPanel).toContainText('故障工单分类流程改造');
    await storySearch.fill('');

    const ragFilter = storyPanel.getByRole('button', { name: 'RAG1' });
    await expect(ragFilter).toHaveCount(1);
    await ragFilter.click();
    await expect(storyPanel.locator('.prep-story')).toHaveCount(1);
    await expect(storyPanel).toContainText('制造知识助手验证');
    await ragFilter.click();
    await expect(storyPanel.locator('.prep-story')).toHaveCount(2);

    const themePicker = storyPanel.locator('.prep-theme-filter');
    await themePicker.click();
    const ragOption = page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: 'RAG 1' });
    await expect(ragOption).toHaveCount(1);
    await ragOption.click();
    await expect(storyPanel.locator('.prep-story')).toHaveCount(1);
    await expect(storyPanel).toContainText('制造知识助手验证');
    await ragFilter.click();
    await expect(storyPanel.locator('.prep-story')).toHaveCount(2);

    const modules = [
      ['行业沉浸', '典型工作场景'],
      ['名词解释', 'RAG'],
      ['任务模拟', '工艺知识查询助手验收'],
      ['角色扮演', '直属领导追问'],
      ['小作品框架', '选定方案：可追溯故障问答演示'],
    ];
    for (const [moduleName, expectedContent] of modules) {
      const moduleButton = page.locator('.prep-module').filter({ hasText: moduleName });
      await expect(moduleButton).toHaveCount(1);
      await moduleButton.click();
      await expect(detailPanel).toContainText(expectedContent);
    }

    const picker = page.locator('.prep-picker');
    await picker.click();
    const cloudOption = page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: '示例云服务 · 大模型工程师 · 评分 4.6' });
    await expect(cloudOption).toHaveCount(1);
    await cloudOption.click();
    await expect(picker).toContainText('示例云服务 · 大模型工程师 · 评分 4.6');

    const reportButton = page.getByRole('button', { name: '打开评估报告' });
    await expect(reportButton).toHaveCount(1);
    await reportButton.click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: '评估报告' })).toBeVisible();
  });
});
