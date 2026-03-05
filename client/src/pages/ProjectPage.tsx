import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { 
  Send, 
  Users, 
  FileText, 
  Settings, 
  ThumbsUp, 
  ThumbsDown,
  Tag,
  Bot,
  User,
  Loader2,
  ArrowLeft,
  Link2,
  Copy,
  Check,
  Sparkles,
  MessageSquare,
  ListChecks,
  X
} from 'lucide-react';
import { projectApi, messageApi, invitationApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuthStore } from '../stores/auth';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import clsx from 'clsx';

interface Message {
  id: string;
  content: string;
  type: 'user' | 'agent' | 'system';
  user_id?: string;
  user_nickname?: string;
  user_avatar?: string;
  tags?: string[];
  upvotes?: number;
  downvotes?: number;
  user_vote?: string;
  created_at: string;
  // 多 Agent 相关字段
  agentId?: string;
  agentRole?: string;
  agentName?: string;
  isDebate?: boolean;
  debateRound?: number;
  sentiment?: string;
  isSummary?: boolean;
}

interface Project {
  id: string;
  name: string;
  description: string;
  visibility: string;
  userRole?: string;
}

interface OnlineUser {
  userId: string;
  nickname: string;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summary, setSummary] = useState<{ content: string; messageCount: number; generatedAt: string } | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const { user } = useAuthStore();
  
  // 加载项目数据
  useEffect(() => {
    if (!projectId) return;
    
    const loadProject = async () => {
      try {
        const [projectRes, messagesRes, tagsRes] = await Promise.all([
          projectApi.get(projectId),
          messageApi.list(projectId),
          projectApi.getTags(projectId),
        ]);
        
        if (projectRes.data) setProject(projectRes.data as Project);
        if (messagesRes.data) setMessages((messagesRes.data as { items: Message[] }).items);
        if (tagsRes.data) setTags(tagsRes.data as { id: string; name: string; color: string }[]);
      } catch (error) {
        toast.error('加载项目失败');
      } finally {
        setLoading(false);
      }
    };
    
    loadProject();
  }, [projectId]);
  
  // WebSocket 连接
  useEffect(() => {
    if (!projectId) return;
    
    wsService.connect(projectId);
    
    const unsubMessage = wsService.on('message_received', (msg) => {
      setMessages(prev => [...prev, msg.payload as Message]);
    });
    
    const unsubAgent = wsService.on('agent_response', (msg) => {
      setMessages(prev => [...prev, msg.payload as Message]);
    });
    
    // 多 Agent 协作消息
    const unsubMultiAgentStart = wsService.on('multi_agent_start', (msg) => {
      toast('🤝 多 Agent 协作开始...', { icon: '🚀' });
    });
    
    const unsubMultiAgentReply = wsService.on('multi_agent_agent_reply', (msg) => {
      setMessages(prev => [...prev, msg.payload as Message]);
    });
    
    const unsubMultiAgentDebate = wsService.on('multi_agent_debate', (msg) => {
      setMessages(prev => [...prev, msg.payload as Message]);
    });
    
    const unsubMultiAgentComplete = wsService.on('multi_agent_complete', (msg) => {
      toast.success('多 Agent 协作完成');
    });
    
    const unsubJoin = wsService.on('join_room', (msg) => {
      const payload = msg.payload as { onlineUsers: OnlineUser[] };
      setOnlineUsers(payload.onlineUsers);
    });
    
    const unsubUserJoined = wsService.on('user_joined', (msg) => {
      const payload = msg.payload as { userId: string; nickname: string };
      setOnlineUsers(prev => {
        if (prev.some(u => u.userId === payload.userId)) return prev;
        return [...prev, { userId: payload.userId, nickname: payload.nickname }];
      });
    });
    
    const unsubUserLeft = wsService.on('user_left', (msg) => {
      const payload = msg.payload as { userId: string };
      setOnlineUsers(prev => prev.filter(u => u.userId !== payload.userId));
    });
    
    const unsubTyping = wsService.on('typing', (msg) => {
      const payload = msg.payload as { nickname: string };
      setTypingUsers(prev => {
        if (prev.includes(payload.nickname)) return prev;
        return [...prev, payload.nickname];
      });
    });
    
    const unsubStopTyping = wsService.on('stop_typing', (msg) => {
      const payload = msg.payload as { typingUsers: string[] };
      setTypingUsers(payload.typingUsers);
    });
    
    return () => {
      unsubMessage();
      unsubAgent();
      unsubJoin();
      unsubUserJoined();
      unsubUserLeft();
      unsubTyping();
      unsubStopTyping();
      unsubMultiAgentStart();
      unsubMultiAgentReply();
      unsubMultiAgentDebate();
      unsubMultiAgentComplete();
      wsService.disconnect();
    };
  }, [projectId]);
  
  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // 发送消息
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || sending) return;
    
    setSending(true);
    wsService.stopTyping();
    wsService.sendMessage(inputValue.trim(), undefined, selectedTags);
    setInputValue('');
    setSelectedTags([]);
    setSending(false);
    inputRef.current?.focus();
  }, [inputValue, selectedTags, sending]);
  
  // 处理输入
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    
    // 发送正在输入状态
    wsService.startTyping();
    
    // 清除之前的超时
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // 3秒后停止输入状态
    typingTimeoutRef.current = setTimeout(() => {
      wsService.stopTyping();
    }, 3000);
  };
  
  // 处理回车发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  // 生成总结
  const handleGenerateSummary = async () => {
    if (!projectId || generatingSummary) return;
    
    setGeneratingSummary(true);
    setShowSummaryModal(true);
    
    try {
      const response = await messageApi.generateSummary(projectId);
      if (response.data) {
        setSummary({
          content: response.data.summary,
          messageCount: response.data.messageCount,
          generatedAt: response.data.generatedAt,
        });
        toast.success('总结生成成功');
      }
    } catch (error) {
      toast.error('生成总结失败');
      setShowSummaryModal(false);
    } finally {
      setGeneratingSummary(false);
    }
  };
  
  // 投票
  const handleVote = async (messageId: string, type: 'up' | 'down') => {
    if (!projectId) return;
    
    try {
      const response = await messageApi.vote(projectId, messageId, type);
      if (response.data) {
        setMessages(prev => prev.map(m => 
          m.id === messageId 
            ? { ...m, upvotes: response.data!.upvotes, downvotes: response.data!.downvotes, user_vote: response.data!.userVote || undefined }
            : m
        ));
      }
    } catch (error) {
      toast.error('投票失败');
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }
  
  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)]">项目不存在</p>
      </div>
    );
  }
  
  return (
    <div className="h-screen flex flex-col">
      {/* 项目头部 */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-4">
          <Link to="/" className="btn-ghost p-2">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">{project.name}</h1>
            <p className="text-sm text-[var(--text-muted)]">{project.description || '暂无描述'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* 在线用户 */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)]">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-[var(--text-secondary)]">
              {onlineUsers.length} 在线
            </span>
          </div>
          
          {/* 操作按钮 */}
          <button
            onClick={handleGenerateSummary}
            disabled={generatingSummary || messages.length === 0}
            className="btn-secondary flex items-center gap-2"
            title="生成讨论总结"
          >
            {generatingSummary ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ListChecks className="w-4 h-4" />
            )}
            总结
          </button>
          
          <button
            onClick={() => setShowInviteModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            邀请
          </button>
          
          <Link
            to={`/project/${projectId}/agents`}
            className="btn-secondary flex items-center gap-2"
            title="多 Agent 设置"
          >
            <Sparkles className="w-4 h-4" />
            Agent
          </Link>
          
          <Link
            to={`/project/${projectId}/documents`}
            className="btn-primary flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            文档
          </Link>
        </div>
      </header>
      
      {/* 聊天区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-20">
            <Bot className="w-16 h-16 mx-auto text-primary-400 mb-4" />
            <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
              开始讨论需求
            </h3>
            <p className="text-[var(--text-muted)]">
              在下方输入框中描述您的需求，AI Agent 会帮助您整理和分析
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              isOwn={message.user_id === user?.id}
              tags={tags}
              onVote={handleVote}
            />
          ))
        )}
        
        {/* 正在输入提示 */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] animate-pulse">
            <span>{typingUsers.join(', ')} 正在输入...</span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* 输入区域 */}
      <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        {/* 标签选择 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => {
                  setSelectedTags(prev => 
                    prev.includes(tag.name) 
                      ? prev.filter(t => t !== tag.name)
                      : [...prev, tag.name]
                  );
                }}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition-all',
                  selectedTags.includes(tag.name)
                    ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-secondary)]'
                    : 'opacity-60 hover:opacity-100'
                )}
                style={{ 
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                  ringColor: tag.color,
                }}
              >
                <Tag className="w-3 h-3 inline mr-1" />
                {tag.name}
              </button>
            ))}
          </div>
        )}
        
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="描述您的需求... (Shift+Enter 换行)"
            className="input flex-1 min-h-[48px] max-h-[200px] resize-none"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || sending}
            className="btn-primary px-6"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
      
      {/* 邀请弹窗 */}
      {showInviteModal && (
        <InviteModal 
          projectId={projectId!}
          onClose={() => setShowInviteModal(false)}
        />
      )}
      
      {/* 总结弹窗 */}
      {showSummaryModal && (
        <SummaryModal
          summary={summary}
          loading={generatingSummary}
          onClose={() => {
            setShowSummaryModal(false);
            setSummary(null);
          }}
        />
      )}
    </div>
  );
}

