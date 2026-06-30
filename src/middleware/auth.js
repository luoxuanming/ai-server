/*
 * @Author: luoxuanming 1316570222@qq.com
 * @Date: 2026-05-13 12:21:02
 * @LastEditors: luoxuanming 1316570222@qq.com
 * @LastEditTime: 2026-05-13 12:21:26
 * @FilePath: /ai-server/src/middleware/auth.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// src/middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

module.exports = function authMiddleware(req, res, next) {
  // 从请求头获取 Token
  const token = req.headers['authorization']?.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // 把用户信息挂到 req 上，后续接口可以用
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 已过期，请重新登录' });
  }
};