# scrapers — 采集模块

各招聘平台的采集实现，共享一个 API 服务层。

## 模块

| 目录 | 平台 | 状态 |
|------|------|------|
| `shared/` | 共享基础服务 | 稳定 |
| `boss/` | BOSS 直聘 | 稳定 |
| `zhaopin/` | 智联招聘 | 稳定 |

## 快速启动

```bash
npm run boss:scan      # BOSS RPA 全自动扫描
npm run boss:hs        # BOSS Hammerspoon 模式
npm run zhaopin:hs     # 智联 Hammerspoon 模式
npm run boss:api       # 单独启动共享 API 服务
```
