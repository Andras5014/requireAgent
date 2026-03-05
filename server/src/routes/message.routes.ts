import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { nanoid } from 'nanoid';
import db from '../database';
import { authMiddleware, AuthRequest, projectMemberMiddleware } from '../middleware/auth';
import { chat } from '../services/llm.service';

const router = Router();

// 获取项目消息列表
router.get(
  '/:projectId/messages',
  authMiddleware,
  projectMemberMiddleware(),
  [
    query('page').optional().isInt({ min: 1 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
    query('tags').optional(),
    query('includeFiltered').optional().isBoolean(),
  ],
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const offset = (page - 1) * pageSize;
    const tags = req.query.tags ? (req.query.tags as string).split(',') : null;
    const includeFiltered = req.query.includeFiltered === 'true';
    
    let whereClause = 'WHERE m.project_id = ?';
    const params: (string | number)[] = [projectId];
    
    if (!includeFiltered) {
      whereClause += ' AND m.is_filtered = 0';
    }
    
    if (tags && tags.length > 0) {
      whereClause += ` AND m.id IN (
        SELECT message_id FROM message_tags WHERE tag_id IN (
          SELECT id FROM tags WHERE project_id = ? AND name IN (${tags.map(() => '?').join(',')})
        )
      )`;
      params.push(projectId, ...tags);
    }
    
    const messages = db.prepare(`
      SELECT m.*,
        u.nickname as user_nickname,
        u.avatar as user_avatar,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        (SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'up') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'down') as downvotes,
        (SELECT type FROM votes WHERE message_id = m.id AND user_id = ?) as user_vote
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN message_tags mt ON m.id = mt.message_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      ${whereClause}
      GROUP BY m.id
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?
    `).all(req.user!.id, ...params, pageSize, offset);
    
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM messages m ${whereClause}
    `).get(...params) as { count: number };
    
    res.json({
      success: true,
      data: {
        items: messages.map((m: Record<string, unknown>) => ({
          ...m,
          tags: m.tag_names ? (m.tag_names as string).split(',') : [],
        })),
        total: total.count,
        page,
        pageSize,
        totalPages: Math.ceil(total.count / pageSize),
      },
    });
  }
);

// 发送消息（REST API，WebSocket 也可发送）
router.post(
  '/:projectId/messages',
  authMiddleware,
  projectMemberMiddleware(),
  [
    body('content').notEmpty().withMessage('消息内容不能为空'),
    body('replyTo').optional(),
    body('tags').optional().isArray(),
  ],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { projectId } = req.params;
    const { content, replyTo, tags } = req.body;
    
    const messageId = nanoid();
    
    db.prepare(`
      INSERT INTO messages (id, project_id, user_id, type, content, reply_to)
      VALUES (?, ?, ?, 'user', ?, ?)
    `).run(messageId, projectId, req.user!.id, content, replyTo || null);
    
    // 添加标签
    if (tags && tags.length > 0) {
      const tagStmt = db.prepare(`
        INSERT OR IGNORE INTO message_tags (message_id, tag_id)
        SELECT ?, id FROM tags WHERE project_id = ? AND name = ?
      `);
      
      for (const tag of tags) {
        tagStmt.run(messageId, projectId, tag);
      }
    }
    
    // 更新项目更新时间
    db.prepare('UPDATE projects SET updated_at = datetime("now") WHERE id = ?').run(projectId);
    
    const message = db.prepare(`
      SELECT m.*, u.nickname as user_nickname, u.avatar as user_avatar
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(messageId);
    
    res.status(201).json({
      success: true,
      data: {
        ...message,
        tags: tags || [],
      },
    });
  }
);

// 删除消息
router.delete(
  '/:projectId/messages/:messageId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { messageId } = req.params;
    
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    
    res.json({
      success: true,
      message: '消息已删除',
    });
  }
);

