/**
 * 主管 Agent 服务
 * 负责协调调度多个专业 Agent，管理协作流程
 */

import { nanoid } from 'nanoid';
import db from '../database';
import { chat } from './llm.service';
import { 
  getActiveAgents, 
  getAgentSystemPrompt, 
  AGENT_ROLE_PRESETS 
} from './agent-roles.service';
import type { 
  AgentConfig, 
  AgentRole, 
  CollaborationMode,
  MultiAgentSession,
  AgentTask,
  AgentTaskStatus,
  CollaborationResult 
} from '@requireagent/shared';

interface DispatchDecision {
  agents: AgentRole[];
  mode: CollaborationMode;
  reason: string;
  order?: AgentRole[];  // 执行顺序（流水线模式）
}

interface AgentResponse {
  agentId: string;
  agentRole: AgentRole;
  agentName: string;
  content: string;
  sentiment?: 'agree' | 'disagree' | 'neutral';
}

/**
 * 主管 Agent 分析消息并决定调度哪些 Agent
 */
export async function analyzeAndDispatch(
  projectId: string,
  message: string,
  context: string[]
): Promise<DispatchDecision> {
  const activeAgents = getActiveAgents(projectId);
  
  // 获取可用的专业 Agent（排除主管）
  const availableRoles = activeAgents
    .filter(a => a.role !== 'supervisor')
    .map(a => ({
      role: a.role,
      name: a.name,
      capabilities: a.capabilities,
    }));
  
  if (availableRoles.length === 0) {
    // 如果没有配置其他 Agent，返回通用 Agent
    return {
      agents: ['general'],
      mode: 'flexible',
      reason: '项目未配置专业 Agent，使用通用助手回复',
    };
  }
  
  const systemPrompt = `你是一个智能调度系统，负责分析用户的问题并决定需要哪些专业 Agent 参与回答。

可用的专业 Agent：
${availableRoles.map(a => `- ${a.role}（${a.name}）: ${a.capabilities.join('、')}`).join('\n')}

协作模式说明：
- pipeline: 流水线模式，适合需要多个角度依次补充的问题
- debate: 辩论模式，适合有争议或需要多方观点碰撞的问题
- parallel: 并行模式，适合需要快速获取多方独立观点的问题
- flexible: 灵活模式，由你动态决定如何协调

请分析用户的问题，返回 JSON 格式的调度决策：
{
  "agents": ["agent_role1", "agent_role2"],  // 需要参与的 Agent 角色
  "mode": "pipeline|debate|parallel|flexible",  // 协作模式
  "reason": "调度原因说明",
  "order": ["role1", "role2"]  // 流水线模式时的执行顺序
}

注意：
1. 简单问题只需要 1 个 Agent
2. 复杂需求可能需要 2-4 个 Agent
3. 涉及技术可行性的需求建议让技术 Agent 参与
4. 涉及用户体验的需求建议让设计 Agent 参与
5. 需要权衡利弊的问题可以使用辩论模式`;

  const contextText = context.length > 0 
    ? `\n\n最近的讨论上下文：\n${context.slice(-5).join('\n')}` 
    : '';

  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `用户问题：${message}${contextText}\n\n请返回 JSON 格式的调度决策：` },
    ], { temperature: 0.3 });
    
    // 解析 JSON 响应
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]) as DispatchDecision;
      
      // 验证返回的角色是否有效
      decision.agents = decision.agents.filter(role => 
        availableRoles.some(a => a.role === role) || role === 'general'
      );
      
      if (decision.agents.length === 0) {
        decision.agents = ['general'];
      }
      
      return decision;
    }
  } catch (error) {
    console.error('主管 Agent 调度分析失败:', error);
  }
  
  // 默认返回产品和技术 Agent
  return {
    agents: ['product', 'technical'],
    mode: 'pipeline',
    reason: '默认调度：产品和技术视角分析',
    order: ['product', 'technical'],
  };
}

/**
 * 创建多 Agent 协作会话
 */