// Agent 角色颜色映射
const AGENT_ROLE_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  general: { bg: '#6366F1', text: '#6366F1', icon: '🤖' },
  product: { bg: '#8B5CF6', text: '#8B5CF6', icon: '📋' },
  technical: { bg: '#10B981', text: '#10B981', icon: '⚙️' },
  operation: { bg: '#F59E0B', text: '#F59E0B', icon: '📈' },
  design: { bg: '#EC4899', text: '#EC4899', icon: '🎨' },
  testing: { bg: '#EF4444', text: '#EF4444', icon: '🔍' },
  supervisor: { bg: '#0EA5E9', text: '#0EA5E9', icon: '👑' },
};

function MessageItem({ 
  message, 
  isOwn, 
  tags,
  onVote 
}: { 
  message: Message;
  isOwn: boolean;
  tags: { id: string; name: string; color: string }[];
  onVote: (messageId: string, type: 'up' | 'down') => void;
}) {
  const isAgent = message.type === 'agent';
  const agentColor = message.agentRole ? AGENT_ROLE_COLORS[message.agentRole] : AGENT_ROLE_COLORS.general;
  
  return (
    <div className={clsx(
      'flex gap-3 animate-fade-in',
      isOwn && !isAgent && 'flex-row-reverse'
    )}>
      {/* 头像 */}
      <div 
        className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
          !isAgent && 'bg-gradient-to-br from-primary-400 to-accent-400'
        )}
        style={isAgent ? { backgroundColor: `${agentColor.bg}20` } : undefined}
      >
        {isAgent ? (
          <span className="text-lg">{agentColor.icon}</span>
        ) : (
          <span className="text-white font-medium">
            {message.user_nickname?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
          </span>
        )}
      </div>
      
      {/* 消息内容 */}
      <div className={clsx('flex flex-col max-w-[70%]', isOwn && !isAgent && 'items-end')}>
        <div className="flex items-center gap-2 mb-1">
          <span 
            className="text-sm font-medium"
            style={isAgent ? { color: agentColor.text } : undefined}
          >
            {isAgent 
              ? (message.agentName || 'AI Agent') 
              : message.user_nickname || '用户'
            }
          </span>
          
          {/* 辩论轮次标记 */}
          {message.isDebate && message.debateRound && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-500">
              第{message.debateRound}轮
            </span>
          )}
          
          {/* 辩论立场标记 */}
          {message.sentiment && (
            <span className={clsx(
              'px-2 py-0.5 rounded-full text-xs',
              message.sentiment === 'agree' && 'bg-emerald-500/20 text-emerald-500',
              message.sentiment === 'disagree' && 'bg-red-500/20 text-red-500',
              message.sentiment === 'neutral' && 'bg-gray-500/20 text-gray-400'
            )}>
              {message.sentiment === 'agree' ? '同意' : message.sentiment === 'disagree' ? '不同意' : '中立'}
            </span>
          )}
          
          {/* 总结标记 */}
          {message.isSummary && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-primary-500/20 text-primary-500">
              协作总结
            </span>
          )}
          
          <span className="text-xs text-[var(--text-muted)]">
            {formatDistanceToNow(new Date(message.created_at), { 
              addSuffix: true,
              locale: zhCN 
            })}
          </span>
        </div>
        
        <div 
          className={clsx(
            'rounded-2xl px-4 py-3',
            isAgent 
              ? 'bg-[var(--bg-tertiary)]'
              : isOwn
                ? 'bg-primary-500 text-white'
                : 'bg-[var(--bg-tertiary)]'
          )}
          style={isAgent ? { 
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: `${agentColor.bg}30`
          } : undefined}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        
        {/* 标签和投票 */}
        <div className="flex items-center gap-3 mt-2">
          {/* Agent 角色标签 */}
          {isAgent && message.agentRole && (
            <span 
              className="px-2 py-0.5 rounded-full text-xs"
              style={{ 
                backgroundColor: `${agentColor.bg}20`, 
                color: agentColor.text 
              }}
            >
              {message.agentRole === 'product' ? '产品' :
               message.agentRole === 'technical' ? '技术' :
               message.agentRole === 'operation' ? '运营' :
               message.agentRole === 'design' ? '设计' :
               message.agentRole === 'testing' ? '测试' :
               message.agentRole === 'supervisor' ? '主管' : '通用'}
            </span>
          )}
          
          {/* 标签 */}
          {message.tags && message.tags.length > 0 && (
            <div className="flex gap-1">
              {message.tags.map(tagName => {
                const tag = tags.find(t => t.name === tagName);
                return tag ? (
                  <span 
                    key={tagName}
                    className="px-2 py-0.5 rounded-full text-xs"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                  >
                    {tagName}
                  </span>
                ) : null;
              })}
            </div>
          )}
          
          {/* 投票 */}
          {!isOwn && message.type === 'user' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onVote(message.id, 'up')}
                className={clsx(
                  'flex items-center gap-1 text-xs transition-colors',
                  message.user_vote === 'up' ? 'text-emerald-400' : 'text-[var(--text-muted)] hover:text-emerald-400'
                )}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                {message.upvotes || 0}
              </button>
              <button
                onClick={() => onVote(message.id, 'down')}
                className={clsx(
                  'flex items-center gap-1 text-xs transition-colors',
                  message.user_vote === 'down' ? 'text-red-400' : 'text-[var(--text-muted)] hover:text-red-400'
                )}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                {message.downvotes || 0}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [inviteLink, setInviteLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const generateLink = async () => {
    setLoading(true);
    try {
      const response = await invitationApi.create(projectId, { expiresIn: 168 }); // 7天
      if (response.data) {
        const link = `${window.location.origin}/invite/${response.data.inviteLink.split('/').pop()}`;
        setInviteLink(link);
      }
    } catch (error) {
      toast.error('生成邀请链接失败');
    } finally {
      setLoading(false);
    }
  };
  
  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('链接已复制');
    setTimeout(() => setCopied(false), 2000);
  };
  
  useEffect(() => {
    generateLink();
  }, []);
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-md animate-slide-up">
        <h2 className="text-xl font-semibold mb-4">邀请成员</h2>
        
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              分享以下链接邀请成员加入项目（有效期 7 天）
            </p>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="input flex-1 text-sm"
              />
              <button onClick={copyLink} className="btn-primary px-4">
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>
        )}
        
        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="btn-secondary">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// 总结弹窗组件
