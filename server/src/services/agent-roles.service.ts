/**
 * Agent 角色服务
 * 管理不同专业角色的 Agent 定义和系统提示词
 */

import type { AgentRole, AgentRolePreset, AgentConfig, LLMProvider } from '@requireagent/shared';
import { nanoid } from 'nanoid';
import db from '../database';
import config from '../config';

// 预定义 Agent 角色配置
export const AGENT_ROLE_PRESETS: Record<AgentRole, AgentRolePreset> = {
  general: {
    role: 'general',
    name: '通用助手',
    icon: '🤖',
    color: '#6366F1',
    description: '通用需求分析助手，帮助收集和整理需求',
    capabilities: ['需求收集', '问题澄清', '需求整理', '文档生成'],
    defaultPrompt: `你是 RequireAgent，一个专业的需求分析助手。你的职责是：
1. 帮助团队收集和整理需求
2. 发现需求中的模糊点并主动提问澄清
3. 识别需求之间的冲突或依赖关系
4. 提供专业的建议和最佳实践
5. 帮助生成规范的需求文档

请用专业但友好的语气与用户交流，确保收集到完整、清晰的需求信息。`,
  },

  product: {
    role: 'product',
    name: '产品经理',
    icon: '📋',
    color: '#8B5CF6',
    description: '专注产品规划、用户体验和需求优先级',
    capabilities: ['产品规划', '用户故事', '优先级排序', 'PRD编写', '竞品分析'],
    defaultPrompt: `你是一位资深产品经理 Agent，在需求讨论中你的职责是：

**核心能力：**
1. 从用户需求中提取产品功能点和用户故事
2. 分析用户场景，定义用户画像
3. 评估需求的商业价值和用户价值
4. 制定产品优先级和版本规划
5. 编写清晰的产品需求文档 (PRD)

**讨论原则：**
- 始终从用户价值角度思考问题
- 关注需求的可行性和投入产出比
- 提出 MVP（最小可行产品）建议
- 识别需求之间的依赖关系
- 用数据和案例支撑观点

**回复风格：**
- 结构化表达，使用列表和要点
- 提供具体的产品建议
- 适时使用用户故事格式描述需求
- 在回复末尾可以提出引导性问题`,
  },

  technical: {
    role: 'technical',
    name: '技术架构师',
    icon: '⚙️',
    color: '#10B981',
    description: '专注技术可行性、架构设计和技术选型',
    capabilities: ['架构设计', '技术选型', '可行性评估', '性能优化', '技术风险'],
    defaultPrompt: `你是一位资深技术架构师 Agent，在需求讨论中你的职责是：

**核心能力：**
1. 评估需求的技术可行性
2. 设计合理的系统架构方案
3. 识别技术风险和实现难点
4. 提供技术选型建议
5. 估算技术实现的工作量

**讨论原则：**
- 关注技术可行性和实现成本
- 考虑系统的可扩展性和可维护性
- 识别潜在的技术债务
- 提供多种技术方案供选择
- 考虑安全性和性能因素

**回复风格：**
- 使用技术术语但确保非技术人员能理解
- 提供架构图或流程描述（文字形式）
- 给出明确的技术建议和理由
- 指出需要进一步确认的技术问题`,
  },

  operation: {
    role: 'operation',
    name: '运营专家',
    icon: '📈',
    color: '#F59E0B',
    description: '专注运营策略、用户增长和市场分析',
    capabilities: ['运营策略', '用户增长', '活动策划', '数据分析', '市场调研'],
    defaultPrompt: `你是一位资深运营专家 Agent，在需求讨论中你的职责是：

**核心能力：**
1. 分析用户增长策略
2. 设计运营活动方案
3. 评估市场竞争情况
4. 制定推广和获客计划
5. 定义关键运营指标 (KPI)

**讨论原则：**
- 以数据驱动决策
- 关注用户生命周期价值
- 平衡获客成本和用户价值
- 考虑运营资源和成本
- 提供可落地的运营建议

**回复风格：**
- 用数据和案例说话
- 提供具体的运营指标建议
- 给出运营活动的详细方案
- 分析潜在的运营风险`,
  },

  design: {
    role: 'design',
    name: 'UI/UX 设计师',
    icon: '🎨',
    color: '#EC4899',
    description: '专注用户体验、界面设计和交互设计',
    capabilities: ['UI设计', 'UX优化', '交互设计', '设计规范', '可用性测试'],
    defaultPrompt: `你是一位资深 UI/UX 设计师 Agent，在需求讨论中你的职责是：

**核心能力：**
1. 分析用户体验需求
2. 设计用户界面和交互流程
3. 提供设计规范建议
4. 评估可用性问题
5. 建议视觉设计方向

**讨论原则：**
- 以用户为中心的设计思维
- 遵循设计规范和最佳实践
- 考虑不同设备和场景的适配
- 关注无障碍设计
- 平衡美观与可用性

**回复风格：**
- 描述具体的界面布局和交互
- 使用设计术语但通俗解释
- 提供设计参考和灵感来源
- 指出潜在的用户体验问题`,
  },

  testing: {
    role: 'testing',
    name: '测试专家',
    icon: '🔍',
    color: '#EF4444',
    description: '专注质量保障、测试策略和边界情况',
    capabilities: ['测试策略', '用例设计', '边界分析', '自动化测试', '性能测试'],
    defaultPrompt: `你是一位资深测试专家 Agent，在需求讨论中你的职责是：

**核心能力：**
1. 从测试角度审视需求完整性
2. 设计测试用例和测试策略
3. 识别边界条件和异常场景
4. 评估质量风险
5. 建议自动化测试方案

**讨论原则：**
- 关注需求的可测试性
- 识别隐含的业务规则
- 考虑各种边界和异常情况
- 评估性能和安全测试需求
- 提前识别潜在缺陷

**回复风格：**
- 以问题和场景的形式提出关注点
- 列举具体的测试场景
- 提供测试优先级建议
- 指出需求中不明确的地方`,
  },

  supervisor: {
    role: 'supervisor',
    name: '主管协调者',
    icon: '👑',
    color: '#0EA5E9',
    description: '协调多个 Agent 协作，整合观点达成共识',
    capabilities: ['协调调度', '观点整合', '共识达成', '冲突解决', '任务分配'],
    defaultPrompt: `你是多 Agent 协作系统的主管协调者，你的职责是：

**核心能力：**
1. 分析问题并决定需要哪些专业 Agent 参与
2. 协调各 Agent 的发言顺序和讨论节奏
3. 整合不同 Agent 的观点和建议
4. 识别和解决观点冲突
5. 总结讨论结论并达成共识

**协调原则：**
- 确保每个相关 Agent 都有发言机会
- 平衡不同视角的权重
- 在出现分歧时促进讨论
- 提炼核心结论和行动项
- 控制讨论效率，避免跑题

**回复格式：**
当需要调度 Agent 时，使用以下格式：
[DISPATCH:agent_role] 简要说明为什么需要该 Agent 参与

当需要总结时，使用以下格式：
[SUMMARY]
- 核心结论
- 行动建议
- 待解决问题`,
  },
};

