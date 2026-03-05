import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { nanoid } from 'nanoid';
import db from '../database';
import { authMiddleware, AuthRequest, projectMemberMiddleware } from '../middleware/auth';

const router = Router();

// 创建项目
router.post(
  '/',
  authMiddleware,
  [
    body('name').notEmpty().withMessage('项目名称不能为空'),
    body('description').optional(),
    body('visibility').optional().isIn(['public', 'private']),
  ],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { name, description, visibility = 'private' } = req.body;
    const projectId = nanoid();
    const memberId = nanoid();
    
    // 创建项目
    db.prepare(`
      INSERT INTO projects (id, name, description, visibility, creator_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, name, description || '', visibility, req.user!.id);
    
    // 将创建者添加为项目成员（creator 角色）
    db.prepare(`
      INSERT INTO project_members (id, project_id, user_id, role)
      VALUES (?, ?, ?, 'creator')
    `).run(memberId, projectId, req.user!.id);
    
    // 创建默认过滤配置
    db.prepare(`
      INSERT INTO filter_configs (project_id)
      VALUES (?)
    `).run(projectId);
    
    // 创建默认 Agent 配置
    const agentId = nanoid();
    db.prepare(`
      INSERT INTO agent_configs (id, project_id, role, provider)
      VALUES (?, ?, 'general', 'openai')
    `).run(agentId, projectId);
    
    // 创建默认标签
    const defaultTags = [
      { name: '功能需求', color: '#3B82F6', category: 'feature' },
      { name: '技术需求', color: '#8B5CF6', category: 'technical' },
      { name: 'UI需求', color: '#EC4899', category: 'ui' },
      { name: '运营需求', color: '#F59E0B', category: 'operation' },
      { name: 'Bug', color: '#EF4444', category: 'bug' },
      { name: '改进建议', color: '#10B981', category: 'improvement' },
    ];
    
    const tagStmt = db.prepare(`
      INSERT INTO tags (id, project_id, name, color, category)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const tag of defaultTags) {
      tagStmt.run(nanoid(), projectId, tag.name, tag.color, tag.category);
    }
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    
    res.status(201).json({
      success: true,
      data: project,
    });
  }
);

// 获取项目列表
router.get(
  '/',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
  ],
  (req: AuthRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;
    
    // 获取用户参与的项目 + 公开项目
    const projects = db.prepare(`
      SELECT DISTINCT p.*, 
        pm.role as user_role,
        u.nickname as creator_name,
        (SELECT COUNT(*) FROM messages WHERE project_id = p.id) as message_count,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
      LEFT JOIN users u ON p.creator_id = u.id
      WHERE pm.user_id = ? OR p.visibility = 'public'
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user!.id, req.user!.id, pageSize, offset);
    
    const total = db.prepare(`
      SELECT COUNT(DISTINCT p.id) as count
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
      WHERE pm.user_id = ? OR p.visibility = 'public'
    `).get(req.user!.id, req.user!.id) as { count: number };
    
    res.json({
      success: true,
      data: {
        items: projects,
        total: total.count,
        page,
        pageSize,
        totalPages: Math.ceil(total.count / pageSize),
      },
    });
  }
);

// 获取单个项目
router.get(
  '/:projectId',
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    const project = db.prepare(`
      SELECT p.*, 
        u.nickname as creator_name,
        (SELECT COUNT(*) FROM messages WHERE project_id = p.id) as message_count,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
      FROM projects p
      LEFT JOIN users u ON p.creator_id = u.id
      WHERE p.id = ?
    `).get(projectId) as { visibility: string } | undefined;
    
    if (!project) {
      return res.status(404).json({
        success: false,
        error: '项目不存在',
      });
    }
    
    // 检查权限
    const member = db.prepare(`
      SELECT role FROM project_members WHERE project_id = ? AND user_id = ?
    `).get(projectId, req.user!.id);
    
    if (!member && project.visibility !== 'public') {
      return res.status(403).json({
        success: false,
        error: '无权访问此项目',
      });
    }
    
    res.json({
      success: true,
      data: {
        ...project,
        userRole: (member as { role: string } | undefined)?.role || 'guest',
      },
    });
  }
);

// 更新项目
router.put(
  '/:projectId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  [
    body('name').optional().notEmpty(),
    body('description').optional(),
    body('visibility').optional().isIn(['public', 'private']),
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
    const { name, description, visibility } = req.body;
    
    const updates: string[] = [];
    const values: string[] = [];
    
    if (name) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (visibility) {
      updates.push('visibility = ?');
      values.push(visibility);
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      values.push(projectId);
      
      db.prepare(`
        UPDATE projects SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);
    }
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    
    res.json({
      success: true,
      data: project,
    });
  }
);

