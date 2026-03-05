import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import db from '../database';
import config from '../config';
import { chat } from '../services/llm.service';
import { 
  shouldTriggerMultiAgent, 
  executeCollaboration 
} from '../services/agent-collaboration.service';
import { getActiveAgents } from '../services/agent-roles.service';
import type { WSMessage, WSMessageType, SendMessagePayload, JoinRoomPayload, TypingPayload, AgentRole } from '@requireagent/shared';

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  nickname?: string;
  projectId?: string;
  isAlive?: boolean;
}

interface Room {
  projectId: string;
  clients: Map<string, ExtendedWebSocket>;
  typingUsers: Set<string>;
}

const rooms = new Map<string, Room>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  // 心跳检测
  const interval = setInterval(() => {
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  
  wss.on('close', () => {
    clearInterval(interval);
  });
  
  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    ws.isAlive = true;
    
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // 从 URL 参数获取 token
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: '未提供认证令牌' },
        timestamp: Date.now(),
      }));
      ws.close();
      return;
    }
    
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(decoded.userId) as {
        id: string;
        nickname: string;
      } | undefined;
      
      if (!user) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: '用户不存在' },
          timestamp: Date.now(),
        }));
        ws.close();
        return;
      }
      
      ws.userId = user.id;
      ws.nickname = user.nickname;
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: '认证失败' },
        timestamp: Date.now(),
      }));
      ws.close();
      return;
    }
    
    ws.on('message', async (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (error) {
        console.error('WebSocket 消息处理错误:', error);
        sendToClient(ws, 'error', { message: '消息处理失败' });
      }
    });
    
    ws.on('close', () => {
      if (ws.projectId) {
        leaveRoom(ws);
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket 错误:', error);
    });
  });
  
  console.log('WebSocket 服务已启动');
}

async function handleMessage(ws: ExtendedWebSocket, message: WSMessage) {
  switch (message.type) {
    case 'join_room':
      await handleJoinRoom(ws, message.payload as JoinRoomPayload);
      break;
      
    case 'leave_room':
      leaveRoom(ws);
      break;
      
    case 'send_message':
      await handleSendMessage(ws, message.payload as SendMessagePayload);
      break;
      
    case 'typing':
      handleTyping(ws, message.payload as TypingPayload);
      break;
      
    case 'stop_typing':
      handleStopTyping(ws, message.payload as TypingPayload);
      break;
      
    default:
      sendToClient(ws, 'error', { message: '未知的消息类型' });
  }
}

async function handleJoinRoom(ws: ExtendedWebSocket, payload: JoinRoomPayload) {
  const { projectId } = payload;
  
  // 检查用户是否有权限加入
  const member = db.prepare(`
    SELECT id FROM project_members WHERE project_id = ? AND user_id = ?
  `).get(projectId, ws.userId);
  
  const project = db.prepare('SELECT visibility FROM projects WHERE id = ?').get(projectId) as { visibility: string } | undefined;
  
  if (!project) {
    sendToClient(ws, 'error', { message: '项目不存在' });
    return;
  }
  
  if (!member && project.visibility !== 'public') {
    sendToClient(ws, 'error', { message: '无权加入此项目' });
    return;
  }
  
  // 离开之前的房间
  if (ws.projectId) {
    leaveRoom(ws);
  }
  
  // 加入新房间
  ws.projectId = projectId;
  
  let room = rooms.get(projectId);
  if (!room) {
    room = {
      projectId,
      clients: new Map(),
      typingUsers: new Set(),
    };
    rooms.set(projectId, room);
  }
  
  room.clients.set(ws.userId!, ws);
  
  // 通知房间内其他用户
  broadcastToRoom(projectId, 'user_joined', {
    userId: ws.userId,
    nickname: ws.nickname,
    onlineCount: room.clients.size,
  }, ws.userId);
  
  // 发送当前在线用户列表
  const onlineUsers = Array.from(room.clients.values()).map(client => ({
    userId: client.userId,
    nickname: client.nickname,
  }));
  
  sendToClient(ws, 'join_room', {
    projectId,
    onlineUsers,
    onlineCount: room.clients.size,
  });
}

