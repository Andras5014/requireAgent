import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';

import config from './config';
import { initDatabase } from './database';
import { setupWebSocket } from './websocket';

// 路由
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import invitationRoutes from './routes/invitation.routes';
import messageRoutes from './routes/message.routes';
import documentRoutes from './routes/document.routes';
import agentRoutes from './routes/agent.routes';

const app = express();
const server = createServer(app);

// 中间件
app.use(cors(config.cors));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（用于生产环境）
if (config.nodeEnv === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
}

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', invitationRoutes);
app.use('/api/projects', messageRoutes);
app.use('/api/projects', documentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/agents', agentRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// 404 处理
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API 端点不存在',
  });
});

// 生产环境下，所有其他请求返回前端页面
if (config.nodeEnv === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// 错误处理
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: config.nodeEnv === 'development' ? err.message : '服务器内部错误',
  });
});

// 初始化并启动服务器
async function start() {
  // 初始化数据库
  await initDatabase();

  // 设置 WebSocket
  setupWebSocket(server);

  // 启动服务器
  server.listen(config.port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 RequireAgent 服务器已启动                              ║
║                                                           ║
║   地址: http://localhost:${config.port}                        ║
║   环境: ${config.nodeEnv}                                     ║
║   数据库: ${config.dbPath}
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
