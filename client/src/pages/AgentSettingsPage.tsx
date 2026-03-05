import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { 
  ArrowLeft,
  Bot,
  Plus,
  Settings,
  Trash2,
  Edit2,
  Power,
  PowerOff,
  Users,
  Workflow,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X
} from 'lucide-react';
import { agentApi } from '../services/api';
import clsx from 'clsx';

interface AgentPreset {
  role: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  capabilities: string[];
}

interface Agent {
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
  preset?: AgentPreset;
}

interface CollaborationConfig {
  projectId: string;
  mode: string;
  isEnabled: boolean;
  maxDebateRounds: number;
  debateThreshold: number;
  supervisorAgentId?: string;
  pipelineOrder: string[];
  autoTriggerKeywords: string[];
  consensusRequired: boolean;
}

const COLLABORATION_MODES = [
  { value: 'flexible', label: '灵活模式', description: '主管 Agent 动态决定协作方式' },
  { value: 'pipeline', label: '流水线模式', description: '多个 Agent 依次执行，逐步补充' },
  { value: 'debate', label: '辩论模式', description: '多个 Agent 辩论讨论，碰撞观点' },
  { value: 'parallel', label: '并行模式', description: '多个 Agent 同时回答，快速获取' },
];

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'local', label: '本地模型' },
  { value: 'custom', label: '自定义中转' },
];