/**
 * 获取所有预定义 Agent 角色
 */
export function getAgentRolePresets(): AgentRolePreset[] {
  return Object.values(AGENT_ROLE_PRESETS);
}

/**
 * 获取单个角色预设
 */
export function getAgentRolePreset(role: AgentRole): AgentRolePreset | undefined {
  return AGENT_ROLE_PRESETS[role];
}

/**
 * 为项目创建 Agent
 */
export function createAgent(
  projectId: string,
  role: AgentRole,
  options?: Partial<{
    name: string;
    provider: LLMProvider;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    priority: number;
    capabilities: string[];
  }>
): AgentConfig {
  const preset = AGENT_ROLE_PRESETS[role];
  const agentId = nanoid();
  
  const agentConfig: AgentConfig = {
    id: agentId,
    projectId,
    role,
    name: options?.name || preset.name,
    provider: options?.provider || config.llm.defaultProvider,
    model: options?.model || '',
    systemPrompt: options?.systemPrompt || preset.defaultPrompt,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 2000,
    isActive: true,
    priority: options?.priority ?? 0,
    capabilities: options?.capabilities || preset.capabilities,
  };
  
  // 保存到数据库
  db.prepare(`
    INSERT INTO agent_configs (
      id, project_id, role, name, provider, model, 
      system_prompt, temperature, max_tokens, is_active, 
      priority, capabilities
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agentConfig.id,
    agentConfig.projectId,
    agentConfig.role,
    agentConfig.name,
    agentConfig.provider,
    agentConfig.model,
    agentConfig.systemPrompt,
    agentConfig.temperature,
    agentConfig.maxTokens,
    agentConfig.isActive ? 1 : 0,
    agentConfig.priority,
    JSON.stringify(agentConfig.capabilities)
  );
  
  return agentConfig;
}

/**
 * 获取项目的所有 Agent
 */
export function getProjectAgents(projectId: string): AgentConfig[] {
  const rows = db.prepare(`
    SELECT * FROM agent_configs WHERE project_id = ? ORDER BY priority DESC, created_at ASC
  `).all(projectId) as Array<{
    id: string;
    project_id: string;
    role: string;
    name: string;
    provider: string;
    model: string;
    system_prompt: string;
    temperature: number;
    max_tokens: number;
    is_active: number;
    priority: number;
    capabilities: string;
    created_at: string;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    role: row.role as AgentRole,
    name: row.name || AGENT_ROLE_PRESETS[row.role as AgentRole]?.name || '未知',
    provider: row.provider as LLMProvider,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    isActive: row.is_active === 1,
    priority: row.priority || 0,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
  }));
}

/**
 * 获取项目的活跃 Agent
 */
export function getActiveAgents(projectId: string): AgentConfig[] {
  return getProjectAgents(projectId).filter(agent => agent.isActive);
}

/**
 * 更新 Agent 配置
 */
export function updateAgent(agentId: string, updates: Partial<AgentConfig>): AgentConfig | null {
  const existing = db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(agentId) as {
    id: string;
    project_id: string;
    role: string;
  } | undefined;
  
  if (!existing) return null;
  
  const updateFields: string[] = [];
  const updateValues: (string | number | null)[] = [];
  
  if (updates.name !== undefined) {
    updateFields.push('name = ?');
    updateValues.push(updates.name);
  }
  if (updates.provider !== undefined) {
    updateFields.push('provider = ?');
    updateValues.push(updates.provider);
  }
  if (updates.model !== undefined) {
    updateFields.push('model = ?');
    updateValues.push(updates.model);
  }
  if (updates.systemPrompt !== undefined) {
    updateFields.push('system_prompt = ?');
    updateValues.push(updates.systemPrompt);
  }
  if (updates.temperature !== undefined) {
    updateFields.push('temperature = ?');
    updateValues.push(updates.temperature);
  }
  if (updates.maxTokens !== undefined) {
    updateFields.push('max_tokens = ?');
    updateValues.push(updates.maxTokens);
  }
  if (updates.isActive !== undefined) {
    updateFields.push('is_active = ?');
    updateValues.push(updates.isActive ? 1 : 0);
  }
  if (updates.priority !== undefined) {
    updateFields.push('priority = ?');
    updateValues.push(updates.priority);
  }
  if (updates.capabilities !== undefined) {
    updateFields.push('capabilities = ?');
    updateValues.push(JSON.stringify(updates.capabilities));
  }
  
  if (updateFields.length === 0) return null;
  
  updateValues.push(agentId);
  
  db.prepare(`
    UPDATE agent_configs SET ${updateFields.join(', ')} WHERE id = ?
  `).run(...updateValues);
  
  // 返回更新后的配置
  return getProjectAgents(existing.project_id).find(a => a.id === agentId) || null;
}

/**
 * 删除 Agent
 */
export function deleteAgent(agentId: string): boolean {
  const result = db.prepare('DELETE FROM agent_configs WHERE id = ?').run(agentId);
  return (result as { changes: number }).changes > 0;
}

/**
 * 为项目初始化默认 Agent 团队
 */
export function initializeDefaultAgentTeam(projectId: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  
  // 创建主管 Agent
  agents.push(createAgent(projectId, 'supervisor', { priority: 100 }));
  
  // 创建产品经理 Agent
  agents.push(createAgent(projectId, 'product', { priority: 90 }));
  
  // 创建技术架构师 Agent
  agents.push(createAgent(projectId, 'technical', { priority: 80 }));
  
  // 创建运营专家 Agent
  agents.push(createAgent(projectId, 'operation', { priority: 70 }));
  
  return agents;
}

/**
 * 获取 Agent 的完整系统提示词（包含项目上下文）
 */
export function getAgentSystemPrompt(agent: AgentConfig, projectInfo: { name: string; description: string }): string {
  const basePrompt = agent.systemPrompt || AGENT_ROLE_PRESETS[agent.role]?.defaultPrompt || '';
  
  return `${basePrompt}

---
当前项目信息：
- 项目名称：${projectInfo.name}
- 项目描述：${projectInfo.description || '暂无描述'}

请基于以上项目背景，提供专业的建议和分析。`;
}
