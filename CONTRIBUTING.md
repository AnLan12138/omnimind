# 贡献指南

感谢你对 OmniMind 的兴趣！欢迎任何形式的贡献。

## 🐛 Bug 报告

请通过 [GitHub Issues](https://github.com/AnLan12138/omnimind/issues) 提交 Bug 报告，包含：

- **操作系统**和版本（Win/Mac/Linux）
- **OmniMind 版本**（关于对话框可查看）
- **复现步骤**：做了哪些操作
- **预期行为** vs **实际行为**
- 如果有错误日志，请附上

## 💡 功能建议

也通过 Issues 提交，请说明：
- 场景：什么情况下需要这个功能
- 其他工具是否有类似功能（可作为参考）
- 你预期的交互方式

## 🔧 Pull Request

### 开发环境搭建

```bash
# 1. 克隆 fork 后的仓库
git clone https://github.com/YOUR_USERNAME/omnimind.git
cd omnimind/omniterm

# 2. 安装依赖
cd frontend && npm install && cd ..

# 3. 开发模式
wails dev

# 4. 确认构建成功
wails build
```

### 代码规范

- **Go**: 遵循标准 Go 风格（`gofmt`, `golint`）
- **TypeScript**: 遵循项目现有风格
- **提交信息**: 使用常规提交格式
  - `feat: 添加 SSH 代理转发`
  - `fix: 修复 Telnet echo 丢失`
  - `docs: 更新 README`
  - `refactor: 重构会话存储`

### PR 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/my-feature`
3. 提交代码：`git commit -m 'feat: my feature'`
4. 推送到远程：`git push origin feat/my-feature`
5. 创建 Pull Request 到 `main` 分支
6. 等待 Review

### 协议开发指南

如果要新增协议支持，请实现 `internal/protocol/interface.go` 中的 `ProtocolClient` 接口：

```go
type ProtocolClient interface {
    Connect() error
    Disconnect() error
    Send(data []byte) (int, error)
    Resize(rows, cols int) error
}
```

参考现有的 `ssh/client.go` 或 `telnet/client.go` 实现。

## 📄 协议

贡献代码即表示你同意将代码以 MIT 协议授权。
