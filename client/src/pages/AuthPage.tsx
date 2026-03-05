import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mail, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../stores/auth';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();
  
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setLoading(true);
    try {
      await authApi.sendCode(email);
      toast.success('验证码已发送到您的邮箱');
      setStep('code');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    
    setLoading(true);
    try {
      const response = await authApi.verify(email, code);
      if (response.data) {
        login(response.data.user as never, response.data.token);
        toast.success('登录成功');
        navigate('/');
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full 
                      bg-gradient-to-br from-primary-500/20 via-transparent to-transparent 
                      rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full 
                      bg-gradient-to-tl from-accent-500/20 via-transparent to-transparent 
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
          <h1 className="text-3xl font-bold gradient-text mb-2">RequireAgent</h1>
          <p className="text-[var(--text-secondary)]">AI 驱动的需求协作平台</p>
        </div>
        
        {/* 登录卡片 */}
        <div className="card glass">
          <h2 className="text-xl font-semibold text-center mb-6">
            {step === 'email' ? '登录 / 注册' : '输入验证码'}
          </h2>
          
          {step === 'email' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-2">
                  邮箱地址
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="input pl-12"
                    required
                    autoFocus
                  />
                </div>
              </div>
              
              <button
                type="submit"
                disabled={loading || !email}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    获取验证码
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-2">
                  验证码已发送到 <span className="text-primary-400">{email}</span>
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="输入6位验证码"
                  className="input text-center text-2xl tracking-[0.5em] font-mono"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    登录
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                }}
                className="btn-ghost w-full"
              >
                使用其他邮箱
              </button>
            </form>
          )}
        </div>
        
        {/* 底部提示 */}
        <p className="text-center text-sm text-[var(--text-muted)] mt-6">
          首次登录将自动创建账号
        </p>
      </div>
    </div>
  );
}
