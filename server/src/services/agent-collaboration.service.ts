/**
 * Agent 协作服务
 * 整合多种协作模式，提供统一的协作接口
 */

import { nanoid } from 'nanoid';
import db from '../database';
import { chat } from './llm.service';
import { 
  getActiveAgents, 
  getProjectAgents,
  AGENT_ROLE_PRESETS 
} from './agent-roles.service';
import {
  analyzeAndDispatch,
  createCollaborationSession,
  executePipelineCollaboration,
  executeDebateCollaboration,
  executeParallelCollaboration,
  completeSession,
} from './agent-supervisor.service';
import type { 
  AgentConfig, 
  AgentRole,
  CollaborationMode,
  CollaborationConfig,
  CollaborationResult,
  AgentMessage,
} from '@requireagent/shared';

interface CollaborationOptions {
  forceMode?: CollaborationMode;
  forceAgents?: AgentRole[];
  maxDebateRounds?: number;
}

/**
 * 获取项目的协作配置
 */
export function getCollaborationConfig(projectId: string): CollaborationConfig | null {
  const row = db.prepare(`
    SELECT * FROM collaboration_configs WHERE project_id = ?
  `).get(projectId) as {
    project_id: string;
    mode: string;
    is_enabled: number;
    max_debate_rounds: number;
    debate_threshold: number;
    supervisor_agent_id: string | null;
    pipeline_order: string;
    auto_trigger_keywords: string;
    consensus_required: number;
  } | undefined;
  
  if (!row) return null;
  
  return {
    projectId: row.project_id,
    mode: row.mode as CollaborationMode,
    isEnabled: row.is_enabled === 1,
    maxDebateRounds: row.max_debate_rounds,
    debateThreshold: row.debate_threshold,
    supervisorAgentId: row.supervisor_agent_id || undefined,
    pipelineOrder: JSON.parse(row.pipeline_order || '[]'),
    autoTriggerKeywords: JSON.parse(row.auto_trigger_keywords || '[]'),
    consensusRequired: row.consensus_required === 1,
  };
}

/**
 * 保存项目的协作配置
 */
