async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token;
}

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) return resp({ error: 'not_configured', events: [] });

  try {
    const token = await getAccessToken();
    if (!token) return resp({ error: 'auth_failed' }, 500);

    const now = new Date();
    const tz = 'Asia/Tokyo';
    const todayStart = new Date(now.toLocaleDateString('en-CA', { timeZone: tz }) + 'T00:00:00+09:00');
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const params = new URLSearchParams({
        timeMin: todayStart.toISOString(),
        timeMax: todayEnd.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
        timeZone: tz,
      });
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!res.ok) {
        const err = await res.text();
        return resp({ error: `calendar_api_${res.status}`, detail: err.slice(0, 200) }, res.status);
      }
      const data = await res.json();
      const events = (data.items || []).map(ev => {
        const start = ev.start?.dateTime || ev.start?.date || '';
        const end = ev.end?.dateTime || ev.end?.date || '';
        const allDay = !ev.start?.dateTime;
        let meetLink = '';
        if (ev.hangoutLink) meetLink = ev.hangoutLink;
        else if (ev.conferenceData?.entryPoints) {
          const ep = ev.conferenceData.entryPoints.find(e => e.entryPointType === 'video');
          if (ep) meetLink = ep.uri;
        }
        return {
          id: ev.id,
          title: ev.summary || '(タイトルなし)',
          start, end, allDay,
          location: ev.location || '',
          meetLink,
          status: ev.status,
          description: (ev.description || '').slice(0, 200),
        };
      });
      return resp({ events, updated: new Date().toISOString() });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    if (e.name === 'AbortError') return resp({ error: 'timeout' }, 504);
    return resp({ error: e.message }, 500);
  }
};

export const config = { path: '/api/calendar' };
