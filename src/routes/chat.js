// src/routes/chat.js
// AI 对话相关接口

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const authMiddleware = require('../middleware/auth');

// 初始化 AI 客户端
function getAIClient() {
  const provider = process.env.AI_PROVIDER || 'anthropic';

  if (provider === 'groq') {
    // Groq 兼容 OpenAI 接口，用原生 fetch 调用
    return { type: 'groq' };
  }

  return {
    type: 'anthropic',
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  };
}

// ─────────────────────────────────────────
// POST /api/chat/session
// 创建一个新的对话会话
// ─────────────────────────────────────────
router.post('/session', async (req, res) => {
  try {
    const sessionId = uuidv4(); // 生成唯一会话 ID
    await pool.execute(
      'INSERT INTO sessions (id) VALUES (?)',
      [sessionId]
    );
    res.json({
      code: 0,
      success: true,
      data: {
        sessionId
      }
    })
  } catch (err) {
    console.error('创建会话失败:', err);
    res.status(500).json({ error: '创建会话失败' });
  }
});


router.post('/sessions', authMiddleware, async (req, res) => {
  const { email } = req.user;
  const page = parseInt(req.body.page) || 1;
  const pageSize = parseInt(req.body.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    const [countRows] = await pool.execute(
      `SELECT COUNT(DISTINCT session_id) as total
       FROM messages
       WHERE email = ? AND role = 'user'`,
      [email]
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT
        session_id,
        (SELECT content FROM messages m2
         WHERE m2.session_id = m1.session_id
         AND m2.role = 'user'
         ORDER BY m2.created_at ASC
         LIMIT 1) as title,
        MIN(m1.created_at) as created_at
      FROM messages m1
      WHERE m1.email = ? AND m1.role = 'user'
      GROUP BY m1.session_id
      ORDER BY MIN(m1.created_at) DESC
      LIMIT ${pageSize} OFFSET ${offset}`,   // ← 直接拼接，不用占位符
      [email]  // ← 只传 email 一个参数
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
    console.error('获取会话列表失败:', err);
    res.status(500).json({ error: '获取会话列表失败' });
  }
});

// ─────────────────────────────────────────
// GET /api/chat/history/:sessionId
// 获取某个会话的历史消息
// ─────────────────────────────────────────
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const [rows] = await pool.execute(
      'SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取历史失败:', err);
    res.status(500).json({ error: '获取历史失败' });
  }
});

// ─────────────────────────────────────────
// POST /api/chat/send 接口里，如果没有 sessionId 就自动创建
// 发送消息（流式响应，打字机效果）
router.post('/send', authMiddleware, async (req, res) => {
  console.log('/send接口----请求参数', req);
  let { sessionId, message } = req.body;
  const { email } = req.user;

  // ✅ 新增：检查用户状态和次数
  const [userRows] = await pool.execute(
    'SELECT quota, status FROM users WHERE email = ?',
    [email]
  );
  console.log('用户列表：', [userRows]);
  if (userRows.length === 0) {
    return res.status(401).json({ error: '用户不存在' });
  }
  const user = userRows[0];
  if (user.status === 0) {
    return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
  }
  if (user.quota <= 0) {
    return res.status(403).json({ error: '提问次数已用完，请联系管理员增加次数' });
  }

  // 没有 sessionId 说明是新对话，自动创建
  if (!sessionId) {
    sessionId = uuidv4();
    await pool.execute(
      'INSERT INTO sessions (id) VALUES (?)',
      [sessionId]
    );
  }

  // 参数校验
  if (!sessionId || !message?.trim() || !email) {
    return res.status(400).json({ error: 'sessionId 和 message 和 email 不能为空' });
  }

  try {
    // 1. 把用户消息存入数据库
    await pool.execute(
      'INSERT INTO messages (session_id, email, content, role) VALUES (?, ?, ?, ?)',
      [sessionId, email, message, 'user']
    );
    const [users] = await pool.execute('SELECT session_id, email, content, role FROM messages WHERE email = ? AND role = ?', [email, 'user'])
    console.log('users刚写入后的数据', [users])
    // 2. 从数据库读取完整历史（实现多轮对话记忆）
    const [rows] = await pool.execute(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );

    // 把数据库记录转换成 AI 接口需要的格式
    const historyMessages = rows.map(row => ({
      role: row.role,
      content: row.content,
    }));

    // 3. 设置流式响应头（SSE 协议）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 4. 调用 AI，流式输出
    const ai = getAIClient();
    let fullReply = ''; // 收集完整回复，最后存数据库

    if (ai.type === 'anthropic') {
      // ── Claude API 流式调用 ──
      const stream = ai.client.messages.stream({
        model: 'claude-haiku-4-5-20251001', // 最便宜的模型，适合开发测试
        max_tokens: 2048,
        system: '你是一个友好、专业的 AI 助手，用中文回答用户的问题。',
        messages: historyMessages,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          fullReply += chunk.delta.text;
          // 向前端推送数据
          res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
        }
      }

    } else if (ai.type === 'groq') {
      // const api_url = 'https://api.groq.com/openai/v1/chat/completions'
      const api_url = 'https://api.siliconflow.cn/v1/chat/completions'

      // ── Groq API 流式调用（免费）──
      const response = await fetch(api_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SILICONFLOW_API_KEY}`,
        },
        body: JSON.stringify({
          // model: 'llama-3.3-70b-versatile',
          // model: 'Qwen/Qwen2.5-72B-Instruct',
          // model: 'Pro/zai-org/GLM-4.7',
          "model": "deepseek-ai/DeepSeek-V3",
          messages: [
            { role: 'system', content: '你是一个友好、专业的 AI 助手，用中文回答用户的问题。' },
            ...historyMessages.slice(-8),
          ],
          stream: true,
          max_tokens: 512,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('SiliconFlow 调用失败:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
    
        throw new Error(`SiliconFlow ${response.status}: ${errorText}`);
      }
    
      if (!response.body) {
        throw new Error('SiliconFlow 未返回响应流');
      }
      res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.choices?.[0]?.delta?.content;
              if (text) {
                fullReply += text;
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
              }
            } catch (_) {}
          }
        }
      }
    }

    // 5. AI 回复完毕，存入数据库
    if (fullReply) {
      await pool.execute(
        'INSERT INTO messages (session_id, role, content, email) VALUES (?, ?, ?, ?)',
        [sessionId, 'assistant', fullReply, email]
      );

      // ✅ 新增：扣减提问次数
      await pool.execute(
        'UPDATE users SET quota = quota - 1 WHERE email = ?',
        [email]
      );
    }

    // 6. 发送结束信号
    // res.write('data: [DONE]\n\n');
    // res.end();
    res.write(`data: ${JSON.stringify({ done: true, sessionId })}\n\n`);
    res.end();

  } catch (err) {
    console.error('AI 对话失败:', err);
    // 如果还没发过响应头，返回 JSON 错误
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI 服务异常，请稍后重试' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'AI 服务异常' })}\n\n`);
      res.end();
    }
  }
});

// ─────────────────────────────────────────
// DELETE /api/chat/session/:sessionId
// 删除某个会话及其所有消息
// ─────────────────────────────────────────
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await pool.execute('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    await pool.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
    res.json({
      code: 0,
      success: true,
      data: sessionId
    })
  } catch (err) {
    console.error('删除会话失败:', err);
    res.status(500).json({ error: '删除会话失败' });
  }
});


router.post('/list', async (req, res) => {
  try {
    const { email } = req.body;
    await pool.execute('DELETE FROM messages WHERE session_id = ?', [sessionId]);
  } catch (error) {
    
  }
})


module.exports = router;
