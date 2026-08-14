# 👀 DeepSeek Vision Addon —— 让 DeepSeek 睁开眼

> **给纯文本的 DeepSeek 装上「豆包之眼」：零 API 费用、零配置，一句话让 DeepSeek 看懂任何图片。**

DeepSeek 模型再强，也看不见图——但谁说纯文本模型不能看图？

这个项目用一条巧妙的链路，让 DeepSeek **免费获得全球第一梯队的视觉能力**：
**你给图 → DeepSeek 自动调豆包网页版识图 → 豆包把图片转成文字 → DeepSeek 基于描述继续思考。**

不需要申请任何 API Key，不需要接入任何付费服务，只需要一个你日常使用的豆包账号。

---

## ✨ 为什么值得一试

| 特性 | 说明 |
|---|---|
| 🆓 **零成本** | 走豆包网页版免费额度，官方承诺基础功能永久免费、不阉割、不降速 |
| 🧠 **顶级视觉** | 豆包视觉在 SuperCLUE-VLM 中文评测中多次登顶，全球第一梯队 |
| ⚡ **快** | 条件等待替代固定轮询，单张识图约 10~20 秒 |
| 🔄 **自愈** | 豆包窗口关闭后自动用登录态拉起，无需人工干预 |
| 🧹 **干净** | 每次识图自动开新对话，不污染你的豆包历史 |
| 📦 **批量** | 一次最多识别 9 张图 |
| 🛡️ **安全** | 风控检测（验证码/限流/登录过期）明确报错 |

## 🎯 适用场景

- 让 DeepSeek **读懂截图、照片、文档扫描件**
- 分析 **表格、图表、UI 界面**，提取关键信息
- 帮你看 **电路板、实物照片**（实测能识别杜邦线颜色、芯片丝印！）
- 多图对比：**批量识图后让 DeepSeek 找差异**

## 🧩 工作原理

```
用户提供图片路径
    │
    ▼
doubao_vision 工具（DeepSeek Harness 插件）
    │
    ▼
ensure-edge.js  确保豆包登录窗口可用（CDP :9991，挂了自动拉起）
    │
    ▼
doubao-vision-core.js  驱动 Edge → 上传图片 → 输入提示词 → 发送 → 提取回复
    │
    ▼
{"ok":true, "reply":"豆包对图片的文字描述"}
    │
    ▼
DeepSeek 基于描述继续推理、总结、对比
```

## 📁 文件结构

| 文件 | 作用 |
|---|---|
| `doubao-identify.js` | 识图入口，输出 JSON（供插件解析） |
| `doubao-vision-core.js` | 核心引擎：上传、发送、轮询、风控检测 |
| `ensure-edge.js` | 窗口守护：检测 CDP 端口，自动拉起带登录态的 Edge |
| `restart-dsh.js` | （可选）一键重启 DeepSeek Harness |

## 🚀 快速开始

### 前置条件

- **Windows** + **Node.js ≥ 18** + **Edge 浏览器**
- **DeepSeek Harness**（Web 版）

### 1. 安装

```bash
cd vision-chain
npm install playwright-core
```

### 2. 登录豆包（一次性，约 30 秒）

```bash
node ensure-edge.js
```

会弹出 Edge 窗口指向豆包，**手动扫码/验证码登录一次**。登录态持久化在本地 `edge-profile-login/`（已被 .gitignore 排除，不会泄露）。之后窗口关了也不怕，`ensure-edge.js` 会自动恢复登录。

### 3. 命令行使用

```bash
# 单图识图
node doubao-identify.js "C:\path\image.jpg"

# 自定义提示 + 简要模式
node doubao-identify.js "image.jpg" --prompt "提取图中表格内容" --mode brief

# 批量（最多 9 张）
node doubao-identify.js "a.png" "b.png" "c.png" --prompt "对比三张图"

# 保留当前豆包对话（默认每次开新对话）
node doubao-identify.js "image.jpg" --new-conversation false
```

### 4. 集成进 DeepSeek Harness（可选但推荐）

把 `dsh-tool-doubao-vision` 插件放入 Harness 的 `profiles/node_modules/@deepseek-ai/`，在 `cordis.patch.yml` 挂载：

```yaml
- insert:
    - id: tool-doubao-vision
      name: '@deepseek-ai/dsh-tool-doubao-vision'
```

重启后 Agent 自动获得 `doubao_vision` 工具——**之后你只需要说"看一下这张图"，剩下的交给它**。

## ⚙️ 参数

| 参数 | 说明 |
|---|---|
| `image_paths` | 图片路径数组（最多 9 张） |
| `prompt` | 自定义识图提示词 |
| `mode` | `detail` 详细描述（默认）\| `brief` 简要概括 |
| `new_conversation` | 每次自动开新对话（默认 true） |

**环境变量**（可选）：`VISION_CHAIN_HOME` 指定项目目录，`EDGE_PATH` 指定 Edge 路径。

## ⚠️ 须知

- 识图消耗你的**豆包免费额度**，请个人适度使用，勿高频滥用
- 自动化调用网页版属**服务条款灰色地带**，仅限个人学习研究
- `edge-profile-login/` 含登录 cookie，**切勿上传或分享**

## 📄 License

MIT
