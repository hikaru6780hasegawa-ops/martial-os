const SALES_SHEET = '1Uj_UtIs7ofFSuOcCN5iRsWt8yqhlsGRs7BTy8oUaamA';
const CRM_SHEET   = '16NQy4NIsfU2Asbkxv6ckJ7Jp5rK-VDqIehUOlggX98c';

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

async function fetchSheet(token, sheetId, range) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const data = await res.json();
    return data.values || [];
  } finally {
    clearTimeout(timeout);
  }
}

function cleanAmount(v) {
  if (!v || v === '-') return 0;
  return parseInt(String(v).replace(/[,万円\s]/g, '')) || 0;
}

// --- Parsers ---

function parseSummary(rows) {
  const monthly = [], byStatus = [];
  let total = null;
  for (const row of rows) {
    if (!row[0]) continue;
    const label = row[0], count = row[1] || '', amount = row[2] || '', note = row[3] || '';
    if (label.includes('月決済見込')) {
      monthly.push({ label: label.replace(/^📅\s*/, ''), count, amount, note });
    } else if (label.includes('金消') || label.includes('最終') || label.includes('審査') || label.includes('契約') || label.includes('粗利')) {
      if (count) {
        const color = label.includes('🔵') ? 'blue' : label.includes('🟢') ? 'green' :
                     label.includes('🟠') ? 'orange' : label.includes('🟡') ? 'yellow' :
                     label.includes('🔴') ? 'red' : 'gray';
        const cleanLabel = label.replace(/[\u{1F534}\u{1F535}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{26AA}]\s*/gu, '').trim();
        byStatus.push({ label: cleanLabel, count, amount, note, color });
      }
    } else if (label.includes('案件合計')) {
      total = { count, amount, note };
    }
  }
  return { monthly, byStatus, total };
}

function parseKessai(rows) {
  if (rows.length < 2) return [];
  return rows.slice(1).filter(r => r[2] && !/^客/.test(r[2].trim())).map(r => ({
    date: r[0] || '', status: r[1] || '',
    customer: (r[2] || '').trim(),
    branch: r[3] || '', bank: r[4] || '',
    amount: r[5] || '', property: r[6] || '',
    source: r[7] || '', rep: r[8] || '',
    risk: (r[10] || '').includes('GREEN') ? 'green' :
          (r[10] || '').includes('ORANGE') ? 'orange' :
          (r[10] || '').includes('RED') ? 'red' :
          (r[10] || '').includes('BLUE') ? 'blue' : 'yellow',
  }));
}

function parseDashboard(rows) {
  const kpi = {}, pipeline = {}, alerts = {}, ranks = {}, reps = {};
  let lastUpdate = '';
  for (const row of rows) {
    if (!row[0]) continue;
    if (row[0] === '最終更新') lastUpdate = row[1] || '';
    if (row[0] === '総顧客数') { kpi.totalCustomers = parseInt(row[1]) || 0; kpi.sold = parseInt(row[4]) || 0; }
    if (row[0] === '未販売') { kpi.unsold = parseInt(row[1]) || 0; kpi.conversionRate = row[4] || ''; }
    if (row[0] === 'S優先') { kpi.sPriority = parseInt(row[1]) || 0; kpi.aPriority = parseInt(row[4]) || 0; }
    if (row[0] === 'B優先') { kpi.bPriority = parseInt(row[1]) || 0; kpi.cPriority = parseInt(row[4]) || 0; }
    if (row[0] && row[0].startsWith('S') && row[0].includes('_')) {
      pipeline[row[0]] = parseInt(row[1]) || 0;
    }
    if (row[0] && row[0].includes('未接触')) alerts.noContact7 = parseInt(row[1]) || 0;
    if (row[0] && row[0].includes('放置')) alerts.noContact14 = parseInt(row[1]) || 0;
    if (row[0] && row[0].includes('HOT')) alerts.hot = parseInt(row[1]) || 0;
    if (row[0] && row[0].includes('WARM')) alerts.warm = parseInt(row[1]) || 0;
    if (row[0] === 'Sランク') ranks.S = parseInt(row[1]) || 0;
    if (row[0] === 'Aランク') ranks.A = parseInt(row[1]) || 0;
    if (row[0] === 'Bランク') ranks.B = parseInt(row[1]) || 0;
    if (row[0] === 'Cランク') ranks.C = parseInt(row[1]) || 0;
  }
  // parse alerts from correct columns
  for (const row of rows) {
    if (row.length > 10) {
      const label = row[10] || '';
      const val = row[11] || '0';
      if (label.includes('7日超')) alerts.noContact7 = parseInt(val) || 0;
      if (label.includes('14日超')) alerts.noContact14 = parseInt(val) || 0;
      if (label.includes('HOT')) alerts.hot = parseInt(val) || 0;
      if (label.includes('WARM')) alerts.warm = parseInt(val) || 0;
    }
  }
  return { kpi, pipeline, alerts, ranks, lastUpdate };
}

function parseRepStats(rows) {
  const reps = [];
  for (const row of rows) {
    if (!row[0] || row[0] === '担当' || row[0] === '合計' || row[0].includes('担当者')) continue;
    if (!row[0].trim()) continue;
    reps.push({
      name: row[0],
      total: parseInt(row[1]) || 0,
      unsold: parseInt(row[2]) || 0,
      sold: parseInt(row[3]) || 0,
      rate: row[4] || '0%',
      hot: parseInt(row[5]) || 0,
      s3: parseInt(row[6]) || 0,
      s4: parseInt(row[7]) || 0,
      sPriority: parseInt(row[11]) || 0,
    });
  }
  const totals = rows.find(r => r[0] === '合計');
  return {
    reps,
    totals: totals ? {
      total: parseInt(totals[1]) || 0, unsold: parseInt(totals[2]) || 0,
      sold: parseInt(totals[3]) || 0, rate: totals[4] || '', hot: parseInt(totals[5]) || 0,
    } : null,
  };
}

