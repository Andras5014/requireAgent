import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { nanoid } from 'nanoid';
import db from '../database';
import { authMiddleware, AuthRequest, projectMemberMiddleware } from '../middleware/auth';

const router = Router();

// 创建邀请链接
router.post(
  '/:projectId/invitations',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  [
    body('maxUses').optional().isInt({ min: 1 }),
    body('expiresIn').optional().isInt({ min: 1 }), // 过期时间（小时）
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
    const { maxUses, expiresIn } = req.body;
    
    const inviteId = nanoid();
    const inviteCode = nanoid(10);
    
    let expiresAt = null;
    if (expiresIn) {
      const expires = new Date();
      expires.setHours(expires.getHours() + expiresIn);
      expiresAt = expires.toISOString();
    }
    
    db.prepare(`
      INSERT INTO invitations (id, project_id, code, created_by, expires_at, max_uses)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(inviteId, projectId, inviteCode, req.user!.id, expiresAt, maxUses || null);
    
    const invitation = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inviteId);
    
    res.status(201).json({
      success: true,
      data: {
        ...invitation,
        inviteLink: `/invite/${inviteCode}`,
      },
    });
  }
);

// 获取项目的邀请链接列表
router.get(
  '/:projectId/invitations',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { projectId } = req.params;
    
    const invitations = db.prepare(`
      SELECT i.*, u.nickname as created_by_name
      FROM invitations i
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.project_id = ?
      ORDER BY i.created_at DESC
    `).all(projectId);
    
    res.json({
      success: true,
      data: invitations,
    });
  }
);

// 删除邀请链接
router.delete(
  '/:projectId/invitations/:inviteId',
  authMiddleware,
  projectMemberMiddleware(['creator', 'admin']),
  (req: AuthRequest, res: Response) => {
    const { inviteId } = req.params;
    
    db.prepare('DELETE FROM invitations WHERE id = ?').run(inviteId);
    
    res.json({
      success: true,
      message: '邀请链接已删除',
    });
  }
);

// 通过邀请码加入项目
router.post(
  '/join/:inviteCode',
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    const { inviteCode } = req.params;
    
    // 查找邀请链接
    const invitation = db.prepare(`
      SELECT * FROM invitations WHERE code = ?
    `).get(inviteCode) as {
      id: string;
      project_id: string;
      expires_at: string | null;
      max_uses: number | null;
      used_count: number;
    } | undefined;
    
    if (!invitation) {
      return res.status(404).json({
        success: false,
        error: '邀请链接无效',
      });
    }
    
    // 检查是否过期
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: '邀请链接已过期',
      });
    }
    
    // 检查使用次数
    if (invitation.max_uses && invitation.used_count >= invitation.max_uses) {
      return res.status(400).json({
        success: false,
        error: '邀请链接已达到最大使用次数',
      });
    }
    
    // 检查是否已经是成员
    const existingMember = db.prepare(`
      SELECT id FROM project_members WHERE project_id = ? AND user_id = ?
    `).get(invitation.project_id, req.user!.id);
    
    if (existingMember) {
      return res.status(400).json({
        success: false,
        error: '您已经是该项目的成员',
      });
    }
    
    // 添加为项目成员
    const memberId = nanoid();
    db.prepare(`
      INSERT INTO project_members (id, project_id, user_id, role)
      VALUES (?, ?, ?, 'member')
    `).run(memberId, invitation.project_id, req.user!.id);
    
    // 更新邀请链接使用次数
    db.prepare(`
      UPDATE invitations SET used_count = used_count + 1 WHERE id = ?
    `).run(invitation.id);
    
    // 获取项目信息
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(invitation.project_id);
    
    res.json({
      success: true,
      data: {
        project,
        message: '成功加入项目',
      },
    });
  }
);

// 获取邀请链接信息（公开接口，用于预览）
router.get(
  '/preview/:inviteCode',
  (req, res) => {
    const { inviteCode } = req.params;
    
    const invitation = db.prepare(`
      SELECT i.*, p.name as project_name, p.description as project_description,
        u.nickname as created_by_name,
        (SELECT COUNT(*) FROM project_members WHERE project_id = i.project_id) as member_count
      FROM invitations i
      JOIN projects p ON i.project_id = p.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.code = ?
    `).get(inviteCode) as {
      expires_at: string | null;
      max_uses: number | null;
      used_count: number;
      project_name: string;
      project_description: string;
    } | undefined;
    
    if (!invitation) {
      return res.status(404).json({
        success: false,
        error: '邀请链接无效',
      });
    }
    
    // 检查是否过期
    const isExpired = invitation.expires_at && new Date(invitation.expires_at) < new Date();
    const isExhausted = invitation.max_uses && invitation.used_count >= invitation.max_uses;
    
    res.json({
      success: true,
      data: {
        projectName: invitation.project_name,
        projectDescription: invitation.project_description,
        isValid: !isExpired && !isExhausted,
        isExpired,
        isExhausted,
      },
    });
  }
);

export default router;
