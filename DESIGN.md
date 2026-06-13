# 多协议远程客户端 — 设计文档

> 代号: **OmniMind**  
> 定位: MobaXterm 的开源替代品，更稳定、交互更人性化  
> 目标: 一个应用整合 SSH / Telnet / RDP / VNC / FTP / SFTP / MOSH / X11 / Serial 所有常用远程协议

---

## 一、竞品深度分析

### 1.1 MobaXterm — 对标基准

| 维度 | MobaXterm | 评价 |
|------|-----------|------|
| **协议覆盖** | SSH, Telnet, RDP, VNC, FTP, SFTP, X11, Serial, MOSH, WSL | ⭐⭐⭐⭐⭐ 最全 |
| **稳定性** | 偶尔崩溃，大文件 SFTP 卡顿，长时间运行内存泄漏 | ⭐⭐⭐ |
| **UI** | 老式 Ribbon 风格，信息密度高但混乱 | ⭐⭐⭐ |
| **终端** | 基于 PuTTY 魔改，Unicode 支持一般 | ⭐⭐⭐ |
| **会话管理** | 侧边栏文件夹分类，密码可加密保存 | ⭐⭐⭐⭐ |
| **X11** | 内置 X Server，Windows 下开箱即用 | ⭐⭐⭐⭐⭐ |
| **SFTP** | SSH 连接后自动展示文件面板，拖拽上传 | ⭐⭐⭐⭐ |
| **价格** | 免费版限制 12 个会话 | ⭐⭐⭐ |
| **跨平台** | 仅 Windows | ⭐⭐ |

**MobaXterm 的核心痛点 (我们要解决):**
1. 长时间运行后内存占用 > 1GB，必须重启
2. SFTP 大文件 (> 2GB) 传输不稳定
3. 终端渲染引擎老旧，复杂 Unicode (emoji / CJK 扩展) 错位
4. 标签页多了 (> 20) 后切换卡顿
5. 仅支持 Windows
6. 宏/脚本功能薄弱

### 1.2 同类竞品对比

| 工具 | 平台 | 协议 | 终端 | 价格 | 优势 | 短板 |
|------|------|------|------|------|------|------|
| **MobaXterm** | Win | SSH/Telnet/RDP/VNC/FTP/X11/Serial/MOSH | PuTTY魔改 | 免费(受限)/$69 | 协议最全 + X Server | 仅Win，不稳定 |
| **WindTerm** | Win/Mac/Linux | SSH/Telnet/Serial | 自研 | 开源免费 | 极快，UI新 | RDP/VNC需外部工具 |
| **Tabby** | Win/Mac/Linux | SSH/Telnet/Serial | xterm.js | 开源免费 | 插件系统，UI美 | 内存大(Electron)，不支持RDP/VNC/X11 |
| **electerm** | Win/Mac/Linux | SSH/Telnet/Serial/SFTP | xterm.js | 开源免费 | 书签同步 | 同Tabby |
| **Termius** | Win/Mac/Linux/iOS | SSH/Telnet/MOSH/SFTP | 自研 | 免费(受限)/$10月 | MOSH支持，跨设备同步 | 不付费几乎不能用 |
| **Royal TSX** | Win/Mac | SSH/RDP/VNC/FTP | 插件 | $45 | RDP最好用 | 仅macOS，终端弱 |
| **Remmina** | Linux | SSH/RDP/VNC/SPICE | 自研 | 开源免费 | RDP/VNC最好 | 仅Linux |
| **mRemoteNG** | Win | SSH/RDP/VNC/Telnet | PuTTY组件 | 开源免费 | RDP多标签 | 年久失修 |
| **SecureCRT** | Win/Mac/Linux | SSH/Telnet/Serial | 自研 | $99 | 最稳定，脚本强 | 贵，不支持RDP/VNC/X11 |
| **Xshell** | Win | SSH/Telnet/Serial | 自研 | 免费(受限) | 亚洲最佳 | 仅Win，不支持RDP/VNC |

### 1.3 各协议领域最佳工具

| 协议 | 最佳工具 | 为什么好 | 我们可以复用的思路 |
|------|---------|---------|------------------|
| **SSH** | OpenSSH | 事实标准，ProxyJump | 直接调用 x/crypto/ssh |
| **Telnet** | SecureCRT | 终端协商最完整 | RFC 854 完整实现 |
| **RDP** | FreeRDP / mstsc | 性能最好，RemoteFX | 嵌入 FreeRDP 或 Guacamole |
| **VNC** | TigerVNC | 最兼容 | 纯 Go VNC 客户端 |
| **FTP/SFTP** | FileZilla | 最稳定 | 独立传输线程池 |
| **MOSH** | mosh | 唯一选择 | 实现 MOSH SSP 协议 |
| **X11** | X410 / VcXsrv | Windows 上最好 | 内嵌 Go X Server |
| **Serial** | minicom / picocom | 经典 | tarm/serial 库 |

