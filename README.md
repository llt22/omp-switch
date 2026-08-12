# omp-switch

> 为 [Oh My Pi](https://omp.sh)（OMP）打造的供应商 / 模型配置图形化管理器，一键切换上游供应商。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

omp-switch 是一个本地运行的 Web 应用：通过浏览器管理 `~/.omp/agent/models.yml` 中的供应商（Provider）与模型配置。**所有数据只存在本机，不上传任何服务器**——浏览器只是操作界面，真正的文件读写由本地服务完成。

参考 [CC Switch](https://github.com/farion1231/cc-switch) 与 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 生态的功能设计，界面采用 shadcn/ui 组件库。

## 为什么需要它

在 OMP 中手动编辑 `models.yml` 配置多个供应商（官方 API、中转网关、多账号组）时：

- 每次切换供应商都要改文件、记备份，容易出错
- 模型列表要手抄，思考级别映射（`reasoningEffortMap`）容易配错
- 上游挂了只能靠报错猜，没法快速验证连通性

omp-switch 把这些变成可视化操作：**点一下切换、一键拉取模型列表、流式测速验证连通性、自动备份可恢复**。

## 功能特性

- **供应商管理**：增删改查、启用/停用（即切换）、复制（同网关换 Key 的高频场景）
- **类型驱动添加**：OpenAI 兼容 / Claude / OpenAI 官方 / Gemini 四种预设，自动预填 Base URL 与 API 协议
- **拉取模型列表**：自动从 `/v1/models` 拉取（含候选端点回退），复选框勾选添加，已配置模型自动预勾选；编辑已有供应商时直接使用服务端存储的 Key，无需重复输入
- **模型配置**：上下文窗口、最大输出、思考设置（模式/最低/最高级别）、**思考级别映射**（omp 内部级别 → 供应商实际值，如 GLM 的 `minimal → none`）、compat 高级配置
- **连通性测试**：按协议（chat/completions / messages / responses / generateContent）发送真实流式请求，测量**首字延迟 TTFT**
- **应用与备份**：一键写入 models.yml，自动备份（保留最近 10 份），可随时恢复
- **导入导出**：从当前 models.yml 导入、导出 YAML
- **安全**：API Key 只存本机（`providers.json`，权限 600），界面仅显示掩码；服务只监听 `127.0.0.1`

## 快速开始

### 方式一：直接运行（推荐）

```bash
git clone https://github.com/<your-name>/omp-switch.git
cd omp-switch
./start.command   # 或直接运行编译好的二进制（Release 中下载）
```

启动后浏览器自动打开 `http://127.0.0.1:8642`。首次启动会自动从你现有的 `~/.omp/agent/models.yml` 导入供应商。

### 方式二：从源码构建

```bash
# 后端（零依赖，仅需 bun）
bun server.ts

# 单文件二进制（内置全部依赖与页面）
bun build --compile server.ts --outfile omp-switch

# 前端开发（React 19 + Tailwind v4 + shadcn/ui）
cd web
bun install
bunx vite build        # 产物输出到 web/dist，由 server 托管
bunx vite dev          # 开发模式（默认 5173 端口）
```

> 二进制为当前平台编译（Apple Silicon / Linux x64 等），跨平台分发需在目标平台重新编译。

## 使用指南

### 添加供应商

1. 点击「＋ 添加供应商」
2. 选择类型（OpenAI 兼容 / Claude / OpenAI / Gemini），自动预填 Base URL 与协议
3. 填写名称（自动生成 Provider ID，可手动修改）、Base URL、API Key
4. 点击「拉取模型列表」勾选模型，或手动添加
5. 保存

### 切换供应商

卡片上的「启用 / 停用」即切换操作——停用当前、启用目标，然后点击顶部「应用到 omp」写入 `models.yml`。每次应用前自动备份，可在「历史备份」中恢复。

### 测试连通性

卡片上点击「测试」，选择模型与思考级别，工具会发送真实流式请求并返回首字延迟（TTFT）与总耗时。401/403 会明确提示凭证无效。

### 思考级别映射

omp 内置思考级别：`minimal / low / medium / high / xhigh / max`。如果供应商对级别的叫法不同（例如 GLM 用 `none` 对应 `minimal`），在模型编辑的「级别映射」中填写；叫法一致时留空即可。

## 架构

```
┌─────────────────┐   HTTP    ┌──────────────────┐   读写   ┌──────────────────────┐
│  浏览器 (UI)     │ ────────▶ │ server.ts (bun)  │ ───────▶ │ ~/.omp/agent/        │
│  React + shadcn │ ◀──────── │  127.0.0.1:8642  │          │   models.yml         │
└─────────────────┘           └──────────────────┘          │   backups/           │
      web/dist（构建产物由 server 托管）                       └──────────────────────┘
```

- `server.ts`：bun 单文件后端，负责 API、YAML 序列化、模型拉取、流式测速、文件读写与备份
- `web/`：React 19 + Vite + Tailwind CSS v4 + shadcn/ui 前端
- `providers.json`：本地供应商数据（含 Key，权限 600，已 gitignore）

## 安全说明

- API Key 明文仅存于本机 `providers.json`（`chmod 600`），界面与 API 响应只返回掩码
- 服务仅绑定 `127.0.0.1`，外部网络无法访问
- 拉取模型列表在服务端完成，Key 不会出现在浏览器网络请求中

## Roadmap

- [ ] 打包桌面应用（Tauri）
- [ ] 供应商批量测速对比
- [ ] 多机配置同步（加密导出/导入）

## 致谢

- [CC Switch](https://github.com/farion1231/cc-switch) —— 供应商卡片、预设模板、备份轮换的设计参考
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) —— 类型驱动添加、模型拉取、流式健康检测的设计参考
- [shadcn/ui](https://ui.shadcn.com) —— 组件库
- [Oh My Pi](https://omp.sh) —— 本项目服务的对象

## License

[MIT](LICENSE)
