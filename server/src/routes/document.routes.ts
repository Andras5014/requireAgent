import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import db from '../database';
import config from '../config';
import { authMiddleware, AuthRequest, projectMemberMiddleware } from '../middleware/auth';
import { generateDocument, filterContent, DocumentGenerationResult } from '../services/llm.service';
import type { DocumentType, LLMProvider } from '@requireagent/shared';

const router = Router();

// 确保文档目录存在
if (!fs.existsSync(config.storage.documentsDir)) {
  fs.mkdirSync(config.storage.documentsDir, { recursive: true });
}

// 获取项目文档列表
router.get(
  '/:projectId/documents',
  authMiddleware,
  projectMemberMiddleware(),
  [query('type').optional()],
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const type = req.query.type as string;
    
    let query_sql = `
      SELECT d.*, 
        (SELECT COUNT(*) FROM document_exports WHERE document_id = d.id) as export_count
      FROM documents d
      WHERE d.project_id = ?
    `;
    const params: string[] = [projectId];
    
    if (type) {
      query_sql += ' AND d.type = ?';
      params.push(type);
    }
    
    query_sql += ' ORDER BY d.updated_at DESC';
    
    const documents = db.prepare(query_sql).all(...params);
    
    res.json({
      success: true,
      data: documents,
    });
  }
);

// 获取单个文档
router.get(
  '/:projectId/documents/:documentId',
  authMiddleware,
  projectMemberMiddleware(),
  (req: AuthRequest, res: Response) => {
    const { documentId } = req.params;
    
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: '文档不存在',
      });
    }
    
    res.json({
      success: true,
      data: document,
    });
  }
);

// 生成文档
router.post(
  '/:projectId/documents/generate',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin', 'member']),
  [
    body('type').isIn(['prd', 'tech_design', 'api_doc', 'db_design', 'test_case', 'operation', 'user_manual']),
    body('provider').optional().isIn(['openai', 'claude', 'deepseek', 'local']),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { projectId } = req.params;
    const { type, provider } = req.body as { type: DocumentType; provider?: LLMProvider };
    
    // 获取项目信息
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as {
      name: string;
      description: string;
    };
    
    // 获取过滤配置
    const filterConfig = db.prepare('SELECT * FROM filter_configs WHERE project_id = ?').get(projectId) as {
      filter_off_topic: number;
      filter_noise: number;
      custom_keywords: string;
      strictness: 'low' | 'medium' | 'high';
    } | undefined;
    
    // 获取消息
    const messages = db.prepare(`
      SELECT m.content, m.type, GROUP_CONCAT(t.name) as tags
      FROM messages m
      LEFT JOIN message_tags mt ON m.id = mt.message_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE m.project_id = ? AND m.is_filtered = 0
      GROUP BY m.id
      ORDER BY m.created_at ASC
    `).all(projectId) as Array<{ content: string; type: string; tags: string | null }>;
    
    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '项目中没有可用的讨论内容',
      });
    }
    
    // 创建生成任务
    const taskId = nanoid();
    db.prepare(`
      INSERT INTO generation_tasks (id, project_id, document_type, trigger, status)
      VALUES (?, ?, ?, 'manual', 'processing')
    `).run(taskId, projectId, type);
    
    try {
      // 内容过滤
      let filteredMessages = messages.map(m => ({
        content: m.content,
        type: m.type,
        tags: m.tags ? m.tags.split(',') : [],
      }));
      
      if (filterConfig) {
        const filterResults = await filterContent(
          messages.map(m => ({ content: m.content })),
          {
            filterOffTopic: !!filterConfig.filter_off_topic,
            filterNoise: !!filterConfig.filter_noise,
            customKeywords: JSON.parse(filterConfig.custom_keywords || '[]'),
            strictness: filterConfig.strictness || 'medium',
            projectDescription: project.description,
          }
        );
        
        filteredMessages = messages
          .filter((_, i) => !filterResults[i].isFiltered)
          .map(m => ({
            content: m.content,
            type: m.type,
            tags: m.tags ? m.tags.split(',') : [],
          }));
      }
      
      // 获取所有现有文档作为参考（用于冲突检测）
      const existingDocuments = db.prepare(`
        SELECT type, title, content, version FROM documents 
        WHERE project_id = ? 
        ORDER BY type, version DESC
      `).all(projectId) as Array<{ type: string; title: string; content: string; version: number }>;
      
      // 按类型分组，每种类型只取最新版本
      const latestDocsByType = new Map<string, { type: string; title: string; content: string; version: number }>();
      for (const doc of existingDocuments) {
        if (!latestDocsByType.has(doc.type)) {
          latestDocsByType.set(doc.type, doc);
        }
      }
      
      // 生成文档（传入现有文档作为参考）
      const generationResult = await generateDocument(
        type,
        { name: project.name, description: project.description },
        filteredMessages,
        provider,
        Array.from(latestDocsByType.values())
      );
      
      // 检查是否已有同类型文档
      const existingDoc = latestDocsByType.get(type);
      
      const docId = nanoid();
      const version = existingDoc ? existingDoc.version + 1 : 1;
      const title = getDocumentTitle(type, project.name, version);
      
      db.prepare(`
        INSERT INTO documents (id, project_id, type, title, content, version, generated_by)
        VALUES (?, ?, ?, ?, ?, ?, 'agent')
      `).run(docId, projectId, type, title, generationResult.content, version);
      
      // 更新任务状态
      db.prepare(`
        UPDATE generation_tasks 
        SET status = 'completed', result = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(docId, taskId);
      
      const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
      
      res.status(201).json({
        success: true,
        data: {
          ...document as object,
          conflicts: generationResult.conflicts,  // 与现有文档的冲突点
          changes: generationResult.changes,      // 相对于上一版本的主要变更
        },
      });
    } catch (error) {
      // 更新任务状态为失败
      db.prepare(`
        UPDATE generation_tasks 
        SET status = 'failed', error = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run((error as Error).message, taskId);
      
      res.status(500).json({
        success: false,
        error: '文档生成失败: ' + (error as Error).message,
      });
    }
  }
);