// 投票
router.post(
  '/:projectId/messages/:messageId/vote',
  authMiddleware,
  projectMemberMiddleware(),
  [body('type').isIn(['up', 'down'])],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { messageId } = req.params;
    const { type } = req.body;
    
    // 检查是否已投票
    const existingVote = db.prepare(`
      SELECT id, type FROM votes WHERE message_id = ? AND user_id = ?
    `).get(messageId, req.user!.id) as { id: string; type: string } | undefined;
    
    if (existingVote) {
      if (existingVote.type === type) {
        // 取消投票
        db.prepare('DELETE FROM votes WHERE id = ?').run(existingVote.id);
      } else {
        // 更改投票
        db.prepare('UPDATE votes SET type = ? WHERE id = ?').run(type, existingVote.id);
      }
    } else {
      // 新投票
      const voteId = nanoid();
      db.prepare(`
        INSERT INTO votes (id, message_id, user_id, type)
        VALUES (?, ?, ?, ?)
      `).run(voteId, messageId, req.user!.id, type);
    }
    
    // 获取更新后的投票统计
    const stats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM votes WHERE message_id = ? AND type = 'up') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE message_id = ? AND type = 'down') as downvotes
    `).get(messageId, messageId) as { upvotes: number; downvotes: number };
    
    const userVote = db.prepare(`
      SELECT type FROM votes WHERE message_id = ? AND user_id = ?
    `).get(messageId, req.user!.id) as { type: string } | undefined;
    
    res.json({
      success: true,
      data: {
        upvotes: stats.upvotes,
        downvotes: stats.downvotes,
        score: stats.upvotes - stats.downvotes,
        userVote: userVote?.type || null,
      },
    });
  }
);

// 给消息添加标签
router.post(
  '/:projectId/messages/:messageId/tags',
  authMiddleware,
  projectMemberMiddleware(),
  [body('tags').isArray().withMessage('标签必须是数组')],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { projectId, messageId } = req.params;
    const { tags } = req.body;
    
    // 删除现有标签
    db.prepare('DELETE FROM message_tags WHERE message_id = ?').run(messageId);
    
    // 添加新标签
    if (tags && tags.length > 0) {
      const tagStmt = db.prepare(`
        INSERT OR IGNORE INTO message_tags (message_id, tag_id)
        SELECT ?, id FROM tags WHERE project_id = ? AND name = ?
      `);
      
      for (const tag of tags) {
        tagStmt.run(messageId, projectId, tag);
      }
    }
    
    res.json({
      success: true,
      message: '标签已更新',
    });
  }
);

// 获取热门/高投票的需求
router.get(
  '/:projectId/messages/top',
  authMiddleware,
  projectMemberMiddleware(),
  [query('limit').optional().isInt({ min: 1, max: 50 })],
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const messages = db.prepare(`
      SELECT m.*,
        u.nickname as user_nickname,
        u.avatar as user_avatar,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        (SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'up') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'down') as downvotes,
        ((SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'up') - 
         (SELECT COUNT(*) FROM votes WHERE message_id = m.id AND type = 'down')) as score
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN message_tags mt ON m.id = mt.message_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE m.project_id = ? AND m.is_filtered = 0 AND m.type = 'user'
      GROUP BY m.id
      HAVING score > 0
      ORDER BY score DESC, m.created_at DESC
      LIMIT ?
    `).all(projectId, limit);
    
    res.json({
      success: true,
      data: messages.map((m: Record<string, unknown>) => ({
        ...m,
        tags: m.tag_names ? (m.tag_names as string).split(',') : [],
      })),
    });
  }
);

// 生成聊天内容总结
router.post(
  '/:projectId/messages/summary',
  authMiddleware,
  projectMemberMiddleware(),
  async (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    try {
      // 获取项目信息
      const project = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(projectId) as {
        name: string;
        description: string;
      };
      
      if (!project) {
        return res.status(404).json({ success: false, error: '项目不存在' });
      }
      
      // 获取所有未过滤的消息
      const messages = db.prepare(`
        SELECT m.content, m.type, m.created_at,
          u.nickname as user_nickname,
          GROUP_CONCAT(DISTINCT t.name) as tag_names
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.id
        LEFT JOIN message_tags mt ON m.id = mt.message_id
        LEFT JOIN tags t ON mt.tag_id = t.id
        WHERE m.project_id = ? AND m.is_filtered = 0
        GROUP BY m.id
        ORDER BY m.created_at ASC
      `).all(projectId) as Array<{
        content: string;
        type: string;
        created_at: string;
        user_nickname: string | null;
        tag_names: string | null;
      }>;
      
      if (messages.length === 0) {
        return res.status(400).json({ success: false, error: '没有可总结的内容' });
      }
      
      // 构建聊天记录文本
      const chatHistory = messages.map(m => {
        const speaker = m.type === 'agent' ? '🤖 AI Agent' : (m.user_nickname || '用户');
        const tags = m.tag_names ? ` [${m.tag_names}]` : '';
        return `${speaker}${tags}: ${m.content}`;
      }).join('\n\n');
      
      // 调用 LLM 生成总结
      const systemPrompt = `你是一个专业的需求分析助手，请对以下项目讨论内容进行全面总结。

**项目信息：**
- 项目名称：${project.name}
- 项目描述：${project.description || '暂无描述'}

请按以下结构生成总结：

## 📋 讨论概览
简要描述讨论的主要话题和参与情况（1-2句话）

## 🎯 核心需求
按优先级列出已明确的核心需求和功能点

## 💡 关键决策
列出讨论中做出的重要决策和结论

## ❓ 待确认事项
列出尚未明确或存在分歧的问题

## 📊 需求分类
按类型（功能需求/非功能需求/技术需求等）对需求进行分类

## 💬 重要观点
摘录讨论中的重要观点和建议（标注发言人）

## 📝 下一步行动
建议的后续行动项

请使用简洁专业的语言，确保总结准确反映讨论内容。`;

      const response = await chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `以下是项目讨论记录（共 ${messages.length} 条消息）：\n\n${chatHistory}` },
      ]);
      
      // 保存总结为系统消息
      const summaryId = nanoid();
      db.prepare(`
        INSERT INTO messages (id, project_id, type, content)
        VALUES (?, ?, 'system', ?)
      `).run(summaryId, projectId, `📑 **讨论内容总结**\n\n${response.content}`);
      
      res.json({
        success: true,
        data: {
          id: summaryId,
          summary: response.content,
          messageCount: messages.length,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('生成总结失败:', error);
      res.status(500).json({
        success: false,
        error: '生成总结失败: ' + (error as Error).message,
      });
    }
  }
);

export default router;
