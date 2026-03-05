import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { 
  Home, 
  FolderKanban, 
  LogOut, 
  User,
  Sparkles,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const navigate = useNavigate();
  
  const handleLogout = () => {
    logout();
    navigate('/auth');
  };
  
  const toggleTheme = () => {
    // 循环切换：dark -> light -> system -> dark
    if (theme === 'dark') {
      setTheme('light');
    } else if (theme === 'light') {
      setTheme('system');
    } else {
      setTheme('dark');
    }
  };
  
  const getThemeIcon = () => {
    if (theme === 'light') return <Sun className="w-5 h-5" />;
    if (theme === 'dark') return <Moon className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };
  
  const getThemeLabel = () => {
    if (theme === 'light') return '浅色';
    if (theme === 'dark') return '深色';
    return '跟随系统';
  };
  
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">
      {/* 侧边栏 */}
      <aside className="w-64 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-[var(--border-color)]">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 
                          flex items-center justify-center shadow-lg shadow-primary-500/20
                          group-hover:shadow-primary-500/40 transition-shadow">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-[var(--text-primary)]">RequireAgent</h1>
              <p className="text-xs text-[var(--text-muted)]">AI 需求协作平台</p>
            </div>
          </Link>
        </div>
        
        {/* 导航 */}
        <nav className="flex-1 p-4 space-y-2">
          <Link 
            to="/" 
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-[var(--text-secondary)]
                     hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Home className="w-5 h-5" />
            <span>仪表盘</span>
          </Link>
          <Link 
            to="/" 
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-[var(--text-secondary)]
                     hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <FolderKanban className="w-5 h-5" />
            <span>我的项目</span>
          </Link>
        </nav>
        
        {/* 用户信息 */}
        <div className="p-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-accent-400 
                          flex items-center justify-center text-white font-medium">
              {user?.nickname?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {user?.nickname || '用户'}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {user?.email}
              </p>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 
                       hover:bg-red-500/10 transition-colors"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-14 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] 
                         flex items-center justify-end px-6 shrink-0">
          {/* 主题切换按钮 */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-secondary)]
                     hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title={`当前: ${getThemeLabel()}，点击切换`}
          >
            {getThemeIcon()}
            <span className="text-sm">{getThemeLabel()}</span>
          </button>
        </header>
        
        {/* 内容区 */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
