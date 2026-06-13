<p align="center">
  <img src="omniterm/build/appicon.png" alt="OmniMind" width="128" height="128" />
</p>

<h1 align="center">OmniMind</h1>

<p align="center">
  <strong>多协议远程管理客户端 — MobaXterm 的开源替代品</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/AnLan12138/omnimind/releases"><img src="https://img.shields.io/github/v/release/AnLan12138/omnimind" alt="Release" /></a>
  <a href="#"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen" alt="Platform" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go" alt="Go" /></a>
  <a href="#"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React" /></a>
</p>

---

## 📖 这是什么？

**OmniMind** 是一款跨平台、多协议远程桌面与终端客户端，目标是在一个应用中整合所有常用远程协议，成为 MobaXterm 的最佳开源替代品。

> MobaXterm 协议最多但不稳定 · SecureCRT 最稳定但协议太少 · Tabby UI 最好看但功能薄弱  
> **OmniMind = 三者优点合一**

### ✨ 核心亮点

- **🌐 全协议覆盖** — SSH / Telnet / RDP / VNC / FTP / SFTP / MOSH / Serial 一个不少
- **🧠 AI 智能助手** — 内置 AI Agent，支持工具调用、思维链推理、RAG 知识库
- **🔐 安全可靠** — AES-256-GCM 加密存储密码，独立 goroutine 隔离各协议崩溃
- **🎨 现代 UI** — React + Tailwind CSS，标签页、分屏、广播模式，拖拽操作
- **⚡ 轻量高效** — Wails (Go + WebView) 框架，比 Electron 内存占用低 80%
- **🌍 跨平台** — Windows / macOS / Linux 全支持
- **💬 双语界面** — 中文 / 英文 完整 i18n

---

## 🖥️ 功能一览

| 模块 | 功能 |
|------|------|
| **SSH** | 密码/密钥/Agent 认证、ProxyJump 跳板、SSH 隧道、X11 转发 |
| **Telnet** | RFC 854 完整实现，支持终端协商、NAWS、Echo |
| **RDP** | 纯 Go RDP 客户端（基于 grdp），支持 NLA、TLS |
| **VNC** | 纯 Go RFB 协议实现，Canvas 渲染 |
| **FTP/SFTP** | 文件浏览器、拖拽上传下载、断点续传、传输队列 |
| **MOSH** | UDP 状态同步，移动网络下不中断 |
| **Serial** | 串口连接，波特率/数据位/校验位配置 |
| **会话管理** | SQLite 存储、AES-256-GCM 密码加密、文件夹分类 |
| **标签页** | 多标签、分屏、广播输入、拖拽排序 |
| **宏录制** | 命令录制回放 |
| **监控面板** | 连接状态、流量统计 |
| **导入** | 支持 MobaXterm、SSH Config 导入 |
| **自动更新** | GitHub Releases 检查更新 |
| **配置同步** | GitHub Gist 云同步 |
| **AI 助手** | Agent 循环、Chain-of-Thought、工具调用、RAG 知识库 |
| **设备识别** | 自动识别网络设备厂商/型号/OS |

---

## 📸 截图

<!-- TODO: 添加截图 -->
> 截图即将添加。欢迎提交 PR 贡献截图！

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/AnLan12138/omnimind/releases) 页面下载对应平台的安装包：

- **Windows**: `OmniMind_Setup.exe` (NSIS 安装包) 或 `OmniMind.exe` (便携版)
- **macOS**: `OmniMind.darwin-amd64.tar.gz` / `OmniMind.darwin-arm64.tar.gz`
- **Linux**: `OmniMind.linux-amd64.tar.gz` / `OmniMind.linux-arm64.tar.gz`

### 从源码构建

#### 环境要求

- [Go](https://go.dev/) 1.25+
- [Node.js](https://nodejs.org/) 18+
- [Wails](https://wails.io/) v2 (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

#### 构建步骤

```bash
# 1. 克隆仓库
git clone https://github.com/AnLan12138/omnimind.git
cd omnimind/omniterm

# 2. 安装前端依赖
cd frontend && npm install && cd ..

# 3. 开发模式（热重载）
wails dev

# 4. 生产构建
wails build                    # 当前平台
wails build --platform windows/amd64   # Windows
wails build --platform darwin/amd64    # macOS Intel
wails build --platform darwin/arm64    # macOS Apple Silicon
wails build --platform linux/amd64     # Linux

# 5. 构建 NSIS 安装包 (Windows)
wails build --nsis
```

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────┐
│           React Frontend             │
│  TypeScript · Tailwind · xterm.js    │
├──────────────────────────────────────┤
│        Wails Bridge (IPC)            │
├──────────────────────────────────────┤
│           Go Backend                 │
│  ┌──────────────────────────────┐    │
│  │  Protocol Layer              │    │
│  │  SSH │ Telnet │ RDP │ VNC   │    │
│  │  FTP │ SFTP   │ MOSH│ Serial│    │
│  ├──────────────────────────────┤    │
│  │  Session · Config · AI      │    │
│  │  SQLite · Sync · Update     │    │
│  └──────────────────────────────┘    │
├──────────────────────────────────────┤
│        WebView2 / WebKit             │
└──────────────────────────────────────┘
```

| 层级 | 技术 | 说明 |
|------|------|------|
| **桌面壳** | Wails v2 | Go + WebView，比 Electron 轻量 |
| **前端** | React 18 + TypeScript + Vite | 现代 Web UI |
| **样式** | Tailwind CSS 3 + Lucide Icons | 实用优先设计 |
| **终端** | xterm.js 5.5 + WebGL | GPU 加速渲染 |
| **状态** | Zustand | 轻量状态管理 |
| **后端** | Go 1.25 | 高性能、并发原生 |
| **存储** | SQLite (pure Go, no CGO) | 零依赖嵌入式数据库 |
| **加密** | AES-256-GCM + PBKDF2 | 密码安全存储 |

---

## 🤝 贡献

欢迎任何形式的贡献！提交 PR、Issue、或帮助完善文档。

请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献流程。

---

## 📄 开源协议

[MIT License](LICENSE) — 你可以自由使用、修改、分发，包括商业用途。

---

## ⭐ 致谢

- [Wails](https://wails.io/) — Go + Web 桌面框架
- [xterm.js](https://xtermjs.org/) — 终端模拟引擎
- [grdp](https://github.com/tomatome/grdp) — Go RDP 协议库
- 所有同类开源项目（Tabby、electerm、WindTerm）的启发

---

## 📊 项目状态

项目处于活跃开发阶段。欢迎 Star ⭐ 关注进展，也欢迎加入开发！

<p align="center">
  <a href="https://github.com/AnLan12138/omnimind">⭐ Star on GitHub</a>
  ·
  <a href="https://github.com/AnLan12138/omnimind/issues">🐛 Report Bug</a>
  ·
  <a href="https://github.com/AnLan12138/omnimind/issues">💡 Feature Request</a>
</p>