### 1.4 我们的差异化定位

```
MobaXterm = 协议最全，但不稳定
SecureCRT = 最稳定，但协议少
Tabby     = UI 最好看，但功能弱

OmniMind = 协议量 ≈ MobaXterm × 稳定性 ≈ SecureCRT × UI ≈ Tabby
```

**三个核心差异化:**
1. **稳定**: 每个协议跑在独立 goroutine，崩溃不互相影响；连接池自动恢复
2. **交互**: 现代标签页 UI + 分屏 + 拖拽 + 快捷键，用完 MobaXterm 的人零学习成本
3. **全协议**: SSH / Telnet / RDP / VNC / FTP / SFTP / MOSH / X11 / Serial 一个不少

---

## 二、技术选型

### 2.1 整体架构

```
桌面应用
├── 前端 (React 18 + TypeScript)
│   ├── xterm.js — 终端渲染
│   ├── @xterm/addon-fit — 自适应大小
│   ├── @xterm/addon-webgl — GPU 加速渲染
│   ├── @xterm/addon-search — 终端搜索
│   ├── @xterm/addon-unicode11 — Unicode 11 支持
│   ├── react-rnd — 面板拖拽调整大小
│   ├── zustand — 轻量状态管理
│   ├── Tailwind CSS — UI 样式
│   └── noVNC / Guacamole.js — 嵌入 VNC/RDP 画面
│
├── Wails v3 Bridge — Go ↔ JS 双向调用
│
└── 后端 (Go 1.23+)
    ├── SSH 客户端     → golang.org/x/crypto/ssh
    ├── Telnet 客户端  → 标准库 net + RFC 854/855/857
    ├── RDP 客户端     → CGO 嵌入 FreeRDP 或 子进程调用
    ├── VNC 客户端     → 纯 Go RFC 6143 实现
    ├── FTP/FTPS 客户端 → jlaffaye/ftp
    ├── SFTP 客户端    → pkg/sftp
    ├── MOSH 客户端    → 纯 Go MOSH SSP 实现
    ├── X11 Server     → jezek/xgb + 自研转发
    ├── Serial         → tarm/serial
    └── 会话管理       → SQLite (加密) 存储配置 / 密码
```

### 2.2 为什么选 Wails (Go + Web 前端)？

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **Wails + Go + React** | Go 协议库丰富，xterm.js 终端渲染业界最佳，单二进制 | 体积 ~40MB (可接受) | ✅ 选这个 |
| **Electron + Node** | 生态最大 | 内存 > 200MB，冷启动 > 3s | ❌ 太重 |
| **Tauri + Rust** | 体积最小 ~5MB | Rust 协议库不够成熟，RDP/VNC/X11 几乎没有 | ❌ 协议开发量大 |
| **纯原生 Qt/GTK** | 性能最佳 | 终端组件要从零写，跨平台麻烦 | ❌ 开发成本太高 |
| **Flutter** | 跨平台最好 | Dart 网络协议库极其有限 | ❌ 无法实现 |

**Wails 的优势:**
- Go 做网络协议层，x/crypto/ssh 是 Go 写的，在 Go 生态里 SSH/RDP/VNC 都有库
- React + xterm.js 做 UI，xterm.js 被 VS Code 验证过，是世界上最成熟的终端渲染引擎
- 最终编译成一个 exe 分发

### 2.3 为什么不选 Electron？

MobaXterm 被诟病最多的就是**资源占用**。Electron 启动就是 200MB 内存。Wails 启动约 30-40MB。这是用户能感知的巨大差距。

### 2.4 Wails 版本选择

选择 **Wails v3** (alpha -> 正式版时跟进)。v3 相比 v2 的改进：
- 更好的多窗口支持 (RDP/VNC 可以弹出独立窗口)
- 更好的 system tray 支持 (后台常驻)
- 改进的编译速度

---

## 三、协议实现策略

### 3.1 SSH — 优先级最高

```
SSH 功能矩阵:
├── 密码认证
├── 公钥认证 (RSA / Ed25519 / ECDSA)
├── 键盘交互认证 (keyboard-interactive)
├── 2FA / TOTP
├── SSH Agent Forwarding
├── ProxyJump / ProxyCommand
├── SSH 隧道:
│   ├── 本地转发 (-L)
│   ├── 远程转发 (-R)
│   └── 动态转发 (-D SOCKS5)
├── SFTP 子协议
├── keepalive (ServerAliveInterval)
└── 自动重连
```

**底层**: `golang.org/x/crypto/ssh` — Go 官方维护，OpenSSH 兼容性最好

**稳定性策略:**
- 连接池: 每个 SSH 会话独立 goroutine，崩溃隔离
- 心跳: 每 30s 发送 `SSH_MSG_GLOBAL_REQUEST keepalive@openssh.com`
- 断线重连: 指数退避 1s → 2s → 4s → 8s → 16s → 30s → 60s (最大)
- 大文件 SFTP 分块传输: 默认 32MB/chunk，3 并发

