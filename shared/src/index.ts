// ==================== 用户相关类型 ====================

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthPayload {
  email: string;
  code: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

// ==================== 项目相关类型 ====================

export type ProjectVisibility = 'public' | 'private';

export type UserRole = 'admin' | 'creator' | 'member' | 'guest';

export interface Project {
  id: string;
  name: string;
  description: string;
  visibility: ProjectVisibility;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: UserRole;
  joinedAt: Date;
}

export interface Invitation {
  id: string;
  projectId: string;
  code: string;
  createdBy: string;
  expiresAt: Date;
  maxUses?: number;
  usedCount: number;
  createdAt: Date;
}

// ==================== 聊天相关类型 ====================

export type MessageType = 'user' | 'agent' | 'system';

export interface Message {
  id: string;
  projectId: string;
  userId?: string;
  type: MessageType;
  content: string;
  replyTo?: string;
  tags: string[];
  isFiltered: boolean;
  filterReason?: string;
  createdAt: Date;
}

export interface ChatRoom {
  projectId: string;
  onlineUsers: string[];
  messageCount: number;
}

// ==================== 需求标签相关类型 ====================

export type RequirementCategory = 
  | 'feature'      // 功能需求
  | 'technical'    // 技术需求
  | 'ui'           // UI需求
  | 'operation'    // 运营需求
  | 'bug'          // Bug修复
  | 'improvement'  // 改进建议
  | 'other';       // 其他

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  category: RequirementCategory;
  createdAt: Date;
}

export interface MessageTag {
  messageId: string;
  tagId: string;
}

// ==================== 投票相关类型 ====================

export type VoteType = 'up' | 'down';

export interface Vote {
  id: string;
  messageId: string;
  userId: string;
  type: VoteType;
  createdAt: Date;
}

export interface VoteSummary {
  messageId: string;
  upvotes: number;
  downvotes: number;
  score: number;
}

// ==================== 文档相关类型 ====================

export type DocumentType = 
  | 'prd'           // 产品需求文档
  | 'tech_design'   // 技术设计方案
  | 'api_doc'       // API接口文档
  | 'db_design'     // 数据库设计
  | 'test_case'     // 测试用例
  | 'operation'     // 运营方案
  | 'user_manual';  // 用户手册

