# scrapers — 采集模块

这里放的是招聘网站采集器。采集器可以理解成“从招聘网站页面里提取岗位信息的小工具”。

本地大众版只保留普通用户相对容易跑起来的采集器。

## 当前保留

| 目录 | 平台 | 方式 | 状态 |
|------|------|------|------|
| `51job/` | 前程无忧 | OpenCLI | 正式保留 |
| `liepin/` | 猎聘 | Chrome CDP + 页面结构读取 | 正式保留 |
| `shared/` | 共享工具 | Chrome、登录检查、城市码 | 内部依赖 |

OpenCLI 可以理解成“让程序调用本机浏览器登录状态的桥”。  
CDP 可以理解成“Chrome 留给程序控制浏览器的接口”。

## 快速启动

```bash
npm run 51job:opencli
npm run liepin:dom
```

也可以直接运行脚本：

```bash
node scrapers/51job/51job-opencli.mjs --query SQE --city 030200 --max-pages 10
node scrapers/liepin/liepin-dom.mjs --query SQE --city 上海 --max-pages 5
```

## 已移除

BOSS 直聘和智联招聘的旧采集器依赖 Hammerspoon。Hammerspoon 可以理解成“macOS 上的自动点击工具”。这类方案对普通用户门槛高，也更容易因为窗口位置、系统权限和页面变化失效，所以没有继续放在本地大众版里。
