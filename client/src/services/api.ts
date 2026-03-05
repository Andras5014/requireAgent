import { useAuthStore } from '../stores/auth';
import type { ApiResponse, PaginatedResponse } from '@requireagent/shared';

const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  
  return data;
}

// Auth API
export const authApi = {
  sendCode: (email: string) =>
    request<ApiResponse>('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
    
  verify: (email: string, code: string) =>
    request<ApiResponse<{ user: unknown; token: string }>>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
    
  getMe: () => request<ApiResponse<unknown>>('/auth/me'),
  
  updateMe: (data: { nickname?: string; avatar?: string }) =>
    request<ApiResponse<unknown>>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Project API
export const projectApi = {
  list: (page = 1, pageSize = 20) =>
    request<ApiResponse<PaginatedResponse<unknown>>>(`/projects?page=${page}&pageSize=${pageSize}`),
    
  get: (id: string) =>
    request<ApiResponse<unknown>>(`/projects/${id}`),
    
  create: (data: { name: string; description?: string; visibility?: string }) =>
    request<ApiResponse<unknown>>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    
  update: (id: string, data: { name?: string; description?: string; visibility?: string }) =>
    request<ApiResponse<unknown>>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    
  delete: (id: string) =>
    request<ApiResponse>(`/projects/${id}`, { method: 'DELETE' }),
    
  getMembers: (id: string) =>
    request<ApiResponse<unknown[]>>(`/projects/${id}/members`),
    
  getTags: (id: string) =>
    request<ApiResponse<unknown[]>>(`/projects/${id}/tags`),
    
  createTag: (projectId: string, data: { name: string; color?: string; category?: string }) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/tags`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Invitation API
export const invitationApi = {
  create: (projectId: string, data?: { maxUses?: number; expiresIn?: number }) =>
    request<ApiResponse<{ code: string; inviteLink: string }>>(`/projects/${projectId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
    
  list: (projectId: string) =>
    request<ApiResponse<unknown[]>>(`/projects/${projectId}/invitations`),
    
  preview: (inviteCode: string) =>
    request<ApiResponse<{ projectName: string; projectDescription: string; isValid: boolean }>>(`/projects/preview/${inviteCode}`),
    
  join: (inviteCode: string) =>
    request<ApiResponse<{ project: unknown }>>(`/projects/join/${inviteCode}`, {
      method: 'POST',
    }),
};

// Message API
export const messageApi = {
  list: (projectId: string, page = 1, pageSize = 50, includeFiltered = false) =>
    request<ApiResponse<PaginatedResponse<unknown>>>(`/projects/${projectId}/messages?page=${page}&pageSize=${pageSize}&includeFiltered=${includeFiltered}`),
    
  send: (projectId: string, data: { content: string; replyTo?: string; tags?: string[] }) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    
  vote: (projectId: string, messageId: string, type: 'up' | 'down') =>
    request<ApiResponse<{ upvotes: number; downvotes: number; score: number; userVote: string | null }>>(`/projects/${projectId}/messages/${messageId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
    
  addTags: (projectId: string, messageId: string, tags: string[]) =>
    request<ApiResponse>(`/projects/${projectId}/messages/${messageId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    }),
    
  getTop: (projectId: string, limit = 10) =>
    request<ApiResponse<unknown[]>>(`/projects/${projectId}/messages/top?limit=${limit}`),
    
  filter: (projectId: string, messageId: string, reason?: string) =>
    request<ApiResponse>(`/projects/${projectId}/messages/${messageId}/filter`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
    
  restore: (projectId: string, messageId: string) =>
    request<ApiResponse>(`/projects/${projectId}/messages/${messageId}/restore`, {
      method: 'POST',
    }),
    
  getFiltered: (projectId: string) =>
    request<ApiResponse<unknown[]>>(`/projects/${projectId}/filtered-messages`),
    
  generateSummary: (projectId: string) =>
    request<ApiResponse<{ 
      id: string; 
      summary: string; 
      messageCount: number; 
      generatedAt: string;
    }>>(`/projects/${projectId}/messages/summary`, {
      method: 'POST',
    }),
};

// Document API
export const documentApi = {
  list: (projectId: string, type?: string) =>
    request<ApiResponse<unknown[]>>(`/projects/${projectId}/documents${type ? `?type=${type}` : ''}`),
    
  get: (projectId: string, documentId: string) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/documents/${documentId}`),
    
  generate: (projectId: string, type: string, provider?: string) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/documents/generate`, {
      method: 'POST',
      body: JSON.stringify({ type, provider }),
    }),
    
  update: (projectId: string, documentId: string, data: { content: string; title?: string }) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    
  delete: (projectId: string, documentId: string) =>
    request<ApiResponse>(`/projects/${projectId}/documents/${documentId}`, { method: 'DELETE' }),
    
  export: (projectId: string, documentId: string, format: 'markdown' | 'pdf') =>
    request<ApiResponse<{ format: string; downloadUrl: string }>>(`/projects/${projectId}/documents/${documentId}/export`, {
      method: 'POST',
      body: JSON.stringify({ format }),
    }),
    
  getFilterConfig: (projectId: string) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/filter-config`),
    
  updateFilterConfig: (projectId: string, data: unknown) =>
    request<ApiResponse<unknown>>(`/projects/${projectId}/filter-config`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Agent API
export const agentApi = {
  // 获取所有可用的 Agent 角色预设
  getPresets: () =>
    request<ApiResponse<Array<{
      role: string;
      name: string;
      icon: string;
      color: string;
      description: string;
      capabilities: string[];
    }>>>('/agents/presets'),
  
  // 获取项目的所有 Agent
  listProjectAgents: (projectId: string) =>
    request<ApiResponse<Array<{
      id: string;
      projectId: string;
      role: string;
      name: string;
      provider: string;
      model: string;
      systemPrompt: string;
      temperature: number;
      maxTokens: number;
      isActive: boolean;
      priority: number;
      capabilities: string[];
      preset?: {
        role: string;
        name: string;
        icon: string;
        color: string;
        description: string;
        capabilities: string[];
      };
    }>>>(`/agents/project/${projectId}`),
  
  // 创建 Agent
  createAgent: (projectId: string, data: {
    role: string;
    name?: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    priority?: number;
    capabilities?: string[];
  }) =>
    request<ApiResponse<unknown>>(`/agents/project/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  // 初始化默认 Agent 团队
  initTeam: (projectId: string) =>
    request<ApiResponse<unknown[]>>(`/agents/project/${projectId}/init-team`, {
      method: 'POST',
    }),
  
  // 更新 Agent
  updateAgent: (agentId: string, data: {
    name?: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    isActive?: boolean;
    priority?: number;
    capabilities?: string[];
  }) =>
    request<ApiResponse<unknown>>(`/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  // 删除 Agent
  deleteAgent: (agentId: string) =>
    request<ApiResponse>(`/agents/${agentId}`, { method: 'DELETE' }),
  
  // 获取协作配置
  getCollaborationConfig: (projectId: string) =>
    request<ApiResponse<{
      projectId: string;
      mode: string;
      isEnabled: boolean;
      maxDebateRounds: number;
      debateThreshold: number;
      supervisorAgentId?: string;
      pipelineOrder: string[];
      autoTriggerKeywords: string[];
      consensusRequired: boolean;
    }>>(`/agents/project/${projectId}/collaboration`),
  
  // 更新协作配置
  updateCollaborationConfig: (projectId: string, data: {
    mode?: string;
    isEnabled?: boolean;
    maxDebateRounds?: number;
    debateThreshold?: number;
    supervisorAgentId?: string;
    pipelineOrder?: string[];
    autoTriggerKeywords?: string[];
    consensusRequired?: boolean;
  }) =>
    request<ApiResponse<unknown>>(`/agents/project/${projectId}/collaboration`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  // 手动触发多 Agent 协作
  triggerCollaboration: (projectId: string, data: {
    messageId?: string;
    content: string;
    context?: string[];
    mode?: string;
    agents?: string[];
  }) =>
    request<ApiResponse<{
      sessionId: string;
      mode: string;
      participants: Array<{
        agentId: string;
        agentName: string;
        role: string;
        contribution: string;
      }>;
      consensus?: string;
      summary: string;
      recommendations: string[];
      conflicts?: string[];
    }>>(`/agents/project/${projectId}/collaborate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  // 获取 Agent 消息历史
  getAgentMessages: (projectId: string, options?: { sessionId?: string; limit?: number; offset?: number }) =>
    request<ApiResponse<Array<{
      id: string;
      sessionId?: string;
      projectId: string;
      agentId: string;
      agentRole: string;
      agentName: string;
      content: string;
      replyTo?: string;
      isDebate?: boolean;
      debateRound?: number;
      sentiment?: string;
      createdAt: string;
    }>>>(`/agents/project/${projectId}/messages?${new URLSearchParams(options as Record<string, string>).toString()}`),
  
  // 快速 Agent 回复
  quickReply: (agentId: string, message: string, context?: string[]) =>
    request<ApiResponse<{ reply: string }>>(`/agents/${agentId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    }),
};