### 3.2 Telnet

```
Telnet 功能矩阵:
├── RFC 854 — 基础 Telnet 协议
├── RFC 855 — 选项协商
├── RFC 857 — Echo
├── RFC 858 — Suppress Go Ahead
├── RFC 1091 — Terminal Type (xterm / vt100 / vt220 / ansi)
├── RFC 1073 — NAWS (窗口大小协商)
├── RFC 1572 — NEW-ENVIRON
├── SSL/TLS 包装 (Telnets)
└── 自动检测: 连接后自动完成选项协商
```

**底层**: Go 标准库 `net` + 自实现 Telnet 协商机

**特点**: 
- 连接时自动显示协商过程（调试友好）
- 自动适配窗口大小变化
- 支持 IBM 3270 / TN3270 (大型机场景)

### 3.3 RDP — 最复杂的协议

```
RDP 功能矩阵:
├── RDP 5/6/7/8/10 协议版本
├── TLS / CredSSP (NLA) 认证
├── 键盘布局映射
├── 剪贴板共享 (双向)
├── 磁盘映射 / 驱动器重定向
├── 音频重定向 (可选)
├── 分辨率自适应
├── 多显示器支持
├── RemoteApp (独立窗口模式)
└── RD Gateway (HTTPS 隧道)
```

**实现方案 (三选一):**

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| A | Go 纯实现 RDP | 无外部依赖 | 开发量巨大，RDP 协议 1000+ 页规范 |
| B | CGO 绑定 FreeRDP | 最稳定，FreeRDP 成熟 | CGO 交叉编译困难 |
| C | 子进程调用 FreeRDP | 隔离性好 | 进程管理复杂 |

**推荐方案 B + C 组合:**
- 主路径: CGO 绑定 `libfreerdp2`，Go 通过 CGO 调用
- 备选路径: 如果 CGO 编译失败，fallback 到子进程 `xfreerdp` + embedding
- Windows: 同时提供 "调用系统 mstsc.exe" 的快捷方式

**前端渲染:**
- RDP 画面通过 Canvas 渲染
- 或者用 FreeRDP 的 `/gfx` 模式输出到 shared memory → 映射到前端的 OffscreenCanvas
- FreeRDP 也支持 EGL 渲染，可以通过 WebGL 显示

### 3.4 VNC

```
VNC 功能矩阵:
├── RFB 3.3 / 3.7 / 3.8 协议
├── Tight / ZRLE / Hextile / Raw 编码
├── TLS / VeNCrypt 认证
├── 剪贴板共享
├── 分辨率自适应
├── 只读模式
└── UltraVNC / TightVNC / TigerVNC 兼容
```

**实现方案:**

| 方案 | 优点 | 缺点 |
|------|------|------|
| A | Go 纯实现 RFB | 轻量，无外部依赖 | 开发量中等 |
| B | 嵌入 noVNC (HTML5) | 成熟稳定 | 需要 WebSocket 代理 |

**推荐: 方案 A (Go 纯实现) + 方案 B (备用)**

Go 实现 RFB 协议并不复杂 (RFC 6143 约 40 页)，有几个开源 Go VNC 库可以参考:
- `amitbet/vnc2video` (Go VNC viewer)
- `kward/go-vnc` (Go VNC client)

前端通过 Canvas 渲染 VNC 帧，Go 后端负责协议解析，帧解码后用 Base64/ArrayBuffer 传给前端。

### 3.5 FTP / FTPS / SFTP

```
FTP 功能矩阵:
├── FTP (RFC 959) — 主动/被动模式
├── FTPS (RFC 4217) — 显式/隐式 TLS
├── SFTP — SSH File Transfer Protocol
├── 文件面板:
│   ├── 双面板 (本地 | 远程)
│   ├── 拖拽上传/下载
│   ├── 多选 / 批量操作
│   ├── 文件权限修改 (chmod)
│   ├── 文件预览 (文本/图片)
│   └── 文件搜索
├── 断点续传
├── 多线程传输 (SFTP 单连接多流)
└── 传输队列 (暂停/取消/重试/P2P优先级)
```

**底层:**
- FTP: `jlaffaye/ftp` (Go)
- SFTP: `pkg/sftp` (Go，基于 x/crypto/ssh)

**自定义文件传输协议优化:**
- 大文件 (> 100MB) 自动分片，每个 chunk 独立校验 SHA-256
- 带宽限制可配置
- 传输进度持久化，关闭应用也不丢进度

### 3.6 MOSH

```
MOSH 功能矩阵:
├── MOSH SSP (State Synchronization Protocol)
├── UDP 传输
├── 预测性回显 (Predictive Echo)
├── 漫游 (IP 变化不掉线)
├── 高延迟网络优化 (500ms+ RTT 可用)
└── AES-128 OCB 加密
```

**底层**: 纯 Go 实现 MOSH SSP 协议

