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
- 通过 MCP 连接 Claude Code、Cursor、Codex 这类本地 Agent。

MCP 是一种让网页后端和 AI Agent 通信的协议。你不用先理解它，先知道一件事就够了：连接后，网页可以把“评估这个岗位”“生成面试准备”这类任务交给本地 Agent 做。

## 适合谁

适合想自己掌控求职数据的人。

如果你只是偶尔投几个岗位，用表格可能就够了。

如果你每天看很多 JD，想系统比较岗位、改简历、记录进度，这个工具会更有用。

## 安装

先准备好：

- Node.js 18 或更高版本
- Git
- Google Chrome

然后运行：

```bash
git clone https://github.com/otinghmj/zhicheng-local.git zhicheng
cd zhicheng
npm run setup
npm start
```

打开：

```text
http://localhost:5173
```

第一次打开时，页面会让你选择一个本地工作目录。建议新建一个空文件夹专门放求职数据。

## 常用命令

```bash
npm run setup      # 安装依赖，创建个人配置文件
npm run doctor     # 检查本机环境
npm start          # 启动本地网页
npm run agent      # 启动本地 Agent 连接器
npm run mcp:setup  # 写入 Claude Code / Cursor 的 MCP 配置
```

如果你把命令装到了全局，也可以这样用：

```bash
zhicheng setup
zhicheng doctor
zhicheng start
zhicheng agent
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

推荐先启动网页：

```bash
npm start
```

再配置 MCP：

```bash
npm run mcp:setup
```

然后重启 Claude Code 或 Cursor。

你也可以在网页右上角打开 AI 设置，复制里面的提示词，让你的 Agent 自己写配置。

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
