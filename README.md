# RequireAgent

AI 驱动的需求协作平台 - 让团队协作提需求，AI Agent 帮你汇总生成专业文档。

## 功能特性

- 🚀 **实时协作聊天** - 多人实时讨论需求，WebSocket 支持
- 🤖 **AI Agent 参与** - 智能分析需求，主动追问，发现冲突
- 📝 **自动文档生成** - PRD、技术设计、API 文档等一键生成
- 🏷️ **需求分类标签** - 功能/技术/UI/运营等多维度分类
- 👍 **优先级投票** - 团队投票确定需求优先级
- 🔍 **智能内容过滤** - 自动过滤跑题闲聊和无效信息
- 📤 **文档导出** - 支持 Markdown 和 PDF 格式导出
- 🔐 **项目权限管理** - 公开/私密项目，邀请链接加入

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | Node.js + Express + TypeScript |
| 实时通信 | WebSocket (ws) |
| 数据库 | SQLite + better-sqlite3 |
| LLM | OpenAI / Claude / DeepSeek / 本地模型 |
| 部署 | Docker + docker-compose |

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker (可选，用于部署)

### 开发模式

1. **克隆项目**

```bash
git clone <repository-url>
cd requireagent
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

```bash
cp server/env.example server/.env
# 编辑 .env 文件，配置 LLM API Key 等
```

4. **启动开发服务器**

```bash
npm run dev
```

前端: http://localhost:5173
后端: http://localhost:3000

### Docker 部署

1. **配置环境变量**

```bash
# 创建 .env 文件
cat > .env << EOF
JWT_SECRET=your-super-secret-key-change-me
OPENAI_API_KEY=your-openai-api-key
# 或使用其他 LLM
# DEEPSEEK_API_KEY=your-deepseek-key
# DEFAULT_LLM_PROVIDER=deepseek
EOF
```

2. **构建并启动**

```bash
docker-compose up -d --build
```

3. **访问应用**

打开 http://localhost:3000

## 项目结构

```
requireagent/
├── client/                 # React 前端
│   ├── src/
│   │   ├── components/     # 通用组件
│   │   ├── pages/          # 页面组件
│   │   ├── services/       # API 和 WebSocket 服务
│   │   ├── stores/         # Zustand 状态管理
│   │   └── styles/         # CSS 样式
│   └── ...
├── server/                 # Node.js 后端
│   ├── src/
│   │   ├── config/         # 配置
│   │   ├── database/       # 数据库初始化
│   │   ├── middleware/     # Express 中间件
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务服务
│   │   └── websocket/      # WebSocket 服务
│   └── ...
├── shared/                 # 共享类型定义
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## API 概览

### 认证

- `POST /api/auth/send-code` - 发送验证码
- `POST /api/auth/verify` - 验证码登录
- `GET /api/auth/me` - 获取当前用户

### 项目

- `GET /api/projects` - 项目列表
- `POST /api/projects` - 创建项目
- `GET /api/projects/:id` - 项目详情
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目

### 消息

- `GET /api/projects/:id/messages` - 消息列表
- `POST /api/projects/:id/messages` - 发送消息
- `POST /api/projects/:id/messages/:msgId/vote` - 投票

### 文档

- `GET /api/projects/:id/documents` - 文档列表
- `POST /api/projects/:id/documents/generate` - 生成文档
- `POST /api/projects/:id/documents/:docId/export` - 导出文档

### WebSocket

连接: `ws://localhost:3000/ws?token=<jwt_token>`

事件类型:
- `join_room` - 加入项目房间
- `leave_room` - 离开房间
- `send_message` - 发送消息
- `message_received` - 收到消息
- `agent_response` - Agent 回复
- `typing` / `stop_typing` - 输入状态

## LLM 配置

支持多种 LLM 提供商:

### OpenAI

```env
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o
DEFAULT_LLM_PROVIDER=openai
```

### Claude

```env
CLAUDE_API_KEY=sk-ant-xxx
CLAUDE_MODEL=claude-3-sonnet-20240229
DEFAULT_LLM_PROVIDER=claude
```

### DeepSeek

```env
DEEPSEEK_API_KEY=xxx
DEEPSEEK_MODEL=deepseek-chat
DEFAULT_LLM_PROVIDER=deepseek
```

### 本地模型 (Ollama)

```env
LOCAL_LLM_BASE_URL=http://localhost:11434
LOCAL_LLM_MODEL=llama2
DEFAULT_LLM_PROVIDER=local
```

## 内容过滤

文档生成时会自动过滤:

1. **跑题闲聊** - 与项目需求无关的日常对话
2. **无效信息** - "好的"、"收到"、"+1"、纯表情等

可在项目设置中调整:
- 开关过滤类型
- 设置过滤严格程度 (低/中/高)
- 添加自定义过滤关键词

## 贡献

欢迎提交 Issue 和 Pull Request！

## License

MIT
