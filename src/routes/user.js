// src/routes/admin.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// 管理员权限中间件
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ error: '无权限，仅管理员可操作' });
  }
  next();
};

// ─────────────────────────────────────────
// POST /api/admin/users  获取用户列表（分页）
// ─────────────────────────────────────────
router.post('/list', adminMiddleware, async (req, res) => {
  const page = parseInt(req.body.page) || 1;
  const pageSize = parseInt(req.body.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM users'
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT id, email, nickname, quota, status, role, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`
    );

    res.json({
      code: 0,
      success: true,
      data: rows,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasMore: page * pageSize < total,
      }
    });
  } catch (err) {
    console.error('获取用户列表失败:', err);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

// ─────────────────────────────────────────
// POST /api/admin/users/:id/quota  修改用户次数
// ─────────────────────────────────────────
router.post('/users/:id/quota', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { quota } = req.body;

  if (quota === undefined || quota < 0) {
    return res.status(400).json({ error: '次数不合法' });
  }

  try {
    await pool.execute(
      'UPDATE users SET quota = ? WHERE id = ?',
      [parseInt(quota), id]
    );
    res.json({ code: 0, success: true, data: { id, quota } });
  } catch (err) {
    console.error('修改次数失败:', err);
    res.status(500).json({ error: '修改次数失败' });
  }
});

// ─────────────────────────────────────────
// POST /api/admin/users/:id/status  禁用/启用用户
// ─────────────────────────────────────────
router.post('/users/:id/status', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;  // 1 启用 0 禁用

  if (status !== 0 && status !== 1) {
    return res.status(400).json({ error: 'status 只能是 0 或 1' });
  }

  try {
    await pool.execute(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, id]
    );
    res.json({
      code: 0,
      success: true,
      data: { id, status }
    });
  } catch (err) {
    console.error('修改状态失败:', err);
    res.status(500).json({ error: '修改状态失败' });
  }
});

module.exports = router;