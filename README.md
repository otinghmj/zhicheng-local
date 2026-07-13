免责声明：

大家请以学习为目的使用本仓库⚠️⚠️⚠️⚠️，[爬虫违法违规的案件](https://github.com/HiddenStrawberry/Crawler_Illegal_Cases_In_China)

本仓库的所有内容仅供学习和参考之用，禁止用于商业用途。任何人或组织不得将本仓库的内容用于非法用途或侵犯他人合法权益。本仓库所涉及的爬虫技术仅用于学习和研究，不得用于对其他平台进行大规模爬虫或其他非法行为。对于因使用本仓库内容而引起的任何法律责任，本仓库不承担任何责任。使用本仓库的内容即表示您同意本免责声明的所有条款和条件。


# 职程

职程是一个跑在本机的 AI 求职工作台。

它不替你投简历，也不承诺帮你找到工作。它做的是另一件更实际的事：把岗位、简历、评估报告、投递状态和面试材料放到一套流程里，别让找工作变成一堆散落的链接和文档。

数据默认留在你的电脑上。你可以自己选工作目录，报告、PDF、投递记录都会写到那里。

## 你可以用它做什么

- 把招聘网站上的岗位采集到待处理队列。
- 让 AI 根据你的简历和目标岗位做匹配度评估。
- 为每个岗位生成一份 Markdown 报告。
- 需要时生成定制版 PDF 简历。
- 维护投递跟踪表。
- 整理面试准备材料和故事库。
- 通过 MCP 连接 Claude Code、Cursor、Codex 或**任意支持 MCP 的 Agent**。

MCP 是一种让网页后端和 AI Agent 通信的协议。你不用先理解它，先知道一件事就够了：连接后，网页可以把“评估这个岗位”“生成面试准备”这类任务交给本地 Agent 做。项目根有一份面向任意 Agent 的操作契约 [`AGENTS.md`](AGENTS.md)——你的 Agent 读完就能像用一个 skill 一样驱动职程（领任务、执行、把产物写回文件），不限于某一家工具。

## 适合谁

适合想自己掌控求职数据的人。

如果你只是偶尔投几个岗位，用表格可能就够了。

如果你每天看很多 JD，想系统比较岗位、改简历、记录进度，这个工具会更有用。

## 💬 AI 交流群

有什么 AI 相关的话题想交流，或者：

- 💡 想讨论 AI 应用、工作流或项目思路
- 🛠️ 遇到项目 Bug、开发问题需要求助
- 🚀 分享自己的折腾经验、踩坑心得
- 🤝 寻找合作伙伴，一起做有意思的项目

都欢迎加入交流群！

> 📌 入群后请先阅读群公告。  
> 🙋 提问时尽量描述清楚问题，并附上截图或报错信息，方便大家快速定位。  
> 🌱 群里主打互助交流、经验分享和灵感碰撞，希望大家共同成长、一起迭代。

<p align="center">
  <img src="https://github.com/user-attachments/assets/22179bb3-17a9-474c-b164-b6a1b2e48161" alt="AI交流群" width="320" />
</p>

<p align="center"><b>扫码加入 AI 交流群</b></p>

## 如果项目对你有帮助？欢迎能请杯咖啡犒劳一下


金额随意，1 元也是对开源的鼓励。欢迎在赞赏时备注留言

<p align="center">
  <img src="https://github.com/user-attachments/assets/02a9f7cf-8175-4bfe-b37d-73604261b6df" alt="微信赞赏" width="320" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://github.com/user-attachments/assets/311774c4-6c1e-4c3f-9da7-965ddd9fcd18" alt="支付宝赞赏" width="320" />
</p>

<p align="center">
  <b>微信赞赏</b>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <b>支付宝赞赏</b>
</p>


## 安装

先准备好：

- Node.js 18 或更高版本
- Git
- Google Chrome

然后运行：

```bash
git clone https://github.com/otinghmj/zhicheng-local.git zhicheng
cd zhicheng
npm start
```

**一条 `npm start` 就够了**：首次运行会自动装依赖、创建个人配置文件、写好 MCP 配置，然后启动网页——不用再单独跑 `npm run setup` 和 `npm run mcp:setup`。（想单独初始化仍可 `npm run setup`。）

打开：

```text
http://localhost:5173
```

第一次打开时，页面会让你选择一个本地工作目录。建议新建一个空文件夹专门放求职数据。

> ⚠️ 请用**独立的 Chrome 或 Edge 窗口**打开 `http://localhost:5173`，不要用 VS Code 内嵌的 Simple Browser、Firefox 或 Safari。选择工作目录依赖浏览器的「文件系统访问」能力（File System Access API），只有前者支持；用其它环境打开会卡在选目录这一步、进不了后续功能。

## 常用命令

```bash
npm run setup      # 安装依赖，创建个人配置文件
npm run doctor     # 检查本机环境
npm start          # 启动本地网页
npm run mcp:setup  # 写入 Claude Code / Cursor 的 MCP 配置
npm run mcp:print  # 打印任意 Agent 可用的 MCP 配置片段
```

如果你把命令装到了全局，也可以这样用：

```bash
zhicheng setup
zhicheng doctor
zhicheng start
zhicheng mcp:setup
```

没装全局命令也没关系，在项目目录里可以直接运行：

```bash
npx . start
```

## 需要你自己填写的文件

`npm run setup` 会创建这些文件：

```text
cv.md
config/profile.yml
modes/_profile.md
portals.yml
article-digest.md
```

大概意思如下：

- `cv.md`：你的简历正文。
- `config/profile.yml`：目标岗位、城市、薪资、偏好。
- `modes/_profile.md`：你的优势、经历叙事、谈薪策略。
- `portals.yml`：你想关注的招聘来源。
- `article-digest.md`：项目、文章、作品亮点。

这些文件一开始只是模板。要让评估结果靠谱，你需要认真填。

## 数据放在哪里

常见目录：

```text
data/              投递记录、待处理队列、采集历史
reports/           岗位评估报告
output/            生成的 PDF
interview-prep/    面试准备材料
jds/               保存下来的 JD
```

这些真实数据默认不会提交到 Git。`.gitignore` 已经排除了：

```text
cv.md
config/profile.yml
modes/_profile.md
article-digest.md
portals.yml
data/*
reports/*
output/*
interview-prep/*
jds/*
```

简单说：代码可以上传，个人数据不要上传。

## 连接 AI Agent

`npm start` 启动时会自动写好本机已安装 Agent（Claude Code / Cursor）的 MCP 配置，通常你只需**重启一次 Agent** 就连上了。

- **Claude Code**：项目根已内置 `.mcp.json`，在本项目目录打开即自动识别，无需额外配置。
- **Cursor**：`npm start` / `npm run mcp:setup` 会写入 `~/.cursor/mcp.json`。
- **Codex 或其它支持 MCP 的 Agent**：运行 `npm run mcp:print` 拿到可粘贴的配置片段，按各自方式添加 `http://localhost:3200/mcp`。

连接后，Agent 请阅读项目根 [`AGENTS.md`](AGENTS.md)——那是一份面向任意 Agent 的操作契约，读完就能像用 skill 一样驱动职程。你也可以在网页右上角打开 AI 设置，复制里面的提示词让 Agent 自己写配置。

### 用一句话驱动（推荐用法）

推荐的用法不是在网页里点按钮，而是**直接对你的 Agent 说一句话**，让它端到端把活干完：

> “采集猎聘北京的 AI 应用工程师岗位，评估前 10 个并生成报告。”

Agent 会自己：建工作目录（`node scripts/init-workspace.mjs`）→ 跑采集脚本 → 按 `modes/` 里的指令评估 → 把报告写进 `reports/`、投递跟踪写进 `batch/tracker-additions/`。

**网页此时只是看板**：打开 `http://localhost:5173` 看 Agent 写出的结果（Dashboard、报告、Pipeline、投递、面试准备），页面通过后端 `/api/data/*` 只读展示、实时刷新。所有写操作都由 Agent 完成，所以用什么浏览器看都行。

只想建工作目录（不装依赖、不启动）时，可单独运行 `npm run init`。

## 本地服务

启动后会有两个地址：

```text
后端：http://127.0.0.1:3200
前端：http://localhost:5173
```

如果启动失败，先跑：

```bash
npm run doctor
```

它会检查 Node.js、npm、Chrome、依赖目录、端口和个人配置文件。

## 采集岗位前要知道

岗位采集依赖你本机 Chrome 里的登录状态。也就是说，你要先在 Chrome 里登录对应招聘网站。

这个项目不会保存你的招聘网站密码。

当前正式保留的采集器：

- 猎聘：通过本机 Chrome 读取页面。
- 前程无忧（51job）：通过 OpenCLI 读取你浏览器里的登录状态。

BOSS 直聘和智联招聘的旧采集器依赖额外的本机自动化工具，普通用户不容易稳定使用，所以没有放进这个大众版。

## 项目目录

```text
web/client/        前端页面
web/server/        本地后端
scrapers/          岗位采集脚本
modes/             AI 任务提示词
templates/         简历模板和示例配置
docs/              详细文档
```

## 许可证

本项目使用 MIT 许可证。许可证可以理解成“别人能怎样使用这份代码的规则”。完整内容见 `LICENSE`。

## 现在还不是什么

职程不是云端招聘平台。

不是自动投递机器人。

也不是“装上就能帮你找到工作”的黑盒工具。

它更像一个本地工作台：把你已经在做的求职动作整理好，再把适合交给 AI 的部分交出去。


## 免责声明
1. 项目目的与性质
本项目（以下简称“本项目”）是作为一个技术研究与学习工具而创建的，旨在探索和学习网络数据采集技术。本项目专注于自媒体平台的数据爬取技术研究，旨在提供给学习者和研究者作为技术交流之用。

2. 法律合规性声明
本项目开发者（以下简称“开发者”）郑重提醒用户在下载、安装和使用本项目时，严格遵守中华人民共和国相关法律法规，包括但不限于《中华人民共和国网络安全法》、《中华人民共和国反间谍法》等所有适用的国家法律和政策。用户应自行承担一切因使用本项目而可能引起的法律责任。

3. 使用目的限制
本项目严禁用于任何非法目的或非学习、非研究的商业行为。本项目不得用于任何形式的非法侵入他人计算机系统，不得用于任何侵犯他人知识产权或其他合法权益的行为。用户应保证其使用本项目的目的纯属个人学习和技术研究，不得用于任何形式的非法活动。

4. 免责声明
开发者已尽最大努力确保本项目的正当性及安全性，但不对用户使用本项目可能引起的任何形式的直接或间接损失承担责任。包括但不限于由于使用本项目而导致的任何数据丢失、设备损坏、法律诉讼等。

5. 知识产权声明
本项目的知识产权归开发者所有。本项目受到著作权法和国际著作权条约以及其他知识产权法律和条约的保护。用户在遵守本声明及相关法律法规的前提下，可以下载和使用本项目。

6. 最终解释权
关于本项目的最终解释权归开发者所有。开发者保留随时更改或更新本免责声明的权利，恕不另行通知。
