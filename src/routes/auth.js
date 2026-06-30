// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { generateCode, sendCode } = require('../utils/mailer');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';

// 邮箱格式校验
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─────────────────────────────────────────
// POST /api/auth/send-code  发送验证码
// ─────────────────────────────────────────
router.post('/send-code', async (req, res) => {
  const { email, type } = req.body; // type: register / reset

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  try {
    // 注册时检查邮箱是否已存在
    if (type === 'register') {
      const [rows] = await pool.execute(
        'SELECT id FROM users WHERE email = ?', [email]
      );
      if (rows.length > 0) {
        return res.status(400).json({ error: '该邮箱已注册' });
      }
    }

    // 找回密码时检查邮箱是否存在
    if (type === 'reset') {
      const [rows] = await pool.execute(
        'SELECT id FROM users WHERE email = ?', [email]
      );
      if (rows.length === 0) {
        return res.status(400).json({ error: '该邮箱未注册' });
      }
    }

    // 60秒内只能发一次（防刷）
    const [recent] = await pool.execute(
      `SELECT id FROM email_codes
       WHERE email = ? AND type = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
      [email, type]
    );
    if (recent.length > 0) {
      return res.status(400).json({ error: '发送太频繁，请60秒后再试' });
    }

    // 生成验证码，5分钟有效
    const code = generateCode();
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000);

    await pool.execute(
      'INSERT INTO email_codes (email, code, type, expired_at) VALUES (?, ?, ?, ?)',
      [email, code, type, expiredAt]
    );

    // 发送邮件
    await sendCode(email, code, type);

    res.json({ success: true, message: '验证码已发送，请查收邮件' });
  } catch (err) {
    console.error('发送验证码失败:', err);
    res.status(500).json({ error: '发送失败，请稍后重试' });
  }
});

// ─────────────────────────────────────────
// POST /api/auth/register  注册
// ─────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, code, nickname } = req.body;

  if (!isValidEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!password || password.length < 6) return res.status(400).json({ error: '密码不能少于6位' });
  // if (!code) return res.status(400).json({ error: '请输入验证码' });

  try {
    // 验证验证码
    // const [codes] = await pool.execute(
    //   `SELECT id FROM email_codes
    //    WHERE email = ? AND code = ? AND type = 'register'
    //    AND expired_at > NOW() AND used = 0
    //    ORDER BY created_at DESC LIMIT 1`,
    //   [email, code]
    // );
    // if (codes.length === 0) {
    //   return res.status(400).json({ error: '验证码错误或已过期' });
    // }

    // // 标记验证码已使用
    // await pool.execute(
    //   'UPDATE email_codes SET used = 1 WHERE id = ?', [codes[0].id]
    // );

    const [users] = await pool.execute(
      'SELECT id FROM users WHERE email = ? ORDER BY created_at DESC',
      [email]
    );

    if(users.length > 0) {
      res.json({
        code: -1,
        success: false, 
        error: '用户名已被注册' 
      });
      return
    }

    // 加密密码，创建用户
    const hashedPassword = await bcrypt.hash(password, 10);
    const role = 2; // 1: 管理员 2:游客
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, nickname, role) VALUES (?, ?, ?, ?)',
      [email, hashedPassword, nickname || email.split('@')[0], role]
    );

    const token = jwt.sign(
      { id: result.insertId, email, nickname: nickname || email.split('@')[0] },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );

    res.json({
      code: 0,
      success: true, 
      data: {
        token,
        user: { 
          id: result.insertId, 
          email, 
          nickname: nickname || email.split('@')[0],
          role: role
        }
      }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.json({
      code: -1,
      success: false, 
      error: '注册失败，请稍后重试' 
    });
  }
});

// ─────────────────────────────────────────
// POST /api/auth/login  登录（邮箱+密码）
// ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!isValidEmail(email)) return res.json({ code: -1, error: '邮箱格式不正确' });

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ?', [email]
    );
    if (rows.length === 0) {
      return res.json({ code: -1, error: '邮箱或密码错误' });
    }

    const user = rows[0];
    console.log('password', password);
    console.log('user.password', user.password);
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ error: '邮箱或密码错误' });

    const token = jwt.sign(
      { id: user.id, email: user.email, nickname: user.nickname, role: user.role }, // ← 加 role
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      code: 0,
      success: true, 
      data: {
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role }
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// ─────────────────────────────────────────
// POST /api/auth/reset-password  重置密码
// ─────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!isValidEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密码不能少于6位' });

  try {
    // 验证验证码
    const [codes] = await pool.execute(
      `SELECT id FROM email_codes
       WHERE email = ? AND code = ? AND type = 'reset'
       AND expired_at > NOW() AND used = 0
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (codes.length === 0) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }

    await pool.execute('UPDATE email_codes SET used = 1 WHERE id = ?', [codes[0].id]);

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]
    );

    res.json({ success: true, message: '密码重置成功，请重新登录' });
  } catch (err) {
    console.error('重置密码失败:', err);
    res.status(500).json({ error: '重置失败，请稍后重试' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;