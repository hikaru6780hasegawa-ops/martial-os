function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeSlackText(text) {
  if (!text) return '';
  return text
    .replace(/<@(\w+)>/g, '@user')
    .replace(/<#(\w+)\|([^>]+)>/g, '#$2')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .slice(0, 500);
}

export default async (req) => {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelIds = process.env.SLACK_CHANNEL_IDS;
  const userId = process.env.SLACK_USER_ID || '';

  if (!token || !channelIds) return resp({ error: 'not_configured', messages: [] });

  try {
    const channels = channelIds.split(',').map(s => s.trim()).filter(Boolean);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const results = await Promise.allSettled(channels.map(async ch => {
        const params = new URLSearchParams({ channel: ch, limit: '5' });
        const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json();
        if (!data.ok) return [];

        const infoRes = await fetch(`https://slack.com/api/conversations.info?channel=${ch}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const infoData = await infoRes.json();
        const channelName = infoData.ok ? (infoData.channel?.name || ch) : ch;

        return (data.messages || []).map(m => ({
          channelId: ch,
          channelName,
          user: m.user || '',
          username: m.username || '',
          text: escapeSlackText(m.text),
          ts: m.ts,
          threadTs: m.thread_ts || '',
          replyCount: m.reply_count || 0,
          hasAttachment: !!(m.files?.length || m.attachments?.length),
          isMention: !!userId && (m.text || '').includes(`<@${userId}>`),
          permalink: '',
        }));
      }));

      let messages = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts))
        .slice(0, 15);

      const userIds = [...new Set(messages.map(m => m.user).filter(Boolean))];
      if (userIds.length) {
        const profileMap = {};
        await Promise.allSettled(userIds.slice(0, 20).map(async uid => {
          const res = await fetch(`https://slack.com/api/users.info?user=${uid}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const data = await res.json();
          if (data.ok && data.user) {
            profileMap[uid] = {
              name: data.user.real_name || data.user.name || uid,
              icon: data.user.profile?.image_48 || '',
            };
          }
        }));
        messages = messages.map(m => ({
          ...m,
          username: profileMap[m.user]?.name || m.username || m.user,
          userIcon: profileMap[m.user]?.icon || '',
        }));
      }

      return resp({ messages, updated: new Date().toISOString() });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    if (e.name === 'AbortError') return resp({ error: 'timeout' }, 504);
    return resp({ error: e.message }, 500);
  }
};

export const config = { path: '/api/slack' };