export function saveCollaborationConfig(config: CollaborationConfig): void {
  const existing = getCollaborationConfig(config.projectId);
  
  if (existing) {
    db.prepare(`
      UPDATE collaboration_configs SET
        mode = ?,
        is_enabled = ?,
        max_debate_rounds = ?,
        debate_threshold = ?,
        supervisor_agent_id = ?,
        pipeline_order = ?,
        auto_trigger_keywords = ?,
        consensus_required = ?
      WHERE project_id = ?
    `).run(
      config.mode,
      config.isEnabled ? 1 : 0,
      config.maxDebateRounds,
      config.debateThreshold,
      config.supervisorAgentId || null,
      JSON.stringify(config.pipelineOrder),
      JSON.stringify(config.autoTriggerKeywords),
      config.consensusRequired ? 1 : 0,
      config.projectId
    );
  } else {
    db.prepare(`
      INSERT INTO collaboration_configs (
        project_id, mode, is_enabled, max_debate_rounds, debate_threshold,
        supervisor_agent_id, pipeline_order, auto_trigger_keywords, consensus_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      config.projectId,
      config.mode,
      config.isEnabled ? 1 : 0,
      config.maxDebateRounds,
      config.debateThreshold,
      config.supervisorAgentId || null,
      JSON.stringify(config.pipelineOrder),
      JSON.stringify(config.autoTriggerKeywords),
      config.consensusRequired ? 1 : 0
    );
  }
}

/**
 * 初始化项目的默认协作配置
 */
export function initializeCollaborationConfig(projectId: string): CollaborationConfig {
  const defaultConfig: CollaborationConfig = {
    projectId,
    mode: 'flexible',
    isEnabled: true,
    maxDebateRounds: 3,
    debateThreshold: 0.5,
    pipelineOrder: [],
    autoTriggerKeywords: ['需要多方意见', '大家怎么看', '讨论一下', '@all'],
    consensusRequired: false,
  };
  
  saveCollaborationConfig(defaultConfig);
  return defaultConfig;
}

/**
 * 检查是否应该触发多 Agent 协作
 */
export function shouldTriggerMultiAgent(
  content: string,
  projectId: string
): boolean {
  const config = getCollaborationConfig(projectId);
  
  if (!config || !config.isEnabled) {
    return false;
  }
  
  // 检查自动触发关键词
  const hasKeyword = config.autoTriggerKeywords.some(
    keyword => content.toLowerCase().includes(keyword.toLowerCase())
  );
  
  if (hasKeyword) {
    return true;
  }
  
  // 检查是否是复杂问题（简单启发式）
  const complexIndicators = [
    '如何', '怎么', '为什么', '能不能', '可以吗',
    '建议', '方案', '策略', '设计', '架构',
    '优化', '改进', '实现', '评估',
  ];
  
  const indicatorCount = complexIndicators.filter(
    indicator => content.includes(indicator)
  ).length;
  
  // 如果包含多个复杂指标词，或者消息较长，考虑触发
  return indicatorCount >= 2 || content.length > 200;
}

/**
 * 执行多 Agent 协作
 */
export async function executeCollaboration(
  projectId: string,
  messageId: string,
  content: string,
  context: string[],
  options?: CollaborationOptions,
  onProgress?: (event: {
    type: 'start' | 'agent_turn' | 'agent_reply' | 'debate' | 'complete';
    data: unknown;
  }) => void
): Promise<CollaborationResult | null> {
  const config = getCollaborationConfig(projectId) || initializeCollaborationConfig(projectId);
  const allAgents = getActiveAgents(projectId);
  
  if (allAgents.length === 0) {
    console.log('项目没有活跃的 Agent，跳过多 Agent 协作');
    return null;
  }
  
  // 获取项目信息
  const project = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(projectId) as {
    name: string;
    description: string;
  };
  
  // 决定协作模式和参与的 Agent
  let mode = options?.forceMode || config.mode;
  let participatingRoles: AgentRole[];
  
  if (options?.forceAgents && options.forceAgents.length > 0) {
    participatingRoles = options.forceAgents;
  } else {
    // 使用主管 Agent 分析并调度
    const dispatch = await analyzeAndDispatch(projectId, content, context);
    participatingRoles = dispatch.agents;
    mode = options?.forceMode || dispatch.mode;
    
    onProgress?.({
      type: 'start',
      data: {
        mode,
        agents: dispatch.agents,
        reason: dispatch.reason,
      },
    });
  }
  
  // 筛选参与的 Agent
  const participatingAgents = allAgents.filter(
    agent => participatingRoles.includes(agent.role) && agent.role !== 'supervisor'
  );
  
  if (participatingAgents.length === 0) {
    // 使用通用 Agent
    const generalAgent = allAgents.find(a => a.role === 'general');
    if (generalAgent) {
      participatingAgents.push(generalAgent);
    } else {
      return null;
    }
  }
  
  // 创建协作会话
  const session = createCollaborationSession(
    projectId,
    messageId,
    mode,
    participatingAgents.map(a => a.id),
    content
  );
  
  // 根据模式执行协作
  let result: CollaborationResult;
  
  const handleAgentResponse = (response: {
    agentId: string;
    agentRole: AgentRole;
    agentName: string;
    content: string;
    round?: number;
    sentiment?: 'agree' | 'disagree' | 'neutral';
  }) => {
    // 保存 Agent 消息
    saveAgentMessage({
      id: nanoid(),
      sessionId: session.id,
      projectId,
      agentId: response.agentId,
      agentRole: response.agentRole,
      agentName: response.agentName,
      content: response.content,
      isDebate: mode === 'debate',
      debateRound: response.round,
      sentiment: response.sentiment,
      createdAt: new Date(),
    });
    
    onProgress?.({
      type: mode === 'debate' ? 'debate' : 'agent_reply',
      data: response,
    });
  };
  
  switch (mode) {
    case 'pipeline':
      result = await executePipelineCollaboration(
        session,
        participatingAgents,
        project,
        content,
        handleAgentResponse
      );
      break;
      
    case 'debate':
      result = await executeDebateCollaboration(
        session,
        participatingAgents,
        project,
        content,
        options?.maxDebateRounds || config.maxDebateRounds,
        handleAgentResponse
      );
      break;
      
    case 'parallel':
      result = await executeParallelCollaboration(
        session,
        participatingAgents,
        project,
        content,
        handleAgentResponse
      );
      break;
      
    case 'flexible':
    default:
      // 灵活模式：根据问题复杂度选择
      if (participatingAgents.length === 1) {
        result = await executeParallelCollaboration(
          session,
          participatingAgents,
          project,
          content,
          handleAgentResponse
        );
      } else if (content.includes('争议') || content.includes('讨论')) {
        result = await executeDebateCollaboration(
          session,
          participatingAgents,
          project,
          content,
          options?.maxDebateRounds || config.maxDebateRounds,
          handleAgentResponse
        );
      } else {
        result = await executePipelineCollaboration(
          session,
          participatingAgents,
          project,
          content,
          handleAgentResponse
        );
      }
      break;
  }
  
  // 完成会话
  completeSession(session.id);
  
  onProgress?.({
    type: 'complete',
    data: result,
  });
  
  return result;
}

/**
 * 保存 Agent 消息
 */
function saveAgentMessage(message: AgentMessage): void {
  db.prepare(`
    INSERT INTO agent_messages (
      id, session_id, project_id, agent_id, agent_role, agent_name,
      content, reply_to, is_debate, debate_round, sentiment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    message.id,
    message.sessionId || null,
    message.projectId,
    message.agentId,
    message.agentRole,
    message.agentName,
    message.content,
    message.replyTo || null,
    message.isDebate ? 1 : 0,
    message.debateRound || null,
    message.sentiment || null
  );
}

/**
 * 获取项目的 Agent 消息历史
 */
export function getAgentMessages(
  projectId: string,
  options?: {
    sessionId?: string;
    limit?: number;
    offset?: number;
  }
): AgentMessage[] {
  let query = 'SELECT * FROM agent_messages WHERE project_id = ?';
  const params: (string | number)[] = [projectId];
  
  if (options?.sessionId) {
    query += ' AND session_id = ?';
    params.push(options.sessionId);
  }
  
  query += ' ORDER BY created_at DESC';
  
  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
    
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }
  }
  
  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    session_id: string | null;
    project_id: string;
    agent_id: string;
    agent_role: string;
    agent_name: string;
    content: string;
    reply_to: string | null;
    is_debate: number;
    debate_round: number | null;
    sentiment: string | null;
    created_at: string;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id || undefined,
    projectId: row.project_id,
    agentId: row.agent_id,
    agentRole: row.agent_role as AgentRole,
    agentName: row.agent_name,
    content: row.content,
    replyTo: row.reply_to || undefined,
    isDebate: row.is_debate === 1,
    debateRound: row.debate_round || undefined,
    sentiment: row.sentiment as 'agree' | 'disagree' | 'neutral' | undefined,
    createdAt: new Date(row.created_at),
  }));
}