function SummaryModal({ 
  summary, 
  loading, 
  onClose 
}: { 
  summary: { content: string; messageCount: number; generatedAt: string } | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-3xl max-h-[85vh] flex flex-col animate-slide-up">
        {/* 头部 */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center">
              <ListChecks className="w-5 h-5 text-primary-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">讨论内容总结</h2>
              {summary && (
                <p className="text-sm text-[var(--text-muted)]">
                  基于 {summary.messageCount} 条消息生成
                </p>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>
        
        {/* 内容 */}
        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
              <p className="text-[var(--text-secondary)]">正在分析讨论内容，生成总结...</p>
              <p className="text-sm text-[var(--text-muted)] mt-2">这可能需要几秒钟</p>
            </div>
          ) : summary ? (
            <div className="prose prose-invert max-w-none">
              <div 
                className="text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed"
                style={{ 
                  fontFamily: 'inherit',
                }}
              >
                {summary.content.split('\n').map((line, i) => {
                  // 处理标题
                  if (line.startsWith('## ')) {
                    return (
                      <h2 key={i} className="text-lg font-semibold text-[var(--text-primary)] mt-6 mb-3 flex items-center gap-2">
                        {line.replace('## ', '')}
                      </h2>
                    );
                  }
                  // 处理列表项
                  if (line.startsWith('- ') || line.startsWith('• ')) {
                    return (
                      <div key={i} className="flex gap-2 ml-4 my-1">
                        <span className="text-primary-400">•</span>
                        <span>{line.replace(/^[-•]\s*/, '')}</span>
                      </div>
                    );
                  }
                  // 处理数字列表
                  if (/^\d+\.\s/.test(line)) {
                    return (
                      <div key={i} className="flex gap-2 ml-4 my-1">
                        <span className="text-primary-400 font-medium">{line.match(/^\d+/)?.[0]}.</span>
                        <span>{line.replace(/^\d+\.\s*/, '')}</span>
                      </div>
                    );
                  }
                  // 处理粗体文本
                  if (line.includes('**')) {
                    const parts = line.split(/\*\*(.*?)\*\*/g);
                    return (
                      <p key={i} className="my-2">
                        {parts.map((part, j) => 
                          j % 2 === 1 ? (
                            <strong key={j} className="text-[var(--text-primary)] font-semibold">{part}</strong>
                          ) : (
                            <span key={j}>{part}</span>
                          )
                        )}
                      </p>
                    );
                  }
                  // 空行
                  if (!line.trim()) {
                    return <div key={i} className="h-2" />;
                  }
                  // 普通段落
                  return <p key={i} className="my-2">{line}</p>;
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-[var(--text-muted)]">
              暂无总结内容
            </div>
          )}
        </div>
        
        {/* 底部 */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-color)]">
          {summary && (
            <p className="text-xs text-[var(--text-muted)]">
              生成时间：{new Date(summary.generatedAt).toLocaleString('zh-CN')}
            </p>
          )}
          <button onClick={onClose} className="btn-primary ml-auto">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
