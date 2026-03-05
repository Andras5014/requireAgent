import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { 
  Plus, 
  FolderKanban, 
  Users, 
  MessageSquare, 
  Clock,
  Globe,
  Lock,
  Loader2,
  X
} from 'lucide-react';
import { projectApi } from '../services/api';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface Project {
  id: string;
  name: string;
  description: string;
  visibility: string;
  message_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
  user_role?: string;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const navigate = useNavigate();
  
  useEffect(() => {
    loadProjects();
  }, []);
  
  const loadProjects = async () => {
    try {
      const response = await projectApi.list();
      if (response.data) {
        setProjects(response.data.items as Project[]);
      }
    } catch (error) {
      toast.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="p-8">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">我的项目</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            管理您的需求协作项目
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          创建项目
        </button>
      </div>
      
      {/* 项目列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <FolderKanban className="w-16 h-16 mx-auto text-[var(--text-muted)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
            还没有项目
          </h3>
          <p className="text-[var(--text-muted)] mb-6">
            创建您的第一个需求协作项目
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            创建项目
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/project/${project.id}`}
              className="card hover:border-primary-500/50 hover:shadow-lg hover:shadow-primary-500/10 
                       transition-all duration-300 group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 
                                flex items-center justify-center group-hover:from-primary-500/30 group-hover:to-accent-500/30
                                transition-colors">
                    <FolderKanban className="w-6 h-6 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--text-primary)] group-hover:text-primary-400 transition-colors">
                      {project.name}
                    </h3>
                    {project.user_role && (
                      <span className="badge-primary text-xs">
                        {project.user_role === 'creator' ? '创建者' : 
                         project.user_role === 'admin' ? '管理员' : '成员'}
                      </span>
                    )}
                  </div>
                </div>
                {project.visibility === 'public' ? (
                  <Globe className="w-4 h-4 text-emerald-400" title="公开项目" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-400" title="私密项目" />
                )}
              </div>
              
              <p className="text-sm text-[var(--text-secondary)] mb-4 line-clamp-2">
                {project.description || '暂无描述'}
              </p>
              
              <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {project.member_count} 成员
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {project.message_count} 消息
                </span>
                <span className="flex items-center gap-1 ml-auto">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDistanceToNow(new Date(project.updated_at), { 
                    addSuffix: true,
                    locale: zhCN 
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      
      {/* 创建项目弹窗 */}
      {showCreateModal && (
        <CreateProjectModal 
          onClose={() => setShowCreateModal(false)}
          onCreate={(project) => {
            setProjects([project, ...projects]);
            setShowCreateModal(false);
            navigate(`/project/${project.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateProjectModal({ 
  onClose, 
  onCreate 
}: { 
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    try {
      const response = await projectApi.create({ name, description, visibility });
      if (response.data) {
        toast.success('项目创建成功');
        onCreate(response.data as Project);
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-md animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">创建新项目</h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-2">
              项目名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              className="input"
              required
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-2">
              项目描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述一下这个项目（可选）"
              className="input min-h-[100px] resize-none"
              rows={3}
            />
          </div>
          
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-2">
              可见性
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                  className="w-4 h-4 text-primary-500"
                />
                <Lock className="w-4 h-4 text-amber-400" />
                <span>私密</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                  className="w-4 h-4 text-primary-500"
                />
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>公开</span>
              </label>
            </div>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              取消
            </button>
            <button 
              type="submit" 
              disabled={loading || !name.trim()}
              className="btn-primary flex-1 flex items-center justify-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
