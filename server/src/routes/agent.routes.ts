/**
 * Agent 管理 API 路由
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getAgentRolePresets,
  getAgentRolePreset,
  createAgent,
  getProjectAgents,
  getActiveAgents,
  updateAgent,
  deleteAgent,
  initializeDefaultAgentTeam,
} from '../services/agent-roles.service';
import {
  getCollaborationConfig,
  saveCollaborationConfig,
  initializeCollaborationConfig,
  executeCollaboration,
  getAgentMessages,
  getAvailableRolePresets,
  quickAgentReply,
} from '../services/agent-collaboration.service';
import db from '../database';
import type { AgentRole, LLMProvider, CollaborationMode } from '@requireagent/shared';

const router = Router();

// 所有路由需要认证
router.use(authMiddleware);

/**
 * 获取所有可用的 Agent 角色预设
 * GET /api/agents/presets
 */
router.get('/presets', (req: Request, res: Response) => {
  try {
    const presets = getAvailableRolePresets();
    res.json({ success: true, data: presets });
  } catch (error) {
    console.error('获取 Agent 预设失败:', error);
    res.status(500).json({ success: false, error: '获取 Agent 预设失败' });
  }
});

/**
 * 获取项目的所有 Agent
 * GET /api/agents/project/:projectId
 */
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    
    // 检查权限
    const isMember = checkProjectAccess(projectId, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: '无权访问此项目' });
    }
    
    const agents = getProjectAgents(projectId);
    const presets = getAgentRolePresets();
    
    // 为每个 Agent 添加预设信息
    const agentsWithPresets = agents.map(agent => ({
      ...agent,
      preset: presets.find(p => p.role === agent.role),
    }));
    
    res.json({ success: true, data: agentsWithPresets });
  } catch (error) {
    console.error('获取项目 Agent 失败:', error);
    res.status(500).json({ success: false, error: '获取项目 Agent 失败' });
  }
});

/**
 * 创建 Agent
 * POST /api/agents/project/:projectId
 */
router.post('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const { role, name, provider, model, systemPrompt, temperature, maxTokens, priority, capabilities } = req.body;
    
    // 检查权限（只有管理员和创建者可以添加 Agent）
    const hasPermission = checkProjectPermission(projectId, userId, ['admin', 'creator']);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权添加 Agent' });
    }
    
    if (!role) {
      return res.status(400).json({ success: false, error: '请指定 Agent 角色' });
    }
    
    const agent = createAgent(projectId, role as AgentRole, {
      name,
      provider: provider as LLMProvider,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      priority,
      capabilities,
    });
    
    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('创建 Agent 失败:', error);
    res.status(500).json({ success: false, error: '创建 Agent 失败' });
  }
});

/**
 * 初始化默认 Agent 团队
 * POST /api/agents/project/:projectId/init-team
 */
router.post('/project/:projectId/init-team', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    
    // 检查权限
    const hasPermission = checkProjectPermission(projectId, userId, ['admin', 'creator']);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权操作' });
    }
    
    // 检查是否已有 Agent
    const existingAgents = getProjectAgents(projectId);
    if (existingAgents.length > 0) {
      return res.status(400).json({ success: false, error: '项目已有 Agent，请手动管理' });
    }
    
    const agents = initializeDefaultAgentTeam(projectId);
    
    // 同时初始化协作配置
    initializeCollaborationConfig(projectId);
    
    res.json({ success: true, data: agents, message: '已创建默认 Agent 团队' });
  } catch (error) {
    console.error('初始化 Agent 团队失败:', error);
    res.status(500).json({ success: false, error: '初始化 Agent 团队失败' });
  }
});

/**
 * 更新 Agent
 * PATCH /api/agents/:agentId
 */
router.patch('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.user!.id;
    const updates = req.body;
    
    // 获取 Agent 所属项目
    const agentRow = db.prepare('SELECT project_id FROM agent_configs WHERE id = ?').get(agentId) as {
      project_id: string;
    } | undefined;
    
    if (!agentRow) {
      return res.status(404).json({ success: false, error: 'Agent 不存在' });
    }
    
    // 检查权限
    const hasPermission = checkProjectPermission(agentRow.project_id, userId, ['admin', 'creator']);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权修改 Agent' });
    }
    
    const agent = updateAgent(agentId, updates);
    
    if (!agent) {
      return res.status(400).json({ success: false, error: '更新失败' });
    }
    
    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('更新 Agent 失败:', error);
    res.status(500).json({ success: false, error: '更新 Agent 失败' });
  }
});

/**
 * 删除 Agent
 * DELETE /api/agents/:agentId
 */
router.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.user!.id;
    
    // 获取 Agent 所属项目
    const agentRow = db.prepare('SELECT project_id FROM agent_configs WHERE id = ?').get(agentId) as {
      project_id: string;
    } | undefined;
    
    if (!agentRow) {
      return res.status(404).json({ success: false, error: 'Agent 不存在' });
    }
    
    // 检查权限
    const hasPermission = checkProjectPermission(agentRow.project_id, userId, ['admin', 'creator']);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权删除 Agent' });
    }
    
    const success = deleteAgent(agentId);
    
    if (!success) {
      return res.status(400).json({ success: false, error: '删除失败' });
    }
    
    res.json({ success: true, message: 'Agent 已删除' });
  } catch (error) {
    console.error('删除 Agent 失败:', error);
    res.status(500).json({ success: false, error: '删除 Agent 失败' });
  }
});

