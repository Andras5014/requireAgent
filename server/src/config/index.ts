import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  // 服务器配置
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // JWT 配置
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  
  // 数据库配置
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/requireagent.db'),
  
  // 邮件配置
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@requireagent.com',
  },
  
  // LLM 配置
  llm: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
    claude: {
      apiKey: process.env.CLAUDE_API_KEY || '',
      model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    },
    local: {
      baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434',
      model: process.env.LOCAL_LLM_MODEL || 'llama2',
    },
    // 自定义中转 API 配置
    custom: {
      apiKey: process.env.CUSTOM_API_KEY || '',
      baseUrl: process.env.CUSTOM_BASE_URL || '',
      model: process.env.CUSTOM_MODEL || 'gpt-4o',
    },
    defaultProvider: (process.env.DEFAULT_LLM_PROVIDER || 'openai') as 'openai' | 'claude' | 'deepseek' | 'local' | 'custom',
    // API 类型: chat_completions (默认) 或 responses (OpenAI 新版 API)
    apiType: (process.env.LLM_API_TYPE || 'chat_completions') as 'chat_completions' | 'responses',
  },
  
  // 文件存储配置
  storage: {
    uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'),
    documentsDir: process.env.DOCUMENTS_DIR || path.resolve(__dirname, '../../documents'),
  },
  
  // 验证码配置
  verification: {
    codeLength: 6,
    codeExpiresIn: 10 * 60 * 1000, // 10 分钟
  },
  
  // 内容过滤配置
  filter: {
    defaultStrictness: 'medium' as 'low' | 'medium' | 'high',
    noiseKeywords: [
      '好的', '收到', 'ok', 'OK', '+1', '👍', '嗯', '哦', '啊',
      '谢谢', '感谢', '明白', '了解', '知道了', '行', '可以'
    ],
  },
  
  // 文档生成配置
  docGeneration: {
    autoThreshold: parseInt(process.env.DOC_AUTO_THRESHOLD || '50', 10), // 50条消息后自动生成
    scheduleCron: process.env.DOC_SCHEDULE_CRON || '0 0 * * *', // 每天0点
  },
  
  // CORS 配置
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
};

export default config;