function parsePeriod(rows) {
  const periods = [];
  let forecast = {};
  for (const row of rows) {
    if (row.length >= 7 && row[0] && row[0].startsWith('第')) {
      periods.push({
        name: row[0], range: row[1] || '', months: row[2] || '',
        deals: parseInt(row[3]) || 0,
        salesMan: parseInt(String(row[4]).replace(/,/g, '')) || 0,
        salesOku: row[5] || '',
        avgMonth: parseInt(String(row[6]).replace(/,/g, '')) || 0,
      });
    }
    if (row[0] === '通期着地予測') forecast.prediction = row[1] || '';
    if (row[0] === '前期比') forecast.yoy = row[1] || '';
    if (row[0] === '経過月数') forecast.elapsed = row[1] || '';
    if (row[0] === '残月数') forecast.remaining = row[1] || '';
  }
  return { periods, forecast };
}

function normName(v) {
  return String(v || '').replace(/\s+/g, '').replace(/様$/, '').trim();
}

function parseDeals(rows, kessai = []) {
  if (rows.length < 2) return [];
  const scheduleByCustomer = new Map();
  for (const item of kessai) {
    const key = normName(item.customer);
    if (key && !scheduleByCustomer.has(key)) scheduleByCustomer.set(key, item);
  }
  return rows.slice(1).filter(r => r[1]).map((r, index) => {
    const status = (r[2] || '-').trim();
    const completed = /^(決済|金消済)$/.test(status);
    const linked = scheduleByCustomer.get(normName(r[1]));
    let priority = 'info';
    if (!completed) {
      if (/事前審査/.test(status)) priority = 'watch';
      else if (/本審査|契約/.test(status)) priority = 'action';
      else if (/承認/.test(status)) priority = 'action';
    }
    return {
      id: `${r[0] || 'deal'}-${index}`,
      source: r[0] || '', customer: (r[1] || '').replace(/様$/, '') + '様',
      status, bank: r[3] || '',
      amount: cleanAmount(r[4]), amountRaw: r[4] || '',
      property: cleanAmount(r[5]), propertyRaw: r[5] || '',
      sales: cleanAmount(r[6]), salesRaw: r[6] || '',
      profit: cleanAmount(r[7]), profitRaw: r[7] || '',
      completed, priority,
      rep: linked ? linked.rep : '',
      settlementDate: linked ? linked.date : '',
      branch: linked ? linked.branch : '',
      propertyName: linked ? linked.property : '',
      risk: linked ? linked.risk : '',
    };
  });
}

function parseCustomers(rows) {
  if (rows.length < 2) return [];
  return rows.slice(1).filter(r => r[1]).map(r => ({
    id: r[0] || '', name: r[1] || '', rank: r[3] || '',
    rep: r[4] || '', accompany: r[5] || '', sales: r[2] || '',
    deposit: r[7] || '', property: r[9] || '', bank: r[10] || '',
  }));
}

function parseAnnual(rows) {
  const months = [];
  for (const row of rows) {
    if (row.length >= 5 && row[2] && row[2].includes('売上表')) {
      months.push({
        sheet: row[2],
        deals: parseInt(row[3]) || 0,
        sales: parseInt(String(row[4]).replace(/,/g, '')) || 0,
      });
    }
  }
  return { months: months.slice(0, 12) };
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'all';
    const q = url.searchParams.get('q') || '';
    const token = await getAccessToken();
    if (!token) return resp({ error: 'auth_failed' }, 500);

    const result = {};

    if (type === 'pipeline' || type === 'all') {
      const [summaryRows, kessaiRows, dashRows, repRows, periodRows, dealRows, annualRows] = await Promise.all([
        fetchSheet(token, SALES_SHEET, '📅月別決済見込サマリー!A1:D30'),
        fetchSheet(token, SALES_SHEET, '🔥決済見込ダッシュボード!A1:K100'),
        fetchSheet(token, CRM_SHEET, '📊 営業ダッシュボード!A1:L20'),
        fetchSheet(token, CRM_SHEET, '👤 担当者別集計!A1:L20'),
        fetchSheet(token, SALES_SHEET, '決算期サマリー!A1:H20'),
        fetchSheet(token, SALES_SHEET, '全データ統合_利益付き!A1:H200'),
        fetchSheet(token, SALES_SHEET, '年間サマリー!A1:E25'),
      ]);
      result.summary = parseSummary(summaryRows);
      result.kessai = parseKessai(kessaiRows);
      result.dashboard = parseDashboard(dashRows);
      result.repStats = parseRepStats(repRows);
      result.period = parsePeriod(periodRows);
      result.deals = parseDeals(dealRows, result.kessai);
      result.annual = parseAnnual(annualRows);
    }

    if (type === 'customers') {
      const crmRows = await fetchSheet(token, CRM_SHEET, '顧客ランク_担当同行!A1:O760');
      let customers = parseCustomers(crmRows);
      if (q) {
        const ql = q.toLowerCase();
        customers = customers.filter(c =>
          c.name.toLowerCase().includes(ql) ||
          c.rep.toLowerCase().includes(ql) ||
          c.id.toLowerCase().includes(ql)
        );
      }
      result.customers = customers.slice(0, 50);
    }

    result.updated = new Date().toISOString();
    return resp(result);
  } catch (e) {
    return resp({ error: e.message }, 500);
  }
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/api/data' };