MOSH 协议分为两层:
1. **MOSH Session** — UDP 上的加密会话，AES-OCB
2. **SSP** — 状态同步协议，只传 diff

Go 实现思路:
- 参考 `mobile-shell/mosh` 的 C++ 源码
- SSP 协议核心是一个 object-based 的 diff 传输
- 预测性回显: 客户端本地 echo 用户输入，服务端返回的 state 如果不一致再做修正

### 3.7 X11 Forwarding

```
X11 功能矩阵:
├── SSH X11 Forwarding (ssh -X)
├── 内置 X Server (Windows / macOS)
├── 窗口管理模式:
│   ├── 多窗口模式 (每个 X 应用独立窗口)
│   └── 单窗口模式 (Rootless，X 应用嵌入标签页)
├── X11 扩展支持: RENDER, SHAPE, XFIXES, DAMAGE
├── 剪贴板双向同步
└── X11 显示号自动管理
```

**这是最难的部分。** MobaXterm 为什么强？就是因为它内置 X Server。

**实现方案:**

| 平台 | 方案 | 说明 |
|------|------|------|
| **Linux** | 直接使用系统 X11 / Wayland | 不需要内置 X Server |
| **macOS** | 推荐 XQuartz，或内置 X Server | 默认调用 XQuartz |
| **Windows** | 内置 Go X Server 或嵌入 VcXsrv | 需要安装 X Server |

**内置 X Server 方案 (Windows):**

思路: 用 Go 实现一个 **最小可用的 X Server**，基于 X11 协议。

- Go 库: `jezek/xgb` (X Go Binding) — 完整的 X11 协议实现
- 只需实现 X11 Server 端协议，接受 X11 client 连接
- 渲染: X11 绘图指令 → 前端的 Canvas / WebGL
- ICCCM / EWMH: 窗口管理器协议
- 初期只支持最常用的 30 个 X11 请求

**简化路径 (推荐 MVP 阶段):**
- Windows 上: 自动检测是否安装 VcXsrv/X410，提示安装
- macOS 上: 自动检测 XQuartz
- 内置 X Server 作为 P3 目标

### 3.8 Serial

```
Serial 功能矩阵:
├── RS-232 串口通信
├── 波特率: 110 ~ 921600
├── 数据位: 5/6/7/8
├── 停止位: 1/1.5/2
├── 校验: None/Even/Odd/Mark/Space
├── 流控: None/RTS-CTS/XON-XOFF
├── 自动检测可用串口
└── 保存串口配置
```

**底层**: `tarm/serial` — Go 最流行的串口库

---

## 四、UI 设计 (交互模型)

### 4.1 整体布局

```
┌──────────────────────────────────────────────────────────┐
│  Quick Connect Bar  [protocol▼] [host] [port] [Connect] │
├──────────┬────────────────────────────────┬──────────────┤
│          │  Tab Bar                        │              │
│ Session  │  ┌─SSH:web01 ─┬─RDP:dc01 ─┐   │              │
│ Manager  │  └──────────────────────────┘   │              │
│          │                                  │              │
│ ┌──────┐ │  ┌──────────────────────────┐   │   Monitor    │
│ │ SSH   │ │  │                          │   │   Panel      │
│ │ • web01│ │  │   Terminal /            │   │              │
│ │ • db01 │ │  │   RDP Canvas /          │   │  CPU: ▂▃▄▅  │
│ │ • jump │ │  │   VNC Canvas            │   │  NET: ▁▂▃▄  │
│ │        │ │  │                          │   │              │
│ │ Telnet │ │  │                          │   │              │
│ │ • router│ │  │                          │   │              │
│ │        │ │  │                          │   │              │
│ │ RDP    │ │  └──────────────────────────┘   │              │
│ │ • dc01 │ │                                  │              │
│ │ • ts01 │ │  ┌──────────────────────────┐   │              │
│ │        │ │  │  SFTP / File Panel       │   │              │
│ │ VNC    │ │  │  [local/]  │  [remote/]  │   │              │
│ │ • kvm  │ │  │  file1.txt │  app.log    │   │              │
│ └──────┘ │  └──────────────────────────┘   │              │
├──────────┴────────────────────────────────┴──────────────┤
│  Status Bar:  [SSH:web01 connected] [SFTP idle] [Uptime 2h]│
└──────────────────────────────────────────────────────────┘
```

### 4.2 核心交互模式

**1. Quick Connect (必须快):**
```
输入框支持:
- 直接输入 host → 默认 SSH:22
- user@host → SSH:22
- user@host:2222 → SSH:2222
- telnet://host:23 → Telnet
- rdp://host → RDP
- vnc://host → VNC
- 自动解析协议 + 主机 + 端口
```

**2. 会话管理器 (侧边栏):**
```
- 文件夹分组 (生产/测试/开发/客户)
- 拖拽排序
- 右键菜单 (连接/编辑/删除/克隆/导出)
- 搜索/过滤
- 导入/导出 (JSON / MobaXterm 兼容格式)
- 密码加密存储 (AES-256-GCM + 主密码)
```

