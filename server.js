/**
 * 事事如嗦 — 后端服务（已完美适配 Vercel 部署环境）
 */
// 移除本地 dotenv 的硬加载，Vercel 会自动注入环境变量
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    /* 本地未安装 dotenv 时忽略 */
  }
}

const express = require('express');
const path = require('path');

const app = express();

/** @type {string} Coze API 根地址 */
function normalizeCozeApiBase(raw) {
  let base = (raw || 'https://api.coze.cn').trim().replace(/\/$/, '');
  base = base.replace(/\/v3\/chat\/?$/i, '');
  return base;
}
const COZE_API_BASE = normalizeCozeApiBase(process.env.COZE_API_BASE);
const COZE_API_TOKEN = (process.env.COZE_API_TOKEN || '').trim();
const COZE_BOT_ID = (process.env.COZE_BOT_ID || '').trim();
const COZE_USER_ID = (process.env.COZE_USER_ID || 'user_local_001').trim();
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

const cozeConfigured = Boolean(COZE_API_TOKEN && COZE_BOT_ID);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

// 核心修复一：显式映射根路由，彻底砸碎 "Cannot GET /" 报错
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    cozeConfigured,
    demoMode: !cozeConfigured && DEMO_MODE,
    apiBase: COZE_API_BASE,
  });
});

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function demoReply(message) {
  const templates = [
    `谢谢你愿意说出来。关于「${message.slice(0, 24)}${message.length > 24 ? '…' : ''}」，我能感受到你在认真面对自己的感受。\n\n我们可以先慢一点：此刻你的身体感觉如何？胸口、肩膀或呼吸，有没有哪里特别紧？`,
    `我听到你了。你并不孤单，愿意表达本身就是一种勇气。\n\n如果愿意，可以多说一点：这件事是从什么时候开始的？当时你最强烈的情绪是什么？`,
    `你的感受是真实且值得被重视的。我们不必急着给出答案，先一起把情绪安放好。\n\n此刻，做三次缓慢的深呼吸，然后告诉我：如果给今天的情绪打一个 0–10 分，你会打几分？`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

async function streamDemoReply(res, text) {
  writeSse(res, 'meta', { conversationId: null, demo: true });
  const chunks = text.match(/[\s\S]{1,8}/g) || [text];
  for (const chunk of chunks) {
    writeSse(res, 'delta', { content: chunk });
    await new Promise((r) => setTimeout(r, 40));
  }
  writeSse(res, 'done', { content: text });
  res.end();
}

function parseCozeSseChunk(buffer, onEvent) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() || '';
  for (const block of parts) {
    let event = 'message';
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      onEvent(event, JSON.parse(dataStr));
    } catch {
      /* ignore malformed chunks */
    }
  }
  return rest;
}

app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = req.body || {};
  const userMessage = String(message || '').trim();

  if (!userMessage) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  if (!cozeConfigured) {
    if (!DEMO_MODE) {
      writeSse(res, 'error', {
        message: '尚未配置 Coze API。请在 Vercel 平台的 Settings -> Environment Variables 中填入 COZE_API_TOKEN 与 COZE_BOT_ID。',
      });
      return res.end();
    }
    return streamDemoReply(res, demoReply(userMessage));
  }

  const url = new URL(`${COZE_API_BASE}/v3/chat`);
  if (conversationId) url.searchParams.set('conversation_id', conversationId);

  const body = {
    bot_id: COZE_BOT_ID,
    user_id: COZE_USER_ID,
    stream: true,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: userMessage,
        content_type: 'text',
      },
    ],
  };

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    writeSse(res, 'error', { message: `无法连接 Coze：${err.message}` });
    return res.end();
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    writeSse(res, 'error', {
      message: `Coze 返回错误 (${upstream.status})`,
      detail: errText.slice(0, 500),
    });
    return res.end();
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const json = await upstream.json();
    const answer =
      json?.data?.messages?.find?.((m) => m.type === 'answer')?.content ||
      json?.msg ||
      JSON.stringify(json);
    writeSse(res, 'meta', { conversationId: json?.data?.conversation_id || conversationId || null });
    writeSse(res, 'done', { content: String(answer) });
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullAnswer = '';
  let resolvedConversationId = conversationId || null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseCozeSseChunk(buffer, (event, data) => {
        if (data.conversation_id && !resolvedConversationId) {
          resolvedConversationId = data.conversation_id;
          writeSse(res, 'meta', { conversationId: resolvedConversationId });
        }

        if (event === 'conversation.chat.failed' || (data.code && data.code !== 0 && data.msg)) {
          writeSse(res, 'error', { message: data.msg || '对话失败', detail: data });
          return;
        }

        if (event === 'conversation.message.delta' && data.type === 'answer' && data.content) {
          fullAnswer += data.content;
          writeSse(res, 'delta', { content: data.content });
        }

        if (event === 'conversation.message.completed' && data.type === 'answer' && data.content) {
          fullAnswer = data.content;
        }

        if (event === 'conversation.chat.completed' && data.conversation_id) {
          resolvedConversationId = data.conversation_id;
        }
      });
    }

    if (!resolvedConversationId) {
      writeSse(res, 'meta', { conversationId: null });
    }
    writeSse(res, 'done', { content: fullAnswer || '（暂无回复内容）' });
  } catch (err) {
    writeSse(res, 'error', { message: err.message || '流式读取失败' });
  } finally {
    res.end();
  }
});

// 核心修复二：仅在本地非生产环境启动端口独占
if (process.env.NODE_ENV !== 'production') {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log('');
    console.log('  🍜 事事如嗦 · 嗦语 已启动');
    console.log(`  👉 在浏览器打开: http://localhost:${PORT}`);
    console.log('');
  });
}

// 核心修复三：必须将 app 导出，否则 Vercel 的 Cloud Function 无法抓取 Express 路由
module.exports = app;