// 删除项目
router.delete(
  '/:projectId',
  authMiddleware,
  projectMemberMiddleware(['creator']),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    
    res.json({
      success: true,
      message: '项目已删除',
    });
  }
);

// 获取项目成员
router.get(
  '/:projectId/members',
  authMiddleware,
  projectMemberMiddleware(),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    const members = db.prepare(`
      SELECT pm.*, u.email, u.nickname, u.avatar
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
      ORDER BY pm.joined_at
    `).all(projectId);
    
    res.json({
      success: true,
      data: members,
    });
  }
);

// 更新成员角色
router.put(
  '/:projectId/members/:memberId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  [body('role').isIn(['admin', 'member', 'guest'])],
  (req: AuthRequest, res: Response) => {
    const { projectId, memberId } = req.params;
    const { role } = req.body;
    
    // 不能修改创建者的角色
    const member = db.prepare(`
      SELECT role FROM project_members WHERE id = ? AND project_id = ?
    `).get(memberId, projectId) as { role: string } | undefined;
    
    if (!member) {
      return res.status(404).json({
        success: false,
        error: '成员不存在',
      });
    }
    
    if (member.role === 'creator') {
      return res.status(400).json({
        success: false,
        error: '无法修改项目创建者的角色',
      });
    }
    
    db.prepare(`
      UPDATE project_members SET role = ? WHERE id = ?
    `).run(role, memberId);
    
    res.json({
      success: true,
      message: '角色已更新',
    });
  }
);

// 移除成员
router.delete(
  '/:projectId/members/:memberId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { projectId, memberId } = req.params;
    
    const member = db.prepare(`
      SELECT role FROM project_members WHERE id = ? AND project_id = ?
    `).get(memberId, projectId) as { role: string } | undefined;
    
    if (!member) {
      return res.status(404).json({
        success: false,
        error: '成员不存在',
      });
    }
    
    if (member.role === 'creator') {
      return res.status(400).json({
        success: false,
        error: '无法移除项目创建者',
      });
    }
    
    db.prepare('DELETE FROM project_members WHERE id = ?').run(memberId);
    
    res.json({
      success: true,
      message: '成员已移除',
    });
  }
);

// 获取项目标签
router.get(
  '/:projectId/tags',
  authMiddleware,
  projectMemberMiddleware(),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    const tags = db.prepare(`
      SELECT * FROM tags WHERE project_id = ? ORDER BY category, name
    `).all(projectId);
    
    res.json({
      success: true,
      data: tags,
    });
  }
);

// 创建标签
router.post(
  '/:projectId/tags',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin', 'member']),
  [
    body('name').notEmpty().withMessage('标签名称不能为空'),
    body('color').optional(),
    body('category').optional().isIn(['feature', 'technical', 'ui', 'operation', 'bug', 'improvement', 'other']),
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
    const { name, color = '#3B82F6', category = 'other' } = req.body;
    
    // 检查标签是否已存在
    const existing = db.prepare(`
      SELECT id FROM tags WHERE project_id = ? AND name = ?
    `).get(projectId, name);
    
    if (existing) {
      return res.status(400).json({
        success: false,
        error: '标签已存在',
      });
    }
    
    const tagId = nanoid();
    db.prepare(`
      INSERT INTO tags (id, project_id, name, color, category)
      VALUES (?, ?, ?, ?, ?)
    `).run(tagId, projectId, name, color, category);
    
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId);
    
    res.status(201).json({
      success: true,
      data: tag,
    });
  }
);

// 删除标签
router.delete(
  '/:projectId/tags/:tagId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { tagId } = req.params;
    
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
    
    res.json({
      success: true,
      message: '标签已删除',
    });
  }
);

export default router;
