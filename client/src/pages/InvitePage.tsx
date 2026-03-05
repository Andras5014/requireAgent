import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Sparkles, CheckCircle, XCircle } from 'lucide-react';
import { invitationApi } from '../services/api';
import { useAuthStore } from '../stores/auth';

export default function InvitePage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [preview, setPreview] = useState<{
    projectName: string;
    projectDescription: string;
    isValid: boolean;
  } | null>(null);
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!inviteCode) return;
    
    const loadPreview = async () => {
      try {
        const response = await invitationApi.preview(inviteCode);
        if (response.data) {
          setPreview(response.data);
        }
      } catch (error) {
        setPreview(null);
      } finally {
        setLoading(false);
      }
    };
    
    loadPreview();
  }, [inviteCode]);
  
  const handleJoin = async () => {
    if (!inviteCode || !isAuthenticated) return;
    
    setJoining(true);
    try {
      const response = await invitationApi.join(inviteCode);
      if (response.data) {
        toast.success('成功加入项目');
        navigate(`/project/${(response.data.project as { id: string }).id}`);
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setJoining(false);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full 
                      bg-gradient-to-br from-primary-500/20 via-transparent to-transparent 
                      rounded-full blur-3xl" />
      </div>
      
      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl 
                        bg-gradient-to-br from-primary-500 to-accent-500 
                        shadow-2xl shadow-primary-500/30 mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">项目邀请</h1>
        </div>
        
        <div className="card glass">
          {!preview || !preview.isValid ? (
            <div className="text-center py-8">
              <XCircle className="w-16 h-16 mx-auto text-red-400 mb-4" />
              <h2 className="text-xl font-semibold mb-2">邀请链接无效</h2>
              <p className="text-[var(--text-muted)] mb-6">
                该链接可能已过期或已达到使用上限
              </p>
              <Link to="/" className="btn-primary">
                返回首页
              </Link>
            </div>
          ) : (
            <div className="text-center">
              <CheckCircle className="w-16 h-16 mx-auto text-emerald-400 mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                您被邀请加入项目
              </h2>
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 my-6">
                <h3 className="text-lg font-medium text-primary-400 mb-2">
                  {preview.projectName}
                </h3>
                <p className="text-sm text-[var(--text-muted)]">
                  {preview.projectDescription || '暂无描述'}
                </p>
              </div>
              
              {isAuthenticated ? (
                <button
                  onClick={handleJoin}
                  disabled={joining}
                  className="btn-primary w-full"
                >
                  {joining ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  ) : (
                    '加入项目'
                  )}
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    请先登录后再加入项目
                  </p>
                  <Link 
                    to={`/auth?redirect=/invite/${inviteCode}`}
                    className="btn-primary w-full block text-center"
                  >
                    登录 / 注册
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
