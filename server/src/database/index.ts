import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import config from '../config';

let db: SqlJsDatabase;

// 确保数据库目录存在
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// SQL.js 兼容层
class DatabaseWrapper {
  private db: SqlJsDatabase;
  
  constructor(database: SqlJsDatabase) {
    this.db = database;
  }
  
  prepare(sql: string) {
    const self = this;
    return {
      run(...params: unknown[]) {
        try {
          self.db.run(sql, params as (string | number | null)[]);
          self.saveToFile();
          return { changes: self.db.getRowsModified() };
        } catch (error) {
          console.error('SQL Error:', error, sql);
          throw error;
        }
      },
      get(...params: unknown[]) {
        try {
          const stmt = self.db.prepare(sql);
          stmt.bind(params as (string | number | null)[]);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        } catch (error) {
          console.error('SQL Error:', error, sql);
          throw error;
        }
      },
      all(...params: unknown[]) {
        try {
          const results: Record<string, unknown>[] = [];
          const stmt = self.db.prepare(sql);
          stmt.bind(params as (string | number | null)[]);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (error) {
          console.error('SQL Error:', error, sql);
          throw error;
        }
      },
    };
  }
  
  exec(sql: string) {
    try {
      this.db.exec(sql);
      this.saveToFile();
    } catch (error) {
      console.error('SQL Error:', error);
      throw error;
    }
  }
  
  pragma(pragma: string) {
    try {
      this.db.exec(`PRAGMA ${pragma}`);
    } catch (error) {
      console.error('Pragma Error:', error);
    }
  }
  
  private saveToFile() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(config.dbPath, buffer);
    } catch (error) {
      console.error('Save Error:', error);
    }
  }
}

let dbWrapper: DatabaseWrapper;

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  
  // 尝试加载现有数据库
  try {
    if (fs.existsSync(config.dbPath)) {
      const fileBuffer = fs.readFileSync(config.dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (error) {
    console.log('创建新数据库');
    db = new SQL.Database();
  }
  
  dbWrapper = new DatabaseWrapper(db);
  
  // 初始化表结构
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 验证码表
    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 项目表
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT DEFAULT 'private',
      creator_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    -- 项目成员表
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    );

    -- 邀请链接表
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      expires_at DATETIME,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- 消息表
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT DEFAULT 'user',
      content TEXT NOT NULL,
      reply_to TEXT,
      is_filtered INTEGER DEFAULT 0,
      filter_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reply_to) REFERENCES messages(id)
    );

    -- 标签表
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3B82F6',
      category TEXT DEFAULT 'other',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );

    -- 消息标签关联表
    CREATE TABLE IF NOT EXISTS message_tags (
      message_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (message_id, tag_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- 投票表
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(message_id, user_id)
    );

    -- 文档表
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      generated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- 文档导出表
    CREATE TABLE IF NOT EXISTS document_exports (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- 过滤内容表
    CREATE TABLE IF NOT EXISTS filtered_contents (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      status TEXT DEFAULT 'filtered',
      reason TEXT,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    -- 过滤配置表
    CREATE TABLE IF NOT EXISTS filter_configs (
      project_id TEXT PRIMARY KEY,
      filter_off_topic INTEGER DEFAULT 1,
      filter_noise INTEGER DEFAULT 1,
      custom_keywords TEXT DEFAULT '[]',
      strictness TEXT DEFAULT 'medium',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Agent 配置表
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT DEFAULT 'general',
      name TEXT,
      avatar TEXT,
      provider TEXT DEFAULT 'openai',
      model TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 2000,
      is_active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      capabilities TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- 多 Agent 协作会话表
    CREATE TABLE IF NOT EXISTS multi_agent_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT DEFAULT 'flexible',
      status TEXT DEFAULT 'active',
      triggered_by TEXT,
      participating_agents TEXT DEFAULT '[]',
      current_agent_id TEXT,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (triggered_by) REFERENCES messages(id)
    );

    -- Agent 任务表
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      input TEXT,
      output TEXT,
      task_order INTEGER DEFAULT 0,
      started_at DATETIME,
      completed_at DATETIME,
      error TEXT,
      FOREIGN KEY (session_id) REFERENCES multi_agent_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agent_configs(id) ON DELETE CASCADE
    );

    -- Agent 消息表（多 Agent 对话记录）
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      content TEXT NOT NULL,
      reply_to TEXT,
      is_debate INTEGER DEFAULT 0,
      debate_round INTEGER,
      sentiment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES multi_agent_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agent_configs(id) ON DELETE CASCADE
    );

    -- 协作配置表
    CREATE TABLE IF NOT EXISTS collaboration_configs (
      project_id TEXT PRIMARY KEY,
      mode TEXT DEFAULT 'flexible',
      is_enabled INTEGER DEFAULT 1,
      max_debate_rounds INTEGER DEFAULT 3,
      debate_threshold REAL DEFAULT 0.5,
      supervisor_agent_id TEXT,
      pipeline_order TEXT DEFAULT '[]',
      auto_trigger_keywords TEXT DEFAULT '[]',
      consensus_required INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (supervisor_agent_id) REFERENCES agent_configs(id) ON DELETE SET NULL
    );

    -- 文档生成任务表
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      trigger TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'pending',
      result TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  
  // 保存初始化后的数据库
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);

  console.log('数据库初始化完成');
}

// 获取数据库包装器
export function getDb(): DatabaseWrapper {
  if (!dbWrapper) {
    throw new Error('数据库尚未初始化，请先调用 initDatabase()');
  }
  return dbWrapper;
}

// 为了兼容性，导出 db 对象
export default {
  get prepare() {
    return getDb().prepare.bind(getDb());
  },
  get exec() {
    return getDb().exec.bind(getDb());
  },
  get pragma() {
    return getDb().pragma.bind(getDb());
  },
};
