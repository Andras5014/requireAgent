import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import { 
  ArrowLeft, 
  FileText, 
  Download, 
  RefreshCw, 
  Plus,
  Loader2,
  ChevronDown,
  Check,
  Filter,
  Eye,
  Edit2,
  Save,
  X
} from 'lucide-react';
import { documentApi, projectApi } from '../services/api';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import clsx from 'clsx';

interface Document {
  id: string;
  type: string;
  title: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const DOC_TYPES = [
  { value: 'prd', label: '产品需求文档', icon: '📋' },
  { value: 'tech_design', label: '技术设计方案', icon: '🏗️' },
  { value: 'api_doc', label: 'API 接口文档', icon: '🔌' },
  { value: 'db_design', label: '数据库设计', icon: '🗄️' },
  { value: 'test_case', label: '测试用例', icon: '🧪' },
  { value: 'operation', label: '运营方案', icon: '📈' },
  { value: 'user_manual', label: '用户手册', icon: '📖' },
];

export default function DocumentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [filterConfig, setFilterConfig] = useState<{
    filter_off_topic: boolean;
    filter_noise: boolean;
    strictness: string;
  } | null>(null);
  
  // 加载文档列表
  useEffect(() => {
    if (!projectId) return;
    
    const loadData = async () => {
      try {
        const [docsRes, filterRes] = await Promise.all([
          documentApi.list(projectId),
          documentApi.getFilterConfig(projectId),
        ]);
        
        if (docsRes.data) {
          setDocuments(docsRes.data as Document[]);
          if ((docsRes.data as Document[]).length > 0) {
            setSelectedDoc((docsRes.data as Document[])[0]);
          }
        }
        if (filterRes.data) {
          setFilterConfig(filterRes.data as typeof filterConfig);
        }
      } catch (error) {
        toast.error('加载文档失败');
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [projectId]);
  
  // 生成文档
  const handleGenerate = async (type: string) => {
    if (!projectId) return;
    
    setGenerating(true);
    setShowGenerateModal(false);
    
    try {
      const response = await documentApi.generate(projectId, type);
      if (response.data) {
        const newDoc = response.data as Document;
        setDocuments(prev => [newDoc, ...prev]);
        setSelectedDoc(newDoc);
        toast.success('文档生成成功');
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  };
  
  // 导出文档
  const handleExport = async (format: 'markdown' | 'pdf') => {
    if (!projectId || !selectedDoc) return;
    
    setExporting(true);
    try {
      const response = await documentApi.export(projectId, selectedDoc.id, format);
      if (response.data) {
        // 下载文件
        window.open(`/api${response.data.downloadUrl}`, '_blank');
        toast.success('导出成功');
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  
  // 保存编辑
  const handleSave = async () => {
    if (!projectId || !selectedDoc) return;
    
    try {
      const response = await documentApi.update(projectId, selectedDoc.id, {
        content: editContent,
      });
      if (response.data) {
        const updatedDoc = response.data as Document;
        setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
        setSelectedDoc(updatedDoc);
        setEditing(false);
        toast.success('保存成功');
      }
    } catch (error) {
      toast.error('保存失败');
    }
  };
  
  // 更新过滤配置
  const handleUpdateFilter = async (updates: Partial<typeof filterConfig>) => {
    if (!projectId) return;
    
    try {
      const response = await documentApi.updateFilterConfig(projectId, updates);
      if (response.data) {
        setFilterConfig(response.data as typeof filterConfig);
        toast.success('配置已更新');
      }
    } catch (error) {
      toast.error('更新失败');
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }
  
  return (
    <div className="h-screen flex flex-col">
      {/* 头部 */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-4">
          <Link to={`/project/${projectId}`} className="btn-ghost p-2">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">项目文档</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowGenerateModal(true)}
            disabled={generating}
            className="btn-primary flex items-center gap-2"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            生成文档
          </button>
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧文档列表 */}
        <aside className="w-72 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto">
          {/* 过滤配置 */}
          <div className="p-4 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-3">
              <Filter className="w-4 h-4" />
              内容过滤设置
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterConfig?.filter_off_topic}
                  onChange={(e) => handleUpdateFilter({ filter_off_topic: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">过滤跑题内容</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterConfig?.filter_noise}
                  onChange={(e) => handleUpdateFilter({ filter_noise: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">过滤无效信息</span>
              </label>
            </div>
          </div>
          
          {/* 文档列表 */}
          <div className="p-2">
            {documents.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无文档</p>
                <p className="text-xs mt-1">点击上方按钮生成</p>
              </div>
            ) : (
              documents.map(doc => {
                const typeInfo = DOC_TYPES.find(t => t.value === doc.type);
                return (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setSelectedDoc(doc);
                      setEditing(false);
                    }}
                    className={clsx(
                      'w-full text-left px-4 py-3 rounded-lg mb-1 transition-colors',
                      selectedDoc?.id === doc.id
                        ? 'bg-primary-500/20 border border-primary-500/30'
                        : 'hover:bg-[var(--bg-tertiary)]'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span>{typeInfo?.icon || '📄'}</span>
                      <span className="font-medium text-sm truncate">{doc.title}</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      v{doc.version} · {formatDistanceToNow(new Date(doc.updated_at), { 
                        addSuffix: true,
                        locale: zhCN 
                      })}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>
        
        {/* 右侧文档内容 */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {selectedDoc ? (
            <>
              {/* 文档头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-lg font-semibold">{selectedDoc.title}</h2>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <button onClick={() => setEditing(false)} className="btn-ghost">
                        <X className="w-4 h-4 mr-1" />
                        取消
                      </button>
                      <button onClick={handleSave} className="btn-primary">
                        <Save className="w-4 h-4 mr-1" />
                        保存
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditContent(selectedDoc.content);
                          setEditing(true);
                        }}
                        className="btn-ghost"
                      >
                        <Edit2 className="w-4 h-4 mr-1" />
                        编辑
                      </button>
                      <div className="relative group">
                        <button 
                          disabled={exporting}
                          className="btn-secondary flex items-center gap-1"
                        >
                          {exporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          导出
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <div className="absolute right-0 top-full mt-1 w-40 py-1 bg-[var(--bg-tertiary)] 
                                      border border-[var(--border-color)] rounded-lg shadow-xl
                                      opacity-0 invisible group-hover:opacity-100 group-hover:visible
                                      transition-all z-10">
                          <button
                            onClick={() => handleExport('markdown')}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-secondary)]"
                          >
                            Markdown 格式
                          </button>
                          <button
                            onClick={() => handleExport('pdf')}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-secondary)]"
                          >
                            PDF 格式
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              
              {/* 文档内容 */}
              <div className="flex-1 overflow-y-auto p-6">
                {editing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full input font-mono text-sm resize-none"
                  />
                ) : (
                  <div className="markdown-content">
                    <ReactMarkdown>{selectedDoc.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              <div className="text-center">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>选择左侧文档查看内容</p>
                <p className="text-sm mt-1">或点击"生成文档"创建新文档</p>
              </div>
            </div>
          )}
        </main>
      </div>
      
      {/* 生成文档弹窗 */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="card w-full max-w-md animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">生成文档</h2>
              <button onClick={() => setShowGenerateModal(false)} className="btn-ghost p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              选择要生成的文档类型，AI 将根据讨论内容自动生成
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              {DOC_TYPES.map(type => (
                <button
                  key={type.value}
                  onClick={() => handleGenerate(type.value)}
                  className="flex items-center gap-3 p-4 rounded-lg bg-[var(--bg-tertiary)] 
                           hover:bg-[var(--border-color)] transition-colors text-left"
                >
                  <span className="text-2xl">{type.icon}</span>
                  <span className="text-sm font-medium">{type.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
