import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import db from '../database';
import config from '../config';
import { sendVerificationCode } from '../services/email.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// 发送验证码
router.post(
  '/send-code',
  [body('email').isEmail().withMessage('请输入有效的邮箱地址')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { email } = req.body;
    
    // 生成 6 位验证码
    const code = Math.random().toString().slice(2, 2 + config.verification.codeLength);
    const expiresAt = new Date(Date.now() + config.verification.codeExpiresIn);
    
    // 保存验证码
    const id = nanoid();
    db.prepare(`
      INSERT INTO verification_codes (id, email, code, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(id, email, code, expiresAt.toISOString());
    
    // 发送验证码邮件
    const sent = await sendVerificationCode(email, code);
    
    if (!sent && config.nodeEnv !== 'development') {
      return res.status(500).json({
        success: false,
        error: '验证码发送失败，请稍后重试',
      });
    }
    
    res.json({
      success: true,
      message: '验证码已发送',
    });
  }
);

// 验证码登录/注册
router.post(
  '/verify',
  [
    body('email').isEmail().withMessage('请输入有效的邮箱地址'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('请输入6位验证码'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { email, code } = req.body;
    
    // 验证验证码
    const verificationCode = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(email, code) as { id: string } | undefined;
    
    if (!verificationCode) {
      return res.status(400).json({
        success: false,
        error: '验证码无效或已过期',
      });
    }
    
    // 标记验证码已使用
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(verificationCode.id);
    
    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as {
      id: string;
      email: string;
      nickname: string;
      avatar: string | null;
      created_at: string;
    } | undefined;
    
    if (!user) {
      // 创建新用户
      const userId = nanoid();
      const nickname = email.split('@')[0];
      
      db.prepare(`
        INSERT INTO users (id, email, nickname)
        VALUES (?, ?, ?)
      `).run(userId, email, nickname);
      
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as typeof user;
    }
    
    // 生成 JWT
    const token = jwt.sign(
      { userId: user!.id, email: user!.email },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    
    res.json({
      success: true,
      data: {
        user: {
          id: user!.id,
          email: user!.email,
          nickname: user!.nickname,
          avatar: user!.avatar,
          createdAt: user!.created_at,
        },
        token,
      },
    });
  }
);

// 获取当前用户信息
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as {
    id: string;
    email: string;
    nickname: string;
    avatar: string | null;
    created_at: string;
    updated_at: string;
  };
  
  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
  });
});

// 更新用户信息
router.put(
  '/me',
  authMiddleware,
  [body('nickname').optional().isLength({ min: 1, max: 50 })],
  (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { nickname, avatar } = req.body;
    const updates: string[] = [];
    const values: (string | null)[] = [];
    
    if (nickname) {
      updates.push('nickname = ?');
      values.push(nickname);
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?');
      values.push(avatar);
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      values.push(req.user!.id);
      
      db.prepare(`
        UPDATE users SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);
    }
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as {
      id: string;
      email: string;
      nickname: string;
      avatar: string | null;
      created_at: string;
      updated_at: string;
    };
    
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar: user.avatar,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  }
);

export default router;
