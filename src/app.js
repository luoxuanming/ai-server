/*
 * @Author: luoxuanming 1316570222@qq.com
 * @Date: 2026-05-07 11:14:03
 * @LastEditors: luoxuanming 1316570222@qq.com
 * @LastEditTime: 2026-06-22 13:18:25
 * @FilePath: /ai-server/src/app.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { testConnection } = require('./db');
const chatRouter = require('./routes/chat');
const authRouter = require('./routes/auth');
const userRouter = require('./routes/user');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────
// 下划线转小驼峰工具函数
// ─────────────────────────────────────────
function convertKeysToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(convertKeysToCamel);
  
  // ✅ 加这一行：Date 对象直接返回，不做 key 转换
  if (obj instanceof Date) return obj;

  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        convertKeysToCamel(v)
      ])
    );
  }
  return obj;
}

// ─────────────────────────────────────────
// 中间件配置
// ─────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));

// ✅ 全局响应自动转小驼峰（放在路由注册之前）
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => originalJson(convertKeysToCamel(data));
  next();
});

// ─────────────────────────────────────────
// 路由注册
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    ai_provider: process.env.AI_PROVIDER || 'anthropic',
  });
});

// 管理员接口（需要登录 + 管理员身份）
app.use('/api/user', authMiddleware, userRouter);

app.use('/api/auth', authRouter);
app.use('/api/chat', authMiddleware, chatRouter);

app.use((req, res) => {
  res.status(404).json({ error: `接口不存在: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

async function start() {
  await testConnection();

  app.listen(PORT, () => {
    console.log('');
    console.log('🚀 AI 后端服务已启动！');
    console.log(`📡 服务地址：http://localhost:${PORT}`);
    console.log(`🤖 AI 服务：${process.env.AI_PROVIDER || 'anthropic'}`);
    console.log('');
    console.log('可用接口：');
    console.log(`  GET    http://localhost:${PORT}/health`);
    console.log(`  POST   http://localhost:${PORT}/api/chat/session`);
    console.log(`  GET    http://localhost:${PORT}/api/chat/history/:sessionId`);
    console.log(`  POST   http://localhost:${PORT}/api/chat/send`);
    console.log(`  DELETE http://localhost:${PORT}/api/chat/session/:sessionId`);
    console.log('');
  });
}

start();