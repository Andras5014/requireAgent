import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import db from '../database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    nickname: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: '未提供认证令牌',
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      email: string;
    };
    
    // 从数据库获取用户信息
    const user = db.prepare('SELECT id, email, nickname FROM users WHERE id = ?').get(decoded.userId) as {
      id: string;
      email: string;
      nickname: string;
    } | undefined;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户不存在',
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: '无效的认证令牌',
    });
  }
}

export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      email: string;
    };
    
    const user = db.prepare('SELECT id, email, nickname FROM users WHERE id = ?').get(decoded.userId) as {
      id: string;
      email: string;
      nickname: string;
    } | undefined;
    
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // 忽略无效令牌，继续处理请求
  }
  
  next();
}

// 检查用户是否是项目成员
export function projectMemberMiddleware(requiredRoles?: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const projectId = req.params.projectId || req.body.projectId;
    const userId = req.user?.id;
    
    if (!projectId || !userId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数',
      });
    }
    
    const member = db.prepare(`
      SELECT role FROM project_members 
      WHERE project_id = ? AND user_id = ?
    `).get(projectId, userId) as { role: string } | undefined;
    
    if (!member) {
      // 检查是否是公开项目
      const project = db.prepare('SELECT visibility FROM projects WHERE id = ?').get(projectId) as { visibility: string } | undefined;
      
      if (!project || project.visibility !== 'public') {
        return res.status(403).json({
          success: false,
          error: '您不是该项目的成员',
        });
      }
    }
    
    if (requiredRoles && member && !requiredRoles.includes(member.role)) {
      return res.status(403).json({
        success: false,
        error: '您没有执行此操作的权限',
      });
    }
    
    next();
  };
}