**3. 标签页系统:**
```
- 双击标签栏空白 → 新连接
- Ctrl+T → 新标签
- Ctrl+W → 关闭标签
- Ctrl+Tab / Ctrl+Shift+Tab → 切换标签
- 拖拽标签重新排序
- 拖拽标签出窗口 → 独立窗口
- 右键标签 → 克隆 / 重命名 / 颜色标记
- 意外关闭提示: "有活动的会话，确认关闭？"
```

**4. 分屏:**
```
- Ctrl+Shift+O → 水平分屏 (上下)
- Ctrl+Shift+E → 垂直分屏 (左右)
- 每个 panel 可以有不同协议
- 面板间拖拽调整大小
- Ctrl+Shift+W → 关闭当前 panel
```

**5. 宏/自动化:**
```
- 录制宏: 记录键盘输入
- 宏库: 保存常用命令序列
- 右键 "执行宏"
- 自动响应: 匹配终端输出 → 自动发送命令
```

### 4.3 人性化细节 (从 MobaXterm 偷师)

```
✅ 连接成功后自动切换到终端面板
✅ SSH 连接后自动显示 SFTP 面板 (可关闭)
✅ 复制选中即复制 (不用 Ctrl+C，避免杀进程)
✅ 右键粘贴
✅ 网络断开时终端变灰 + 显示 "Reconnecting..."
✅ 重新连接成功后提示 "Session restored"
✅ 标签上显示连接时长
✅ 连接失败显示详细错误 (不是 Connection refused 就完事)
✅ Ctrl+鼠标滚轮 缩放字体
✅ 双击选中单词，三击选中整行
✅ "Keep Alive" 自动发送空包防超时断开
✅ 断开时终端内容保持可查看/可复制
✅ 书签功能: 保存命令片段到会话
```

---

## 五、架构设计

### 5.1 分层架构

```
┌──────────────────────────────────────────────────┐
│                   UI Layer                        │
│  React + xterm.js + Canvas + Tailwind            │
│  标签管理 / 面板分割 / 主题 / 快捷键              │
├──────────────────────────────────────────────────┤
│               Wails IPC Bridge                    │
│  Go ↔ JS 方法绑定 / 事件推送                     │
├──────────────────────────────────────────────────┤
│              Connection Manager                   │
│  连接生命周期 / 心跳检测 / 自动重连 / 连接池      │
├──────────────────────────────────────────────────┤
│              Protocol Adapters                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │ SSH  │ │RDP   │ │VNC   │ │Telnet│ │FTP   │  │
│  │Client│ │Client│ │Client│ │Client│ │Client│  │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │
│  ┌──────┐ ┌──────┐ ┌──────┐                     │
│  │MOSH  │ │X11   │ │Serial│                     │
│  │Client│ │Server│ │Client│                     │
│  └──────┘ └──────┘ └──────┘                     │
│  统一接口: Connect() / Disconnect() / Send()      │
│  统一事件: OnData / OnError / OnStateChange       │
├──────────────────────────────────────────────────┤
│              Session Manager                      │
│  SQLite 存储 / 密码加密 / 导入导出 / 云同步接口   │
├──────────────────────────────────────────────────┤
│              System Layer                         │
│  文件系统 / 网络 / 进程管理 / 日志 / 更新         │
└──────────────────────────────────────────────────┘
```

### 5.2 统一协议接口

```go
// 所有协议客户端实现此接口
type ProtocolClient interface {
    // 生命周期
    Connect(ctx context.Context) error
    Disconnect() error
    Reconnect() error
    
    // 数据通道
    Send(data []byte) error
    Resize(rows, cols int) error
    
    // 状态
    State() ConnectionState  // Connected / Connecting / Disconnected / Reconnecting
    Info() ConnectionInfo    // 协议类型 / 主机 / 端口 / 版本
    
    // 特性
    Features() ProtocolFeatures  // 是否支持 SFTP / 分屏 / 录制 等
}

type ProtocolFeatures struct {
    SupportsSFTP      bool
    SupportsClipboard bool
    SupportsResize    bool
    SupportsRecording bool
    SupportsMacros    bool
    TerminalType      string  // "pty" / "canvas" / "none"
}
```

### 5.3 前后端通信模型

```
前端 (React)                    后端 (Go)
    │                               │
    │──── Connect("ssh://host") ──→│  // JS 调用 Go
    │                               │ 创建 SSH Client
    │                               │ 开始连接
    │                               │
    │←── OnStateChange(Connecting)──│  // Go 推送事件到 JS
    │←── OnStateChange(Connected)───│
    │                               │
    │──── SendKey("ls -la\r") ─────→│  // 用户输入
    │                               │ ssh channel.Write()
    │                               │
    │←── OnData(output bytes) ──────│  // 终端输出
    │ xterm.write(output)           │
    │                               │
    │── Resize(120, 40) ──────────→│  // 窗口大小变化
    │                               │ ssh channel.SendRequest("window-change")
    │                               │
    │  ~~~ 网络断开 ~~~             │
    │                               │ 自动重连 (goroutine)
    │←── OnStateChange(Reconnecting)│
    │←── OnStateChange(Connected)───│
```