function leaveRoom(ws: ExtendedWebSocket) {
  const projectId = ws.projectId;
  if (!projectId) return;
  
  const room = rooms.get(projectId);
  if (room) {
    room.clients.delete(ws.userId!);
    room.typingUsers.delete(ws.userId!);
    
    if (room.clients.size === 0) {
      rooms.delete(projectId);
    } else {
      broadcastToRoom(projectId, 'user_left', {
        userId: ws.userId,
        nickname: ws.nickname,
        onlineCount: room.clients.size,
      });
    }
  }
  
  ws.projectId = undefined;
}

async function handleSendMessage(ws: ExtendedWebSocket, payload: SendMessagePayload) {
  const { projectId, content, replyTo, tags } = payload;
  
  if (!ws.projectId || ws.projectId !== projectId) {
    sendToClient(ws, 'error', { message: '请先加入项目房间' });
    return;
  }
  
  // 保存消息到数据库
  const messageId = nanoid();
  
  db.prepare(`
    INSERT INTO messages (id, project_id, user_id, type, content, reply_to)
    VALUES (?, ?, ?, 'user', ?, ?)
  `).run(messageId, projectId, ws.userId, content, replyTo || null);
  
  // 添加标签
  if (tags && tags.length > 0) {
    const tagStmt = db.prepare(`
      INSERT OR IGNORE INTO message_tags (message_id, tag_id)
      SELECT ?, id FROM tags WHERE project_id = ? AND name = ?
    `);
    
    for (const tag of tags) {
      tagStmt.run(messageId, projectId, tag);
    }
  }
  
  // 更新项目更新时间
  db.prepare('UPDATE projects SET updated_at = datetime("now") WHERE id = ?').run(projectId);
  
  const message = {
    id: messageId,
    projectId,
    user_id: ws.userId,
    user_nickname: ws.nickname,
    type: 'user',
    content,
    replyTo,
    tags: tags || [],
    created_at: new Date().toISOString(),
  };
  
  // 广播消息给房间内所有用户
  broadcastToRoom(projectId, 'message_received', message);
  
  // 清除用户的正在输入状态
  const room = rooms.get(projectId);
  if (room) {
    room.typingUsers.delete(ws.userId!);
  }
  
  // 触发 Agent 响应
  await triggerAgentResponse(projectId, { ...message, id: messageId });
}