export function createCollaborationSession(
  projectId: string,
  triggeredBy: string,
  mode: CollaborationMode,
  participatingAgentIds: string[],
  context: string
): MultiAgentSession {
  const sessionId = nanoid();
  
  const session: MultiAgentSession = {
    id: sessionId,
    projectId,
    mode,
    status: 'active',
    triggeredBy,
    participatingAgents: participatingAgentIds,
    context,
    createdAt: new Date(),
  };
  
  db.prepare(`
    INSERT INTO multi_agent_sessions (
      id, project_id, mode, status, triggered_by, 
      participating_agents, context, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    session.id,
    session.projectId,
    session.mode,
    session.status,
    session.triggeredBy,
    JSON.stringify(session.participatingAgents),
    session.context
  );
  
  return session;
}

/**
 * 创建 Agent 任务
 */
export function createAgentTask(
  sessionId: string,
  agentId: string,
  input: string,
  order: number
): AgentTask {
  const taskId = nanoid();
  
  const task: AgentTask = {
    id: taskId,
    sessionId,
    agentId,
    status: 'pending',
    input,
    order,
  };
  
  db.prepare(`
    INSERT INTO agent_tasks (id, session_id, agent_id, status, input, task_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(task.id, task.sessionId, task.agentId, task.status, task.input, task.order);
  
  return task;
}

/**
 * 更新任务状态
 */
export function updateTaskStatus(
  taskId: string, 
  status: AgentTaskStatus, 
  output?: string, 
  error?: string
): void {
  const updateFields: string[] = ['status = ?'];
  const updateValues: (string | null)[] = [status];
  
  if (status === 'running') {
    updateFields.push('started_at = datetime("now")');
  }
  if (status === 'completed' || status === 'failed') {
    updateFields.push('completed_at = datetime("now")');
  }
  if (output !== undefined) {
    updateFields.push('output = ?');
    updateValues.push(output);
  }
  if (error !== undefined) {
    updateFields.push('error = ?');
    updateValues.push(error);
  }
  
  updateValues.push(taskId);
  
  db.prepare(`UPDATE agent_tasks SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
}

/**
 * 执行流水线模式协作
 */
export async function executePipelineCollaboration(
  session: MultiAgentSession,
  agents: AgentConfig[],
  projectInfo: { name: string; description: string },
  initialMessage: string,
  onAgentResponse: (response: AgentResponse) => void
): Promise<CollaborationResult> {
  const responses: AgentResponse[] = [];
  let accumulatedContext = initialMessage;
  
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const task = createAgentTask(session.id, agent.id, accumulatedContext, i);
    
    updateTaskStatus(task.id, 'running');
    
    try {
      // 构建消息历史，包含之前 Agent 的回复
      const messages = [
        { 
          role: 'user' as const, 
          content: `原始问题：${initialMessage}\n\n${
            responses.length > 0 
              ? `其他专家的观点：\n${responses.map(r => `[${r.agentName}]: ${r.content}`).join('\n\n')}\n\n请基于以上信息，从你的专业角度补充分析。` 
              : '请从你的专业角度分析这个问题。'
          }`
        }
      ];
      
      const response = await chat([
        { role: 'system', content: getAgentSystemPrompt(agent, projectInfo) },
        ...messages,
      ], {
        provider: agent.provider,
        model: agent.model || undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
      
      const agentResponse: AgentResponse = {
        agentId: agent.id,
        agentRole: agent.role,
        agentName: agent.name,
        content: response.content,
      };
      
      responses.push(agentResponse);
      accumulatedContext += `\n\n[${agent.name}]: ${response.content}`;
      
      updateTaskStatus(task.id, 'completed', response.content);
      onAgentResponse(agentResponse);
      
    } catch (error) {
      updateTaskStatus(task.id, 'failed', undefined, String(error));
      console.error(`Agent ${agent.name} 执行失败:`, error);
    }
  }
  
  // 生成总结
  const summary = await generateCollaborationSummary(responses, initialMessage);
  
  return {
    sessionId: session.id,
    mode: 'pipeline',
    participants: responses.map(r => ({
      agentId: r.agentId,
      agentName: r.agentName,
      role: r.agentRole,
      contribution: r.content,
    })),
    summary: summary.summary,
    recommendations: summary.recommendations,
  };
}

/**
 * 执行辩论模式协作
 */
export async function executeDebateCollaboration(
  session: MultiAgentSession,
  agents: AgentConfig[],
  projectInfo: { name: string; description: string },
  topic: string,
  maxRounds: number,
  onAgentResponse: (response: AgentResponse & { round: number }) => void
): Promise<CollaborationResult> {
  const debateHistory: Array<AgentResponse & { round: number }> = [];
  let round = 1;
  let consensusReached = false;
  
  while (round <= maxRounds && !consensusReached) {
    for (const agent of agents) {
      const previousRoundResponses = debateHistory
        .filter(r => r.round === round - 1 || (round === 1 && r.round === 0))
        .map(r => `[${r.agentName}]: ${r.content}`)
        .join('\n\n');
      
      const debatePrompt = round === 1
        ? `辩论主题：${topic}\n\n请从你的专业角度发表观点，说明你的立场和理由。`
        : `辩论主题：${topic}\n\n上一轮观点：\n${previousRoundResponses}\n\n请回应其他专家的观点，你可以：
1. 表示同意并补充
2. 提出不同意见并说明理由
3. 提出新的视角

在回复开头用 [同意/不同意/中立] 标明你的立场。`;
      
      try {
        const response = await chat([
          { role: 'system', content: getAgentSystemPrompt(agent, projectInfo) + '\n\n你正在参与一场专业讨论，请积极表达观点，但也要尊重其他观点。' },
          { role: 'user', content: debatePrompt },
        ], {
          provider: agent.provider,
          model: agent.model || undefined,
          temperature: agent.temperature + 0.1, // 稍微提高温度增加多样性
          maxTokens: agent.maxTokens,
        });
        
        // 分析立场
        let sentiment: 'agree' | 'disagree' | 'neutral' = 'neutral';
        if (response.content.includes('[同意]') || response.content.includes('同意')) {
          sentiment = 'agree';
        } else if (response.content.includes('[不同意]') || response.content.includes('不同意')) {
          sentiment = 'disagree';
        }
        
        const agentResponse = {
          agentId: agent.id,
          agentRole: agent.role,
          agentName: agent.name,
          content: response.content,
          sentiment,
          round,
        };
        
        debateHistory.push(agentResponse);
        onAgentResponse(agentResponse);
        
      } catch (error) {
        console.error(`Agent ${agent.name} 辩论发言失败:`, error);
      }
    }
    
    // 检查是否达成共识
    const lastRoundResponses = debateHistory.filter(r => r.round === round);
    const agreeCount = lastRoundResponses.filter(r => r.sentiment === 'agree').length;
    
    if (agreeCount >= agents.length * 0.8) {
      consensusReached = true;
    }
    
    round++;
  }
  
  // 生成辩论总结
  const summary = await generateDebateSummary(debateHistory, topic, consensusReached);
  
  return {
    sessionId: session.id,
    mode: 'debate',
    participants: debateHistory.map(r => ({
      agentId: r.agentId,
      agentName: r.agentName,
      role: r.agentRole,
      contribution: r.content,
    })),
    consensus: consensusReached ? summary.consensus : undefined,
    summary: summary.summary,
    recommendations: summary.recommendations,
    conflicts: summary.conflicts,
  };
}

/**
 * 执行并行模式协作
 */
export async function executeParallelCollaboration(
  session: MultiAgentSession,
  agents: AgentConfig[],
  projectInfo: { name: string; description: string },
  message: string,
  onAgentResponse: (response: AgentResponse) => void
): Promise<CollaborationResult> {
  const tasks = agents.map((agent, i) => 
    createAgentTask(session.id, agent.id, message, i)
  );
  
  // 并行执行所有 Agent
  const responsePromises = agents.map(async (agent, i) => {
    const task = tasks[i];
    updateTaskStatus(task.id, 'running');
    
    try {
      const response = await chat([
        { role: 'system', content: getAgentSystemPrompt(agent, projectInfo) },
        { role: 'user', content: message },
      ], {
        provider: agent.provider,
        model: agent.model || undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
      
      const agentResponse: AgentResponse = {
        agentId: agent.id,
        agentRole: agent.role,
        agentName: agent.name,
        content: response.content,
      };
      
      updateTaskStatus(task.id, 'completed', response.content);
      onAgentResponse(agentResponse);
      
      return agentResponse;
    } catch (error) {
      updateTaskStatus(task.id, 'failed', undefined, String(error));
      console.error(`Agent ${agent.name} 执行失败:`, error);
      return null;
    }
  });
  
  const responses = (await Promise.all(responsePromises)).filter(Boolean) as AgentResponse[];
  
  // 生成整合总结
  const summary = await generateCollaborationSummary(responses, message);
  
  return {
    sessionId: session.id,
    mode: 'parallel',
    participants: responses.map(r => ({
      agentId: r.agentId,
      agentName: r.agentName,
      role: r.agentRole,
      contribution: r.content,
    })),
    summary: summary.summary,
    recommendations: summary.recommendations,
  };
}

/**
 * 生成协作总结
 */
async function generateCollaborationSummary(
  responses: AgentResponse[],
  originalQuestion: string
): Promise<{ summary: string; recommendations: string[] }> {
  const systemPrompt = `你是一个专业的总结助手，请根据多位专家的观点生成简洁的总结。`;
  
  const allResponses = responses.map(r => `[${r.agentName}]:\n${r.content}`).join('\n\n---\n\n');
  
  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `原始问题：${originalQuestion}\n\n各专家观点：\n${allResponses}\n\n请生成 JSON 格式的总结：
{
  "summary": "整体总结（2-3句话）",
  "recommendations": ["建议1", "建议2", "建议3"]
}` },
    ], { temperature: 0.3 });
    
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('生成总结失败:', error);
  }
  
  return {
    summary: '多位专家已从不同角度提供了分析和建议。',
    recommendations: ['请查看各专家的详细观点'],
  };
}

/**
 * 生成辩论总结
 */
async function generateDebateSummary(
  debateHistory: Array<AgentResponse & { round: number }>,
  topic: string,
  consensusReached: boolean
): Promise<{ 
  summary: string; 
  recommendations: string[]; 
  conflicts?: string[];
  consensus?: string;
}> {
  const systemPrompt = `你是一个专业的辩论总结助手，请根据辩论记录生成总结。`;
  
  const debateText = debateHistory
    .sort((a, b) => a.round - b.round)
    .map(r => `[第${r.round}轮 - ${r.agentName} - ${r.sentiment || '中立'}]:\n${r.content}`)
    .join('\n\n---\n\n');
  
  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `辩论主题：${topic}\n\n辩论记录：\n${debateText}\n\n是否达成共识：${consensusReached ? '是' : '否'}\n\n请生成 JSON 格式的辩论总结：
{
  "summary": "辩论总结",
  "consensus": "共识内容（如果达成）",
  "conflicts": ["分歧点1", "分歧点2"],
  "recommendations": ["建议1", "建议2"]
}` },
    ], { temperature: 0.3 });
    
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('生成辩论总结失败:', error);
  }
  
  return {
    summary: '辩论已结束，各专家表达了不同观点。',
    recommendations: ['请查看辩论详情'],
    conflicts: consensusReached ? undefined : ['存在意见分歧'],
    consensus: consensusReached ? '各方达成基本共识' : undefined,
  };
}

/**
 * 获取会话状态
 */
export function getSessionStatus(sessionId: string): MultiAgentSession | null {
  const row = db.prepare(`
    SELECT * FROM multi_agent_sessions WHERE id = ?
  `).get(sessionId) as {
    id: string;
    project_id: string;
    mode: string;
    status: string;
    triggered_by: string;
    participating_agents: string;
    current_agent_id: string | null;
    context: string;
    created_at: string;
    completed_at: string | null;
  } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode as CollaborationMode,
    status: row.status as 'active' | 'completed' | 'cancelled',
    triggeredBy: row.triggered_by,
    participatingAgents: JSON.parse(row.participating_agents),
    currentAgentId: row.current_agent_id || undefined,
    context: row.context,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

/**
 * 完成会话
 */
export function completeSession(sessionId: string): void {
  db.prepare(`
    UPDATE multi_agent_sessions 
    SET status = 'completed', completed_at = datetime('now')
    WHERE id = ?
  `).run(sessionId);
}