### 5.4 稳定性保障机制

```
1. 协议隔离
   - 每个连接独立 goroutine
   - pty 读写独立 goroutine
   - panic → recover → 只影响当前连接

2. 断线重连
   - 检测: TCP keepalive + 应用层心跳
   - 策略: 指数退避 + 最大重试 30 次
   - 恢复: SSH → 重新认证 + SFTP 恢复；MOSH → 天然支持
   - 状态: 终端内容保留，重新连接后追补

3. 资源管理
   - 每个连接限制 256MB 内存缓冲区
   - 滚动缓冲: 可配置 (1000 ~ 50000 行)
   - 空闲连接: 60min 无活动 → 提示是否断开

4. 崩溃恢复
   - 上次打开的所有会话自动恢复
   - 未保存的终端内容写入临时文件
   - Go 侧的 recover 防止整个应用崩溃

5. 传输可靠性
   - SFTP: 每个文件块 SHA-256 校验
   - 大文件: 分片传输 + 断点续传
   - 所有传输操作记录到 SQLite，重启后可续传
```

---

## 六、目录结构

```
omnimind/
├── cmd/
│   └── omnimind/
│       └── main.go                # Wails 应用入口
├── internal/
│   ├── app/
│   │   └── app.go                 # Wails 应用实例，绑定所有 API
│   ├── protocol/
│   │   ├── interface.go           # ProtocolClient 统一接口
│   │   ├── ssh/
│   │   │   ├── client.go          # SSH 客户端
│   │   │   ├── sftp.go            # SFTP 子协议
│   │   │   ├── tunnel.go          # SSH 隧道 (L/R/D)
│   │   │   └── x11.go             # SSH X11 Forwarding
│   │   ├── telnet/
│   │   │   ├── client.go          # Telnet 客户端
│   │   │   ├── negotiate.go       # 选项协商
│   │   │   └── options.go         # 选项定义
│   │   ├── rdp/
│   │   │   ├── client.go          # RDP 客户端 (CGO 绑定 FreeRDP)
│   │   │   └── freerdp.go         # FreeRDP 的 Go 绑定
│   │   ├── vnc/
│   │   │   ├── client.go          # VNC RFB 客户端
│   │   │   ├── encoding.go        # 编码/解码
│   │   │   └── security.go        # 安全类型
│   │   ├── ftp/
│   │   │   ├── client.go          # FTP 客户端
│   │   │   └── ftps.go            # FTPS (TLS)
│   │   ├── mosh/
│   │   │   ├── client.go          # MOSH 客户端
│   │   │   ├── ssp.go             # State Sync Protocol
│   │   │   └── crypto.go          # MOSH AES-OCB
│   │   ├── serial/
│   │   │   └── client.go          # 串口客户端
│   │   └── x11/
│   │       ├── server.go          # X11 Server (Windows 内置)
│   │       ├── display.go         # 显示管理
│   │       ├── wm.go              # 窗口管理器
│   │       ├── render.go          # 渲染
│   │       └── clipboard.go       # 剪贴板同步
│   ├── session/
│   │   ├── manager.go             # 会话管理器
│   │   ├── session.go             # 单个会话定义
│   │   ├── store.go               # SQLite 持久化
│   │   ├── encrypt.go             # 密码加密
│   │   └── import.go              # 导入 (MobaXterm / SecureCRT)
│   ├── connection/
│   │   ├── pool.go                # 连接池
│   │   ├── reconnect.go           # 自动重连逻辑
│   │   ├── heartbeat.go           # 心跳检测
│   │   └── monitor.go             # 连接监控 (延迟/带宽)
│   ├── filetransfer/
│   │   ├── manager.go             # 传输管理器
│   │   ├── chunk.go               # 分片传输
│   │   ├── resume.go              # 断点续传
│   │   └── queue.go               # 传输队列
│   ├── macro/
│   │   ├── recorder.go            # 宏录制
│   │   ├── player.go              # 宏回放
│   │   └── library.go             # 宏库
│   ├── config/
│   │   ├── config.go              # 全局配置
│   │   ├── theme.go               # 主题配置
│   │   └── keymap.go              # 快捷键配置
│   └── util/
│       ├── net.go                 # 网络工具
│       ├── crypto.go              # 加密工具
│       └── platform.go            # 平台检测
├── frontend/
│   ├── src/
│   │   ├── main.tsx               # React 入口
│   │   ├── App.tsx                # 应用根组件
│   │   ├── components/
│   │   │   ├── QuickConnect.tsx    # 快速连接栏
│   │   │   ├── SessionSidebar.tsx  # 会话侧边栏
│   │   │   ├── TabBar.tsx          # 标签栏
│   │   │   ├── TabContainer.tsx    # 标签容器
│   │   │   ├── Terminal.tsx        # 终端面板 (xterm.js)
│   │   │   ├── CanvasViewer.tsx    # RDP/VNC 画面 (Canvas)
│   │   │   ├── FilePanel.tsx       # SFTP/FTP 文件面板
│   │   │   ├── StatusBar.tsx       # 状态栏
│   │   │   ├── MonitorPanel.tsx    # 监控面板
│   │   │   └── SettingsDialog.tsx  # 设置对话框
│   │   ├── stores/
│   │   │   ├── sessionStore.ts     # 会话状态
│   │   │   ├── tabStore.ts         # 标签状态
│   │   │   ├── connectionStore.ts  # 连接状态
│   │   │   └── configStore.ts      # 配置状态
│   │   ├── hooks/
│   │   │   ├── useTerminal.ts      # 终端 hook
│   │   │   ├── useConnection.ts    # 连接 hook
│   │   │   └── useFilePanel.ts     # 文件面板 hook
│   │   ├── lib/
│   │   │   ├── wails.ts            # Wails Go 方法绑定
│   │   │   ├── protocol.ts         # 协议解析工具
│   │   │   └── theme.ts            # 主题工具
│   │   └── styles/
│   │       ├── globals.css         # 全局样式
│   │       └── themes/             # 主题文件
│   │           ├── dark.css
│   │           ├── light.css
│   │           └── monokai.css
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── wails.json                      # Wails 配置
├── go.mod
├── go.sum
├── Makefile
├── scripts/
│   ├── build.sh                    # 构建脚本
│   ├── build.ps1                   # Windows 构建
│   └── sign.sh                     # 代码签名
└── README.md
```