export default function AgentSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [config, setConfig] = useState<CollaborationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Agent | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // 加载数据
  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsRes, presetsRes, configRes] = await Promise.all([
        agentApi.listProjectAgents(projectId!),
        agentApi.getPresets(),
        agentApi.getCollaborationConfig(projectId!),
      ]);
      
      if (agentsRes.data) setAgents(agentsRes.data);
      if (presetsRes.data) setPresets(presetsRes.data);
      if (configRes.data) setConfig(configRes.data);
    } catch (error) {
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 初始化默认团队
  const handleInitTeam = async () => {
    try {
      await agentApi.initTeam(projectId!);
      toast.success('已创建默认 Agent 团队');
      loadData();
    } catch (error: unknown) {
      toast.error((error as Error).message || '初始化失败');
    }
  };

  // 切换 Agent 激活状态
  const handleToggleActive = async (agent: Agent) => {
    try {
      await agentApi.updateAgent(agent.id, { isActive: !agent.isActive });
      setAgents(prev => prev.map(a => 
        a.id === agent.id ? { ...a, isActive: !a.isActive } : a
      ));
      toast.success(agent.isActive ? 'Agent 已停用' : 'Agent 已启用');
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 删除 Agent
  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('确定要删除这个 Agent 吗？')) return;
    
    try {
      await agentApi.deleteAgent(agentId);
      setAgents(prev => prev.filter(a => a.id !== agentId));
      toast.success('Agent 已删除');
    } catch (error) {
      toast.error('删除失败');
    }
  };

  // 更新协作配置
  const handleUpdateConfig = async (updates: Partial<CollaborationConfig>) => {
    if (!config) return;
    
    try {
      await agentApi.updateCollaborationConfig(projectId!, updates);
      setConfig(prev => prev ? { ...prev, ...updates } : prev);
      toast.success('配置已更新');
    } catch (error) {
      toast.error('更新失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* 头部 */}
      <header className="sticky top-0 z-10 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <Link to={`/project/${projectId}`} className="btn-ghost p-2">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Bot className="w-6 h-6 text-primary-500" />
                多 Agent 协作设置
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                配置和管理项目的 AI Agent 团队
              </p>
            </div>
          </div>
          
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            添加 Agent
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* 协作配置 */}
        <section className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-primary-500/10">
              <Workflow className="w-5 h-5 text-primary-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">协作模式</h2>
              <p className="text-sm text-[var(--text-muted)]">配置多 Agent 协作方式</p>
            </div>
            
            {config && (
              <label className="ml-auto flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-[var(--text-secondary)]">
                  {config.isEnabled ? '已启用' : '已禁用'}
                </span>
                <div 
                  className={clsx(
                    'relative w-12 h-6 rounded-full transition-colors',
                    config.isEnabled ? 'bg-primary-500' : 'bg-[var(--bg-tertiary)]'
                  )}
                  onClick={() => handleUpdateConfig({ isEnabled: !config.isEnabled })}
                >
                  <div 
                    className={clsx(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                      config.isEnabled ? 'translate-x-7' : 'translate-x-1'
                    )}
                  />
                </div>
              </label>
            )}
          </div>
          
          {config && (
            <div className="space-y-6">
              {/* 协作模式选择 */}
              <div className="grid grid-cols-2 gap-4">
                {COLLABORATION_MODES.map(mode => (
                  <button
                    key={mode.value}
                    onClick={() => handleUpdateConfig({ mode: mode.value })}
                    className={clsx(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      config.mode === mode.value
                        ? 'border-primary-500 bg-primary-500/5'
                        : 'border-[var(--border-color)] hover:border-primary-500/50'
                    )}
                  >
                    <div className="font-medium text-[var(--text-primary)]">{mode.label}</div>
                    <div className="text-sm text-[var(--text-muted)] mt-1">{mode.description}</div>
                  </button>
                ))}
              </div>
              
              {/* 高级配置 */}
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-[var(--border-color)]">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    辩论最大轮次
                  </label>
                  <input
                    type="number"
                    value={config.maxDebateRounds}
                    onChange={e => handleUpdateConfig({ maxDebateRounds: parseInt(e.target.value) })}
                    className="input w-full"
                    min={1}
                    max={10}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    自动触发关键词
                  </label>
                  <input
                    type="text"
                    value={config.autoTriggerKeywords.join(', ')}
                    onChange={e => handleUpdateConfig({ 
                      autoTriggerKeywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    className="input w-full"
                    placeholder="多个关键词用逗号分隔"
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Agent 列表 */}
        <section className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-accent-500/10">
              <Users className="w-5 h-5 text-accent-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Agent 团队</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {agents.length} 个 Agent，{agents.filter(a => a.isActive).length} 个活跃
              </p>
            </div>
          </div>
          
          {agents.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="w-16 h-16 mx-auto text-[var(--text-muted)] mb-4" />
              <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
                还没有配置 Agent
              </h3>
              <p className="text-[var(--text-muted)] mb-6">
                添加 Agent 来帮助分析和整理需求
              </p>
              <div className="flex justify-center gap-4">
                <button onClick={handleInitTeam} className="btn-primary">
                  <Sparkles className="w-4 h-4 mr-2" />
                  一键创建默认团队
                </button>
                <button onClick={() => setShowAddModal(true)} className="btn-secondary">
                  <Plus className="w-4 h-4 mr-2" />
                  手动添加
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isExpanded={expandedAgent === agent.id}
                  onToggleExpand={() => setExpandedAgent(
                    expandedAgent === agent.id ? null : agent.id
                  )}
                  onToggleActive={() => handleToggleActive(agent)}
                  onEdit={() => setShowEditModal(agent)}
                  onDelete={() => handleDeleteAgent(agent.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 添加 Agent 弹窗 */}
      {showAddModal && (
        <AddAgentModal
          presets={presets}
          projectId={projectId!}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadData();
          }}
        />
      )}

      {/* 编辑 Agent 弹窗 */}
      {showEditModal && (
        <EditAgentModal
          agent={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSuccess={() => {
            setShowEditModal(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// Agent 卡片组件
function AgentCard({
  agent,
  isExpanded,
  onToggleExpand,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const preset = agent.preset;
  
  return (
    <div 
      className={clsx(
        'rounded-xl border-2 transition-all overflow-hidden',
        agent.isActive 
          ? 'border-[var(--border-color)] bg-[var(--bg-secondary)]' 
          : 'border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] opacity-60'
      )}
    >
      <div className="flex items-center gap-4 p-4">
        {/* 头像 */}
        <div 
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: `${preset?.color || '#6366F1'}20` }}
        >
          {preset?.icon || '🤖'}
        </div>
        
        {/* 信息 */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--text-primary)]">{agent.name}</h3>
            <span 
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ 
                backgroundColor: `${preset?.color || '#6366F1'}20`,
                color: preset?.color || '#6366F1'
              }}
            >
              {preset?.name || agent.role}
            </span>
            {!agent.isActive && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                已停用
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {preset?.description || '自定义 Agent'}
          </p>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleActive}
            className={clsx(
              'p-2 rounded-lg transition-colors',
              agent.isActive 
                ? 'text-emerald-500 hover:bg-emerald-500/10' 
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
            )}
            title={agent.isActive ? '停用' : '启用'}
          >
            {agent.isActive ? <Power className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
          </button>
          <button
            onClick={onEdit}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="编辑"
          >
            <Edit2 className="w-5 h-5" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
            title="删除"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleExpand}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>
      
      {/* 展开详情 */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[var(--border-color)] space-y-4">
          {/* 能力标签 */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              能力
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {agent.capabilities.map(cap => (
                <span 
                  key={cap}
                  className="px-3 py-1 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
          
          {/* 配置信息 */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                LLM 提供商
              </label>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                {LLM_PROVIDERS.find(p => p.value === agent.provider)?.label || agent.provider}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                温度
              </label>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                {agent.temperature}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                最大 Token
              </label>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                {agent.maxTokens}
              </div>
            </div>
          </div>
          
          {/* 系统提示词预览 */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              系统提示词
            </label>
            <div className="mt-2 p-3 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] max-h-32 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {agent.systemPrompt?.slice(0, 500)}
                {agent.systemPrompt?.length > 500 && '...'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 添加 Agent 弹窗
function AddAgentModal({
  presets,
  projectId,
  onClose,
  onSuccess,
}: {
  presets: AgentPreset[];
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [provider, setProvider] = useState('openai');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!selectedRole) {
      toast.error('请选择 Agent 角色');
      return;
    }
    
    setLoading(true);
    try {
      await agentApi.createAgent(projectId, {
        role: selectedRole,
        name: customName || undefined,
        provider,
      });
      toast.success('Agent 已创建');
      onSuccess();
    } catch (error) {
      toast.error('创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">添加 Agent</h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* 角色选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">
            选择角色
          </label>
          <div className="grid grid-cols-2 gap-3">
            {presets.map(preset => (
              <button
                key={preset.role}
                onClick={() => setSelectedRole(preset.role)}
                className={clsx(
                  'p-4 rounded-xl border-2 text-left transition-all',
                  selectedRole === preset.role
                    ? 'border-primary-500 bg-primary-500/5'
                    : 'border-[var(--border-color)] hover:border-primary-500/50'
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{preset.icon}</span>
                  <span className="font-medium text-[var(--text-primary)]">{preset.name}</span>
                </div>
                <p className="text-sm text-[var(--text-muted)]">{preset.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {preset.capabilities.slice(0, 3).map(cap => (
                    <span 
                      key={cap}
                      className="px-2 py-0.5 rounded-full text-xs"
                      style={{ backgroundColor: `${preset.color}20`, color: preset.color }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
        
        {/* 自定义配置 */}
        {selectedRole && (
          <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                自定义名称（可选）
              </label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder={presets.find(p => p.role === selectedRole)?.name}
                className="input w-full"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                LLM 提供商
              </label>
              <select
                value={provider}
                onChange={e => setProvider(e.target.value)}
                className="input w-full"
              >
                {LLM_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button 
            onClick={handleCreate} 
            className="btn-primary"
            disabled={!selectedRole || loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// 编辑 Agent 弹窗
function EditAgentModal({
  agent,
  onClose,
  onSuccess,
}: {
  agent: Agent;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [provider, setProvider] = useState(agent.provider);
  const [model, setModel] = useState(agent.model);
  const [temperature, setTemperature] = useState(agent.temperature);
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await agentApi.updateAgent(agent.id, {
        name,
        provider,
        model,
        temperature,
        maxTokens,
        systemPrompt,
      });
      toast.success('Agent 已更新');
      onSuccess();
    } catch (error) {
      toast.error('更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <span className="text-2xl">{agent.preset?.icon || '🤖'}</span>
            编辑 {agent.name}
          </h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              名称
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input w-full"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                LLM 提供商
              </label>
              <select
                value={provider}
                onChange={e => setProvider(e.target.value)}
                className="input w-full"
              >
                {LLM_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                模型
              </label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="留空使用默认模型"
                className="input w-full"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                温度 ({temperature})
              </label>
              <input
                type="range"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                min={0}
                max={2}
                step={0.1}
                className="w-full"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                最大 Token
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value))}
                min={100}
                max={8000}
                className="input w-full"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              系统提示词
            </label>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="input w-full h-64 font-mono text-sm"
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button 
            onClick={handleSave} 
            className="btn-primary"
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