// 更新文档
router.put(
  '/:projectId/documents/:documentId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin', 'member']),
  [body('content').notEmpty()],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { documentId } = req.params;
    const { content, title } = req.body;
    
    const updates: string[] = ['content = ?', 'updated_at = datetime("now")'];
    const values: string[] = [content];
    
    if (title) {
      updates.push('title = ?');
      values.push(title);
    }
    
    values.push(documentId);
    
    db.prepare(`
      UPDATE documents SET ${updates.join(', ')} WHERE id = ?
    `).run(...values);
    
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    
    res.json({
      success: true,
      data: document,
    });
  }
);

// 删除文档
router.delete(
  '/:projectId/documents/:documentId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { documentId } = req.params;
    
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
    
    res.json({
      success: true,
      message: '文档已删除',
    });
  }
);

// 导出文档为 PDF
router.post(
  '/:projectId/documents/:documentId/export',
  authMiddleware,
  projectMemberMiddleware(),
  [body('format').isIn(['markdown', 'pdf'])],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { projectId, documentId } = req.params;
    const { format } = req.body;
    
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as {
      id: string;
      title: string;
      content: string;
    } | undefined;
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: '文档不存在',
      });
    }
    
    const fileName = `${document.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${Date.now()}`;
    const filePath = path.join(config.storage.documentsDir, projectId);
    
    // 确保项目文档目录存在
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
    
    try {
      if (format === 'markdown') {
        const mdPath = path.join(filePath, `${fileName}.md`);
        fs.writeFileSync(mdPath, document.content);
        
        // 保存导出记录
        const exportId = nanoid();
        db.prepare(`
          INSERT INTO document_exports (id, document_id, format, file_path)
          VALUES (?, ?, 'markdown', ?)
        `).run(exportId, documentId, mdPath);
        
        res.json({
          success: true,
          data: {
            format: 'markdown',
            filePath: mdPath,
            downloadUrl: `/api/documents/download/${exportId}`,
          },
        });
      } else if (format === 'pdf') {
        // 使用 puppeteer 生成 PDF
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // 将 Markdown 转为 HTML（简单转换）
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>${document.title}</title>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 40px;
                line-height: 1.6;
              }
              h1 { color: #1a1a1a; border-bottom: 2px solid #3B82F6; padding-bottom: 10px; }
              h2 { color: #333; margin-top: 30px; }
              h3 { color: #555; }
              code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
              pre { background: #f5f5f5; padding: 15px; border-radius: 8px; overflow-x: auto; }
              ul, ol { padding-left: 20px; }
              li { margin: 8px 0; }
              table { border-collapse: collapse; width: 100%; margin: 20px 0; }
              th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
              th { background: #f5f5f5; }
            </style>
          </head>
          <body>
            <h1>${document.title}</h1>
            ${convertMarkdownToHtml(document.content)}
          </body>
          </html>
        `;
        
        await page.setContent(htmlContent);
        
        const pdfPath = path.join(filePath, `${fileName}.pdf`);
        await page.pdf({
          path: pdfPath,
          format: 'A4',
          margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        });
        
        await browser.close();
        
        // 保存导出记录
        const exportId = nanoid();
        db.prepare(`
          INSERT INTO document_exports (id, document_id, format, file_path)
          VALUES (?, ?, 'pdf', ?)
        `).run(exportId, documentId, pdfPath);
        
        res.json({
          success: true,
          data: {
            format: 'pdf',
            filePath: pdfPath,
            downloadUrl: `/api/documents/download/${exportId}`,
          },
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: '导出失败: ' + (error as Error).message,
      });
    }
  }
);

// 下载导出的文档
router.get(
  '/download/:exportId',
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    const { exportId } = req.params;
    
    const exportRecord = db.prepare(`
      SELECT de.*, d.project_id
      FROM document_exports de
      JOIN documents d ON de.document_id = d.id
      WHERE de.id = ?
    `).get(exportId) as { file_path: string; format: string; project_id: string } | undefined;
    
    if (!exportRecord) {
      return res.status(404).json({
        success: false,
        error: '导出记录不存在',
      });
    }
    
    // 检查用户是否有权限访问该项目
    const member = db.prepare(`
      SELECT id FROM project_members WHERE project_id = ? AND user_id = ?
    `).get(exportRecord.project_id, req.user!.id);
    
    const project = db.prepare('SELECT visibility FROM projects WHERE id = ?').get(exportRecord.project_id) as { visibility: string };
    
    if (!member && project.visibility !== 'public') {
      return res.status(403).json({
        success: false,
        error: '无权下载此文档',
      });
    }
    
    if (!fs.existsSync(exportRecord.file_path)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在',
      });
    }
    
    res.download(exportRecord.file_path);
  }
);

// 获取过滤配置
router.get(
  '/:projectId/filter-config',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    let filterConfig = db.prepare('SELECT * FROM filter_configs WHERE project_id = ?').get(projectId);
    
    if (!filterConfig) {
      // 创建默认配置
      db.prepare('INSERT INTO filter_configs (project_id) VALUES (?)').run(projectId);
      filterConfig = db.prepare('SELECT * FROM filter_configs WHERE project_id = ?').get(projectId);
    }
    
    res.json({
      success: true,
      data: filterConfig,
    });
  }
);

// 更新过滤配置
router.put(
  '/:projectId/filter-config',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const { filterOffTopic, filterNoise, customKeywords, strictness } = req.body;
    
    const updates: string[] = [];
    const values: (string | number)[] = [];
    
    if (filterOffTopic !== undefined) {
      updates.push('filter_off_topic = ?');
      values.push(filterOffTopic ? 1 : 0);
    }
    if (filterNoise !== undefined) {
      updates.push('filter_noise = ?');
      values.push(filterNoise ? 1 : 0);
    }
    if (customKeywords !== undefined) {
      updates.push('custom_keywords = ?');
      values.push(JSON.stringify(customKeywords));
    }
    if (strictness !== undefined) {
      updates.push('strictness = ?');
      values.push(strictness);
    }
    
    if (updates.length > 0) {
      values.push(projectId);
      db.prepare(`
        UPDATE filter_configs SET ${updates.join(', ')} WHERE project_id = ?
      `).run(...values);
    }
    
    const filterConfig = db.prepare('SELECT * FROM filter_configs WHERE project_id = ?').get(projectId);
    
    res.json({
      success: true,
      data: filterConfig,
    });
  }
);

// 获取被过滤的内容（用于审核）
router.get(
  '/:projectId/filtered-messages',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    const messages = db.prepare(`
      SELECT m.*, u.nickname as user_nickname
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.project_id = ? AND m.is_filtered = 1
      ORDER BY m.created_at DESC
    `).all(projectId);
    
    res.json({
      success: true,
      data: messages,
    });
  }
);

// 恢复被过滤的消息
router.post(
  '/:projectId/messages/:messageId/restore',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { messageId } = req.params;
    
    db.prepare(`
      UPDATE messages SET is_filtered = 0, filter_reason = NULL WHERE id = ?
    `).run(messageId);
    
    res.json({
      success: true,
      message: '消息已恢复',
    });
  }
);

// 手动过滤消息
router.post(
  '/:projectId/messages/:messageId/filter',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  [body('reason').optional()],
  (req: AuthRequest, res: Response) => {
    const { messageId } = req.params;
    const { reason } = req.body;
    
    db.prepare(`
      UPDATE messages SET is_filtered = 1, filter_reason = ? WHERE id = ?
    `).run(reason || '手动过滤', messageId);
    
    res.json({
      success: true,
      message: '消息已过滤',
    });
  }
);

// 辅助函数：获取文档标题
function getDocumentTitle(type: string, projectName: string, version: number): string {
  const typeNames: Record<string, string> = {
    prd: '产品需求文档',
    tech_design: '技术设计方案',
    api_doc: 'API 接口文档',
    db_design: '数据库设计文档',
    test_case: '测试用例文档',
    operation: '运营方案文档',
    user_manual: '用户手册',
  };
  
  return `${projectName} - ${typeNames[type] || '文档'} v${version}`;
}

// 辅助函数：简单的 Markdown 转 HTML
function convertMarkdownToHtml(markdown: string): string {
  return markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/```[\s\S]*?```/gim, (match) => {
      const code = match.replace(/```\w*\n?/g, '').replace(/```/g, '');
      return `<pre><code>${code}</code></pre>`;
    })
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/gim, '<br>');
}

export default router;
