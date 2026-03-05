import nodemailer from 'nodemailer';
import config from '../config';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export async function sendVerificationCode(email: string, code: string): Promise<boolean> {
  try {
    // 在开发环境下，只打印验证码
    if (config.nodeEnv === 'development') {
      console.log(`📧 验证码发送到 ${email}: ${code}`);
      return true;
    }
    
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: 'RequireAgent - 登录验证码',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">
            RequireAgent 登录验证码
          </h1>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            您的验证码是：
          </p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">
              ${code}
            </span>
          </div>
          <p style="color: #666; font-size: 14px; line-height: 1.5;">
            验证码有效期为 10 分钟，请尽快使用。
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            如果您没有请求此验证码，请忽略此邮件。
          </p>
        </div>
      `,
    });
    
    return true;
  } catch (error) {
    console.error('发送邮件失败:', error);
    return false;
  }
}

export async function sendInvitationEmail(
  email: string, 
  projectName: string, 
  inviterName: string,
  inviteLink: string
): Promise<boolean> {
  try {
    if (config.nodeEnv === 'development') {
      console.log(`📧 邀请邮件发送到 ${email}: ${inviteLink}`);
      return true;
    }
    
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: `${inviterName} 邀请您加入项目「${projectName}」`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">
            项目邀请
          </h1>
          <p style="color: #666; font-size: 16px; line-height: 1.5;">
            ${inviterName} 邀请您加入项目「<strong>${projectName}</strong>」
          </p>
          <div style="margin: 30px 0;">
            <a href="${inviteLink}" 
               style="display: inline-block; background: #3B82F6; color: white; padding: 12px 24px; 
                      border-radius: 8px; text-decoration: none; font-weight: 500;">
              接受邀请
            </a>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            如果您不认识发送者，请忽略此邮件。
          </p>
        </div>
      `,
    });
    
    return true;
  } catch (error) {
    console.error('发送邮件失败:', error);
    return false;
  }
}