/**
 * 获取协作配置
 * GET /api/agents/project/:projectId/collaboration
 */
router.get('/project/:projectId/collaboration', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    
    // 检查权限
    const isMember = checkProjectAccess(projectId, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: '无权访问此项目' });
    }
    
    let config = getCollaborationConfig(projectId);
    
    if (!config) {
      config = initializeCollaborationConfig(projectId);
    }
    
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('获取协作配置失败:', error);
    res.status(500).json({ success: false, error: '获取协作配置失败' });
  }
});

/**
 * 更新协作配置
 * PUT /api/agents/project/:projectId/collaboration
 */
router.put('/project/:projectId/collaboration', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const configUpdates = req.body;
    
    // 检查权限
    const hasPermission = checkProjectPermission(projectId, userId, ['admin', 'creator']);
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: '无权修改配置' });
    }
    
    const currentConfig = getCollaborationConfig(projectId) || initializeCollaborationConfig(projectId);
    
    const newConfig = {
      ...currentConfig,
      ...configUpdates,
      projectId, // 确保 projectId 不被覆盖
    };
    
    saveCollaborationConfig(newConfig);
    
    res.json({ success: true, data: newConfig });
  } catch (error) {
    console.error('更新协作配置失败:', error);
    res.status(500).json({ success: false, error: '更新协作配置失败' });
  }
});

/**
 * 手动触发多 Agent 协作
 * POST /api/agents/project/:projectId/collaborate
 */
router.post('/project/:projectId/collaborate', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const { messageId, content, context, mode, agents } = req.body;
    
    // 检查权限
    const isMember = checkProjectAccess(projectId, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: '无权访问此项目' });
    }
    
    if (!content) {
      return res.status(400).json({ success: false, error: '请提供讨论内容' });
    }
    
    const result = await executeCollaboration(
      projectId,
      messageId || 'manual',
      content,
      context || [],
      {
        forceMode: mode as CollaborationMode,
        forceAgents: agents as AgentRole[],
      }
    );
    
    if (!result) {
      return res.status(400).json({ success: false, error: '协作执行失败' });
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('执行协作失败:', error);
    res.status(500).json({ success: false, error: '执行协作失败' });
  }
});

/**
 * 获取 Agent 消息历史
 * GET /api/agents/project/:projectId/messages
 */
router.get('/project/:projectId/messages', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const { sessionId, limit, offset } = req.query;
    
    // 检查权限
    const isMember = checkProjectAccess(projectId, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: '无权访问此项目' });
    }
    
    const messages = getAgentMessages(projectId, {
      sessionId: sessionId as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });
    
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('获取 Agent 消息失败:', error);
    res.status(500).json({ success: false, error: '获取 Agent 消息失败' });
  }
});

/**
 * 快速 Agent 回复
 * POST /api/agents/:agentId/reply
 */
router.post('/:agentId/reply', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.user!.id;
    const { message, context } = req.body;
    
    // 获取 Agent 所属项目
    const agentRow = db.prepare('SELECT project_id FROM agent_configs WHERE id = ?').get(agentId) as {
      project_id: string;
    } | undefined;
    
    if (!agentRow) {
      return res.status(404).json({ success: false, error: 'Agent 不存在' });
    }
    
    // 检查权限
    const isMember = checkProjectAccess(agentRow.project_id, userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: '无权使用此 Agent' });
    }
    
    if (!message) {
      return res.status(400).json({ success: false, error: '请提供消息内容' });
    }
    
    const reply = await quickAgentReply(agentRow.project_id, agentId, message, context);
    
    if (!reply) {
      return res.status(500).json({ success: false, error: 'Agent 回复失败' });
    }
    
    res.json({ success: true, data: { reply } });
  } catch (error) {
    console.error('Agent 回复失败:', error);
    res.status(500).json({ success: false, error: 'Agent 回复失败' });
  }
});

// 辅助函数：检查项目访问权限
function checkProjectAccess(projectId: string, userId: string): boolean {
  const project = db.prepare('SELECT visibility, creator_id FROM projects WHERE id = ?').get(projectId) as {
    visibility: string;
    creator_id: string;
  } | undefined;
  
  if (!project) return false;
  
  if (project.visibility === 'public') return true;
  if (project.creator_id === userId) return true;
  
  const member = db.prepare(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId);
  
  return !!member;
}

// 辅助函数：检查项目操作权限
function checkProjectPermission(projectId: string, userId: string, allowedRoles: string[]): boolean {
  const project = db.prepare('SELECT creator_id FROM projects WHERE id = ?').get(projectId) as {
    creator_id: string;
  } | undefined;
  
  if (!project) return false;
  
  // 创建者拥有所有权限
  if (project.creator_id === userId) return true;
  
  // 检查成员角色
  const member = db.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId) as { role: string } | undefined;
  
  if (!member) return false;
  
  return allowedRoles.includes(member.role);
}

export default router;