export interface Document {
  id: string;
  projectId: string;
  type: DocumentType;
  title: string;
  content: string;
  version: number;
  generatedBy: string; // agent or user id
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentExport {
  id: string;
  documentId: string;
  format: 'markdown' | 'pdf';
  filePath: string;
  createdAt: Date;
}

// ==================== 内容过滤相关类型 ====================

export type FilterStatus = 'pending' | 'filtered' | 'approved' | 'restored';

export interface FilteredContent {
  id: string;
  messageId: string;
  status: FilterStatus;
  reason: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
}

export interface FilterConfig {
  projectId: string;
  filterOffTopic: boolean;
  filterNoise: boolean;
  customKeywords: string[];
  strictness: 'low' | 'medium' | 'high';
}

// ==================== Agent 相关类型 ====================

export type AgentRole = 
  | 'general'       // 通用 Agent
  | 'product'       // 产品 Agent
  | 'technical'     // 技术 Agent
  | 'operation'     // 运营 Agent
  | 'design'        // 设计 Agent
  | 'testing'       // 测试 Agent
  | 'supervisor';   // 主管 Agent

export type LLMProvider = 'openai' | 'claude' | 'deepseek' | 'local' | 'custom';

export interface AgentConfig {
  id: string;
  projectId: string;
  role: AgentRole;
  name: string;           // Agent 显示名称
  avatar?: string;        // Agent 头像
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  priority: number;       // Agent 优先级（用于排序）
  capabilities: string[]; // Agent 能力标签
  createdAt?: Date;
  updatedAt?: Date;
}

// ==================== 多 Agent 协作类型 ====================

export type CollaborationMode = 
  | 'pipeline'    // 流水线模式：依次执行
  | 'debate'      // 辩论模式：多个 Agent 讨论
  | 'parallel'    // 并行模式：同时执行
  | 'flexible';   // 灵活模式：主管 Agent 动态调度

export type AgentTaskStatus = 
  | 'pending'     // 等待中
  | 'running'     // 执行中
  | 'completed'   // 已完成
  | 'failed'      // 失败
  | 'skipped';    // 跳过

export interface MultiAgentSession {
  id: string;
  projectId: string;
  mode: CollaborationMode;
  status: 'active' | 'completed' | 'cancelled';
  triggeredBy: string;          // 触发消息 ID
  participatingAgents: string[]; // 参与的 Agent ID 列表
  currentAgentId?: string;       // 当前执行的 Agent
  context: string;               // 共享上下文
  createdAt: Date;
  completedAt?: Date;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  agentId: string;
  status: AgentTaskStatus;
  input: string;
  output?: string;
  order: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface AgentMessage {
  id: string;
  sessionId?: string;
  projectId: string;
  agentId: string;
  agentRole: AgentRole;
  agentName: string;
  content: string;
  replyTo?: string;
  isDebate?: boolean;       // 是否是辩论消息
  debateRound?: number;     // 辩论轮次
  sentiment?: 'agree' | 'disagree' | 'neutral'; // 辩论立场
  createdAt: Date;
}

export interface CollaborationConfig {
  projectId: string;
  mode: CollaborationMode;
  isEnabled: boolean;
  maxDebateRounds: number;       // 辩论最大轮次
  debateThreshold: number;       // 触发辩论的分歧阈值
  supervisorAgentId?: string;    // 主管 Agent ID
  pipelineOrder: string[];       // 流水线执行顺序（Agent ID 列表）
  autoTriggerKeywords: string[]; // 自动触发多 Agent 的关键词
  consensusRequired: boolean;    // 是否需要达成共识
}

// 预定义 Agent 角色配置
export interface AgentRolePreset {
  role: AgentRole;
  name: string;
  icon: string;
  color: string;
  description: string;
  defaultPrompt: string;
  capabilities: string[];
}

// Agent 协作结果
export interface CollaborationResult {
  sessionId: string;
  mode: CollaborationMode;
  participants: Array<{
    agentId: string;
    agentName: string;
    role: AgentRole;
    contribution: string;
  }>;
  consensus?: string;           // 共识结论
  summary: string;              // 总结
  recommendations: string[];    // 建议列表
  conflicts?: string[];         // 冲突点（辩论模式）
}

// ==================== WebSocket 消息类型 ====================

export type WSMessageType = 
  | 'join_room'
  | 'leave_room'
  | 'send_message'
  | 'message_received'
  | 'user_joined'
  | 'user_left'
  | 'typing'
  | 'stop_typing'
  | 'vote'
  | 'vote_update'
  | 'agent_response'
  | 'error'
  // 多 Agent 协作消息类型
  | 'multi_agent_start'        // 多 Agent 协作开始
  | 'multi_agent_progress'     // 多 Agent 协作进度
  | 'multi_agent_agent_turn'   // Agent 轮到发言
  | 'multi_agent_agent_reply'  // Agent 回复
  | 'multi_agent_debate'       // 辩论消息
  | 'multi_agent_consensus'    // 达成共识
  | 'multi_agent_complete'     // 多 Agent 协作完成
  | 'multi_agent_error';       // 多 Agent 协作错误

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
  timestamp: number;
}

export interface JoinRoomPayload {
  projectId: string;
  userId: string;
}

export interface SendMessagePayload {
  projectId: string;
  content: string;
  replyTo?: string;
  tags?: string[];
}

export interface TypingPayload {
  projectId: string;
  userId: string;
  nickname: string;
}

// ==================== API 响应类型 ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== 文档生成触发类型 ====================

export type GenerationTrigger = 'manual' | 'auto_threshold' | 'scheduled';

export interface GenerationTask {
  id: string;
  projectId: string;
  documentType: DocumentType;
  trigger: GenerationTrigger;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
