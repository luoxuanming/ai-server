// src/db/index.js
// MySQL 数据库连接池

const mysql = require('mysql2/promise');

// 创建连接池（比单连接更稳定，自动复用连接）
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,     // 最多同时 10 个连接
  queueLimit: 0,
  charset: 'utf8mb4',
});

// 测试连接是否正常
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL 数据库连接成功');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL 连接失败:', err.message);
    console.error('请检查 .env 文件中的数据库配置');
    process.exit(1); // 连不上数据库就直接退出
  }
}

module.exports = { pool, testConnection };