---

## 七、分阶段实现路线图

### Phase 1 — 核心终端 MVP (3-4 周)

**目标: SSH + Telnet + Serial 稳定可用，标签页 UI**

```
✅ 项目脚手架 (Wails + React + xterm.js)
✅ 标签页系统 (创建/关闭/切换/拖拽排序)
✅ SSH 客户端 (密码 + 公钥认证)
✅ Telnet 客户端 (完整选项协商)
✅ Serial 客户端
✅ SFTP 文件面板 (双面板 + 上传/下载)
✅ 会话管理器 (SQLite 存储 + 文件夹分组)
✅ 快速连接栏 (protocol://host:port 解析)
✅ 终端完整支持 (Unicode / 颜色 / 鼠标 / 搜索)
✅ 基础设置页面 (字体 / 配色 / 快捷键)
```

**验证方式**: 日常 SSH 工作完全替代 MobaXterm

### Phase 2 — 稳定性和高级终端 (2-3 周)

**目标: 不丢连接，不断会话**

```
✅ 断线自动重连 + 指数退避
✅ SSH 隧道 (本地/远程/动态)
✅ SSH Agent Forwarding
✅ SSH ProxyJump
✅ keepalive 心跳
✅ 分屏 (水平/垂直)
✅ 宏录制/回放
✅ 命令片段库
✅ 终端录制 (asciicast)
✅ 连接状态监控面板 (延迟/带宽/在线时长)
✅ MobaXterm 会话导入
```

**验证方式**: 网络波动不掉线，标签页多 (>30) 不卡顿

### Phase 3 — 远程桌面协议 (3-4 周)

**目标: RDP + VNC 嵌入到标签页**

```
✅ VNC 客户端 (纯 Go RFB 实现)
✅ RDP 客户端 (FreeRDP CGO 绑定)
✅ Canvas 渲染 RDP/VNC 画面
✅ RDP/VNC 标签页内全屏模式
✅ RDP/VNC 独立窗口模式
✅ 剪贴板双向同步
✅ 分辨率自适应 / 缩放
✅ RDP 驱动器映射
```

**验证方式**: 一个窗口管理所有 RDP/VNC 连接，不需要再开 mstsc

### Phase 4 — 特色协议 (2-3 周)

**目标: MOSH + X11 + FTP**

```
✅ MOSH 客户端 (SSP + UDP)
✅ FTP/FTPS 客户端
✅ X11 Forwarding (SSH -X)
✅ X11 Server (Windows 内置) — 最小可用版
✅ 文件断点续传
✅ 传输队列管理
```

**验证方式**: 完整替代 MobaXterm 付费版的所有功能

### Phase 5 — 打磨发布 (2-3 周)

**目标: 1.0 发布质量**

```
✅ 多语言 (中文 / 英文)
✅ 主题系统 (10+ 预设主题)
✅ 自动更新
✅ 性能优化 (虚拟滚动 / Canvas WebGL)
✅ 安全审计 (密码存储 / TLS 配置)
✅ 安装包 (MSI / DMG / AppImage)
✅ 官网 + 文档
```

