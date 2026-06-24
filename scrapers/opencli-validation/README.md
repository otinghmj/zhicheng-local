# OpenCLI 验证套件

用于验证 OpenCLI 能否替代现有 RPA 脚本的数据采集，**完全独立，不影响原脚本**。

## 覆盖平台

| 平台 | 验证脚本 | 说明 |
|------|---------|------|
| BOSS直聘 | `validate-boss.mjs` | search + detail |
| 前程无忧 | `validate-51job.mjs` | search + detail + hot |
| 猎聘 | 不验证 | 原脚本主路是 REST API，无需 RPA |
| 智联 | 不验证 | OpenCLI 无适配器 |

## 前置条件

```bash
# 1. 安装 OpenCLI
npm install -g @jackwener/opencli

# 2. Chrome 安装 Browser Bridge 扩展
#    opencli 会在首次运行时提示安装链接

# 3. 检查环境
node scrapers/opencli-validation/setup-check.mjs
```

## 验证步骤

### Step 1 — 最小验证（单次，limit=10）
```bash
node scrapers/opencli-validation/validate-boss.mjs --query SQE --city 广州 --limit 10
node scrapers/opencli-validation/validate-51job.mjs --query SQE --city 广州 --limit 10
```

### Step 2 — 稳定性验证（连续3轮）
```bash
node scrapers/opencli-validation/validate-boss.mjs --rounds 3
node scrapers/opencli-validation/validate-51job.mjs --rounds 3
```

### Step 3 — 大批量压测（limit=50，与原脚本量级对齐）
```bash
node scrapers/opencli-validation/validate-boss.mjs --limit 50
node scrapers/opencli-validation/validate-51job.mjs --limit 50
```

## 关注指标

- **连通性**：opencli 能否正常返回 JSON
- **字段完整性**：salary/company/city 填充率是否接近 100%
- **风控信号**：是否出现"验证""频繁""WAF"等关键词
- **速度**：单次请求耗时，与原脚本对比

## 结果

验证结果保存在 `output/` 目录（已 gitignore）。
