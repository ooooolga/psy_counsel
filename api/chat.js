/**
 * 事事如嗦 — Vercel 专用流式后端云函数
 */
const COZE_API_BASE = (process.env.COZE_API_BASE || 'https://api.coze.com').trim().replace(/\/$/, '');
const COZE_API_TOKEN = (process.env.COZE_API_TOKEN || '').trim();
const COZE_BOT_ID = (process.env.COZE_BOT_ID || '').trim();

  try {
    const { message, conversationId } = await req.json();
    const userMessage = String(message || '').trim();

    if (!userMessage) {
      return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400 });
    }

    // 构建请求 Coze 的参数
    const url = new URL(`${COZE_API_BASE}/v3/chat`);
    if (conversationId) url.searchParams.set('conversation_id', conversationId);

    const body = {
      bot_id: COZE_BOT_ID,
      user_id: "user_vercel_edge",
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

    // 直接透传请求给 Coze 国际版
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Coze 远程错误: ${response.status}`, detail: errText }), { status: response.status });
    }

    // 关键：利用 Edge Runtime 的 Response 机制，直接把 Coze 的流原封不动吐给前端
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `服务器内部错误: ${err.message}` }), { status: 500 });
  }
}