**验证方式**: 公开 Beta 测试，收集反馈，修 bug

---

## 八、关键技术风险与对策

### 8.1 RDP 集成 — 最高风险

| 风险 | 影响 | 对策 |
|------|------|------|
| CGO 编译 FreeRDP 在 Windows 上极其困难 | RDP 功能无法使用 | 备选: 调用系统 mstsc.exe；Linux 调用 xfreerdp |
| FreeRDP 与 Wails 整合复杂 | 开发周期翻倍 | P3 阶段给足时间，初期只做 SSH/VNC |
| RDP 性能差 (Canvas 渲染) | 用户不接受 | 使用 FreeRDP 的 EGL/OpenGL 输出，映射到 WebGL |

### 8.2 X11 Server — 第二高风险

| 风险 | 影响 | 对策 |
|------|------|------|
| 完整 X Server 开发量巨大 | MVP 不可用 | MVP 阶段提示安装 VcXsrv / XQuartz |
| X11 协议 30+ 年历史，极端情况多 | 兼容性差 | 优先支持 Linux 原生 X11，Windows 用外部 X Server |

### 8.3 跨平台 GUI 一致性

| 风险 | 影响 | 对策 |
|------|------|------|
| Win/Mac/Linux UI 体验不一致 | 用户差评 | Wails 的 WebView 在各平台表现一致 |
| 文件选择器/系统菜单等需要原生 | 体验割裂 | Wails v3 提供原生 dialog API |

---

## 九、配置存储设计

### 9.1 SQLite 表结构

```sql
-- 会话
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL,  -- ssh/telnet/rdp/vnc/ftp/mosh/serial
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    -- 认证方式
    auth_method TEXT,         -- password/keyboard-interactive/publickey
    -- SSH 特有
    ssh_private_key_path TEXT,
    ssh_use_agent INTEGER DEFAULT 0,
    ssh_proxy_jump TEXT,
    -- RDP 特有
    rdp_resolution TEXT,
    rdp_drive_redirection INTEGER DEFAULT 0,
    -- Serial 特有
    serial_baud_rate INTEGER,
    serial_data_bits INTEGER,
    serial_stop_bits REAL,
    serial_parity TEXT,
    serial_flow_control TEXT,
    -- 通用
    keepalive_interval INTEGER DEFAULT 30,
    reconnect_retries INTEGER DEFAULT 10,
    terminal_type TEXT DEFAULT 'xterm-256color',
    font_size INTEGER DEFAULT 14,
    color_scheme TEXT DEFAULT 'dark',
    folder_id TEXT,
    sort_order INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id)
);

-- 文件夹
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER DEFAULT 0
);

-- 加密存储的密码
CREATE TABLE credentials (
    session_id TEXT PRIMARY KEY,
    encrypted_password BLOB NOT NULL,
    encryption_iv BLOB NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 宏
CREATE TABLE macros (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    commands TEXT NOT NULL,
    session_id TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### 9.2 密码加密方案

```
明文密码
  → PBKDF2(password=主密码, salt=random, iterations=600000)
  → AES-256-GCM(key=derived_key, plaintext=密码)
  → 存储 { ciphertext, iv, salt }

主密码:
  - 首次启动时设置
  - 启动时输入一次，存在内存中
  - 应用关闭后从内存清除
```

---

## 十、命名与品牌

| 候选名称 | 含义 | 评价 |
|---------|------|------|
| **OmniMind** | Omni(全) + Mind(思维) | 直接、好记 |
| **PolyTerm** | Poly(多) + Term | 强调多协议 |
| **UniTerm** | Uni(统一) + Term | 统一终端 |
| **MegaTerm** | Mega(巨大) + Term | 强调功能全 |

**推荐: OmniMind** — 简短、英文无歧义、Google 搜索无冲突。

---

## 十一、总结

### 我们到底在做什么？

一个 **Wails (Go + React + xterm.js)** 桌面应用，把 SSH / Telnet / RDP / VNC / FTP / SFTP / MOSH / X11 / Serial 九种远程协议整合到一个统一的、稳定的、交互友好的界面里。

### 为什么能做成功？

| 要素 | 情况 |
|------|------|
| Go 协议生态 | SSH/SFTP/Serial 完美，VNC/FTP/Telnet/MOSH 可实现，RDP 有 FreeRDP |
| xterm.js 成熟度 | VS Code/GitHub Codespaces 验证，终端渲染不是瓶颈 |
| Wails 框架 | 比 Electron 轻 5x，编译成原生应用 |
| 竞品弱点 | MobaXterm 不稳定，Tabby 不支��RDP，SecureCRT 不支持VNC/X11 |

### 最大的挑战？

**RDP 和 X11** 是两块硬骨头。策略是先在 Phase 1-2 把 SSH/Telnet/Serial 做到业界最好，再逐步攻克 RDP/X11。

---

> **下一阶段**: Phase 1 详细实施计划 + 代码脚手架搭建
