# DeepSeek 视觉外挂 —— 豆包识图工具链

> 给纯文本的 DeepSeek 装上「眼睛」：通过自动化调用豆包网页版，让 DeepSeek 无需任何额外 API 费用即可看图、识图。

## 为什么需要它

DeepSeek 官方模型（deepseek-chat / reasoner / v4 等）是**纯文本模型**，不能直接接收图片。本项目的思路是：**图片 → 豆包网页版视觉能力 → 文字描述 → DeepSeek 基于描述推理**。豆包视觉能力处于全球第一梯队（中文语境下多次登顶 SuperCLUE-VLM 榜单），且网页版免费，无需申请任何 API Key。

## 工作原理

```
用户提供图片路径
    ↓
doubao_vision 工具（Harness 插件）
    ↓
ensure-edge.js  确保豆包登录窗口可用（CDP 端口 9991，挂了自动拉起）
    ↓
doubao-vision-core.js  驱动 Edge 打开豆包网页 → 上传图片 → 输入提示词 → 发送 → 提取回复
    ↓
返回 JSON { ok: true, reply: "豆包对图片的文字描述" }
    ↓
DeepSeek 基于描述继续推理
```

## 文件结构

| 文件 | 作用 |
|---|---|
| `doubao-identify.js` | 识图入口，输出 JSON（供 Harness 插件解析） |
| `doubao-vision-core.js` | 核心识图引擎：上传、发送、轮询回复、风控检测 |
| `ensure-edge.js` | 豆包窗口守护：检测 CDP 端口，失效时自动用登录态拉起 Edge |
| `find-dsh.ps1` | （本机运维）查找 dsh web 进程 |
| `restart-dsh.js` | （本机运维）重启 DeepSeek Harness |

## 安装

### 前置条件

- **Windows**（脚本基于 Windows + Edge）
- **Node.js** ≥ 18
- **Microsoft Edge**（系统已安装）
- **DeepSeek Harness**（Web 版），且需要能注册 Cordis 插件

### 1. 安装依赖

```bash
cd vision-chain
npm install playwright-core
```

### 2. 登录豆包（一次性）

```bash
node ensure-edge.js
```

这会打开一个 Edge 窗口指向豆包网页。**手动扫码/验证码登录一次**，登录态会持久化到 `edge-profile-login/` 目录（该目录已被 .gitignore 排除，不会上传）。

之后窗口关闭也不怕：`ensure-edge.js` 会自动用保存的登录态重新拉起窗口。

### 3. 命令行使用

```bash
# 单图识图
node doubao-identify.js "C:\path\to\image.jpg"

# 自定义提示词 + 简要模式
node doubao-identify.js "image.jpg" --prompt "提取图中表格内容" --mode brief

# 批量识图（最多 9 张）
node doubao-identify.js "a.png" "b.png" "c.png" --prompt "对比这三张图"

# 不自动开新对话（默认每次开新对话避免历史堆积）
node doubao-identify.js "image.jpg" --new-conversation false
```

### 4. 集成到 DeepSeek Harness（可选）

将 `dsh-tool-doubao-vision` 插件包放入 Harness 的 `profiles/node_modules/@deepseek-ai/` 目录，并在 profile 的 `cordis.patch.yml` 中挂载：

```yaml
- insert:
    - id: tool-doubao-vision
      name: '@deepseek-ai/dsh-tool-doubao-vision'
```

重启 Harness 后，Agent 会自动获得 `doubao_vision` 工具，无需手动注册。

## 参数说明

| 参数 | 说明 |
|---|---|
| `image_paths` | 图片路径数组，支持单张或多张（最多 9 张） |
| `prompt` | 自定义识图提示词（默认：详细描述图片内容） |
| `mode` | `detail` 详细描述（默认）\| `brief` 简要概括 |
| `new_conversation` | 每次自动开新对话（默认 true，避免豆包历史堆积） |

## 特性

- 🚀 **提速**：条件等待替代固定轮询，单张识图约 10~20 秒
- 🔄 **自动恢复**：豆包窗口关闭后自动用登录态拉起
- 🧹 **自动新对话**：不污染豆包历史记录
- 🛡️ **风控检测**：验证码/频率限制/登录过期给出明确提示
- 📦 **批量识图**：一次最多 9 张

## 注意事项

- 识图会消耗你的**豆包账号免费额度**（网页版基础功能免费，官方承诺不阉割）
- 自动化调用网页版属**服务条款灰色地带**，请个人适度使用，勿高频滥用
- 登录态目录 `edge-profile-login/` 含你的登录 cookie，**切勿上传或分享**
- 脚本中的绝对路径（`E:/ASUS/Documents/...`）为作者本机路径，换环境需修改 `BASE` 常量

## 许可证

MIT
