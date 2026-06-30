// src/utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: true, // 465端口用true
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// 生成6位随机验证码
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 发送验证码邮件
async function sendCode(to, code, type) {
  const subjects = {
    register: '注册验证码',
    reset: '找回密码验证码',
  };
  const actions = {
    register: '完成注册',
    reset: '重置密码',
  };

  console.log('邮件配置:', {
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS ? '已设置' : '未设置',
    from: process.env.MAIL_FROM,
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: `【AI助手】${subjects[type]}`,
    html: `
      <div style="max-width:480px;margin:0 auto;padding:40px 20px;font-family:sans-serif;">
        <h2 style="color:#4f6ef7;text-align:center;">AI 助手</h2>
        <p>你好！请使用以下验证码${actions[type]}：</p>
        <div style="
          font-size:36px;font-weight:bold;letter-spacing:8px;
          text-align:center;color:#4f6ef7;
          background:#f0f4ff;border-radius:12px;
          padding:20px;margin:24px 0;
        ">${code}</div>
        <p style="color:#999;font-size:13px;">
          验证码 5 分钟内有效，请勿泄露给他人。<br/>
          如非本人操作，请忽略此邮件。
        </p>
      </div>
    `,
  });
}

module.exports = { generateCode, sendCode };