async function triggerAgentResponse(projectId: string, userMessage: { content: string; nickname?: string; id?: string }) {
  // 获取项目的活跃 Agent
  const activeAgents = getActiveAgents(projectId);
  
  if (activeAgents.length === 0) return;
  
  // 获取最近的消息作为上下文
  const recentMessages = db.prepare(`
    SELECT m.content, m.type, u.nickname
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.project_id = ? AND m.is_filtered = 0
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all(projectId) as Array<{ content: string; type: string; nickname: string | null }>;
  
  // 判断是否需要回复
  const shouldRespond = shouldAgentRespond(userMessage.content, recentMessages.length);
  
  if (!shouldRespond) return;
  
  // 检查是否应该触发多 Agent 协作
  const shouldMultiAgent = shouldTriggerMultiAgent(userMessage.content, projectId);
  
  // 获取项目信息
  const project = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(projectId) as {
    name: string;
    description: string;
  };
  
  // 构建上下文
  const context = recentMessages.reverse().map(m => 
    m.nickname ? `[${m.nickname}]: ${m.content}` : m.content
  );
  
  if (shouldMultiAgent && activeAgents.length > 1) {
    // 触发多 Agent 协作
    try {
      // 通知前端多 Agent 协作开始
      broadcastToRoom(projectId, 'multi_agent_start', {
        triggeredBy: userMessage.id,
        content: userMessage.content,
      });
      
      const result = await executeCollaboration(
        projectId,
        userMessage.id || nanoid(),
        userMessage.content,
        context,
        undefined,
        (event) => {
          // 实时推送协作进度
          switch (event.type) {
            case 'start':
              broadcastToRoom(projectId, 'multi_agent_progress', {
                stage: 'analyzing',
                data: event.data,
              });
              break;
            case 'agent_turn':
              broadcastToRoom(projectId, 'multi_agent_agent_turn', event.data);
              break;
            case 'agent_reply':
              const replyData = event.data as {
                agentId: string;
                agentRole: AgentRole;
                agentName: string;
                content: string;
              };
              
              // 保存 Agent 消息
              const agentMsgId = nanoid();
              db.prepare(`
                INSERT INTO messages (id, project_id, type, content)
                VALUES (?, ?, 'agent', ?)
              `).run(agentMsgId, projectId, `[${replyData.agentName}]: ${replyData.content}`);
              
              broadcastToRoom(projectId, 'multi_agent_agent_reply', {
                id: agentMsgId,
                projectId,
                type: 'agent',
                agentId: replyData.agentId,
                agentRole: replyData.agentRole,
                agentName: replyData.agentName,
                content: replyData.content,
                created_at: new Date().toISOString(),
              });
              break;
            case 'debate':
              const debateData = event.data as {
                agentId: string;
                agentRole: AgentRole;
                agentName: string;
                content: string;
                round: number;
                sentiment?: string;
              };
              
              const debateMsgId = nanoid();
              db.prepare(`
                INSERT INTO messages (id, project_id, type, content)
                VALUES (?, ?, 'agent', ?)
              `).run(debateMsgId, projectId, `[${debateData.agentName} - 第${debateData.round}轮]: ${debateData.content}`);
              
              broadcastToRoom(projectId, 'multi_agent_debate', {
                id: debateMsgId,
                projectId,
                type: 'agent',
                agentId: debateData.agentId,
                agentRole: debateData.agentRole,
                agentName: debateData.agentName,
                content: debateData.content,
                debateRound: debateData.round,
                sentiment: debateData.sentiment,
                isDebate: true,
                created_at: new Date().toISOString(),
              });
              break;
            case 'complete':
              broadcastToRoom(projectId, 'multi_agent_complete', event.data);
              break;
          }
        }
      );
      
      // 如果有总结，发送总结消息
      if (result && result.summary) {
        const summaryId = nanoid();
        const summaryContent = `📋 **多 Agent 协作总结**\n\n${result.summary}\n\n${
          result.recommendations.length > 0 
            ? `**建议：**\n${result.recommendations.map(r => `• ${r}`).join('\n')}`
            : ''
        }${
          result.conflicts && result.conflicts.length > 0
            ? `\n\n**存在分歧：**\n${result.conflicts.map(c => `• ${c}`).join('\n')}`
            : ''
        }`;
        
        db.prepare(`
          INSERT INTO messages (id, project_id, type, content)
          VALUES (?, ?, 'agent', ?)
        `).run(summaryId, projectId, summaryContent);
        
        broadcastToRoom(projectId, 'agent_response', {
          id: summaryId,
          projectId,
          type: 'agent',
          content: summaryContent,
          isSummary: true,
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('多 Agent 协作失败:', error);
      broadcastToRoom(projectId, 'multi_agent_error', {
        error: '多 Agent 协作执行失败',
      });
    }
  } else {
    // 单 Agent 响应（使用第一个活跃的非主管 Agent）
    const respondingAgent = activeAgents.find(a => a.role !== 'supervisor') || activeAgents[0];
    
    if (!respondingAgent) return;
    
    const conversationHistory = recentMessages.map(m => ({
      role: m.type === 'agent' ? 'assistant' as const : 'user' as const,
      content: m.nickname ? `[${m.nickname}]: ${m.content}` : m.content,
    }));
    
    const systemPrompt = respondingAgent.systemPrompt || getDefaultAgentPrompt(respondingAgent.role, project);
    
    try {
      const response = await chat([
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ], {
        provider: respondingAgent.provider,
        model: respondingAgent.model || undefined,
        temperature: respondingAgent.temperature,
        maxTokens: respondingAgent.maxTokens,
      });
      
      // 保存 Agent 回复
      const agentMessageId = nanoid();
      db.prepare(`
        INSERT INTO messages (id, project_id, type, content)
        VALUES (?, ?, 'agent', ?)
      `).run(agentMessageId, projectId, response.content);
      
      // 广播 Agent 回复
      broadcastToRoom(projectId, 'agent_response', {
        id: agentMessageId,
        projectId,
        type: 'agent',
        agentId: respondingAgent.id,
        agentRole: respondingAgent.role,
        agentName: respondingAgent.name,
        content: response.content,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Agent 响应失败:', error);
    }
  }
}

function shouldAgentRespond(content: string, messageCount: number): boolean {
  // 如果消息以问号结尾
  if (content.trim().endsWith('?') || content.trim().endsWith('？')) {
    return true;
  }
  
  // 如果提到了 agent 或相关词汇
  const mentionKeywords = ['agent', 'ai', '助手', '请问', '帮忙', '建议', '怎么', '如何', '为什么', '什么是'];
  if (mentionKeywords.some(keyword => content.toLowerCase().includes(keyword))) {
    return true;
  }
  
  // 每隔一定数量的消息主动参与
  if (messageCount > 0 && messageCount % 5 === 0) {
    return true;
  }
  
  return false;
}

function getDefaultAgentPrompt(role: string, project: { name: string; description: string }): string {
  return `你是 RequireAgent，一个专业的需求分析助手，正在帮助项目「${project.name}」收集和整理需求。

项目描述：${project.description || '暂无描述'}

你的职责是：
1. 帮助团队收集和整理需求
2. 发现需求中的模糊点并主动提问澄清
3. 识别需求之间的冲突或依赖关系
4. 提供专业的建议和最佳实践
5. 总结讨论内容，提炼关键需求点

注意事项：
- 用友好专业的语气交流
- 回复要简洁有针对性
- 适时提出引导性问题
- 发现需求冲突时要指出`;
}

function handleTyping(ws: ExtendedWebSocket, payload: TypingPayload) {
  const { projectId } = payload;
  
  if (!ws.projectId || ws.projectId !== projectId) return;
  
  const room = rooms.get(projectId);
  if (room) {
    room.typingUsers.add(ws.userId!);
    
    broadcastToRoom(projectId, 'typing', {
      userId: ws.userId,
      nickname: ws.nickname,
      typingUsers: Array.from(room.typingUsers),
    }, ws.userId);
  }
}

function handleStopTyping(ws: ExtendedWebSocket, payload: TypingPayload) {
  const { projectId } = payload;
  
  if (!ws.projectId || ws.projectId !== projectId) return;
  
  const room = rooms.get(projectId);
  if (room) {
    room.typingUsers.delete(ws.userId!);
    
    broadcastToRoom(projectId, 'stop_typing', {
      userId: ws.userId,
      typingUsers: Array.from(room.typingUsers),
    }, ws.userId);
  }
}

function sendToClient(ws: ExtendedWebSocket, type: WSMessageType, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type,
      payload,
      timestamp: Date.now(),
    }));
  }
}

function broadcastToRoom(projectId: string, type: WSMessageType, payload: unknown, excludeUserId?: string) {
  const room = rooms.get(projectId);
  if (!room) return;
  
  const message = JSON.stringify({
    type,
    payload,
    timestamp: Date.now(),
  });
  
  room.clients.forEach((client, userId) => {
    if (excludeUserId && userId === excludeUserId) return;
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