/**
 * 获取所有可用的 Agent 角色预设
 */
export function getAvailableRolePresets(): Array<{
  role: AgentRole;
  name: string;
  icon: string;
  color: string;
  description: string;
  capabilities: string[];
}> {
  return Object.values(AGENT_ROLE_PRESETS).map(preset => ({
    role: preset.role,
    name: preset.name,
    icon: preset.icon,
    color: preset.color,
    description: preset.description,
    capabilities: preset.capabilities,
  }));
}

/**
 * 快速单 Agent 回复（不走协作流程）
 */
export async function quickAgentReply(
  projectId: string,
  agentId: string,
  message: string,
  context?: string[]
): Promise<string | null> {
  const agents = getProjectAgents(projectId);
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    return null;
  }
  
  const project = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(projectId) as {
    name: string;
    description: string;
  };
  
  const preset = AGENT_ROLE_PRESETS[agent.role];
  const systemPrompt = agent.systemPrompt || preset?.defaultPrompt || '';
  
  const fullPrompt = `${systemPrompt}

---
当前项目：${project.name}
项目描述：${project.description || '暂无'}`;
  
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: fullPrompt },
  ];
  
  // 添加上下文
  if (context && context.length > 0) {
    context.slice(-5).forEach(c => {
      messages.push({ role: 'user', content: c });
    });
  }
  
  messages.push({ role: 'user', content: message });
  
  try {
    const response = await chat(messages, {
      provider: agent.provider,
      model: agent.model || undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
    });
    
    return response.content;
  } catch (error) {
    console.error('Agent 回复失败:', error);
    return null;
  }
}
