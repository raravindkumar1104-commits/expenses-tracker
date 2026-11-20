// GET /api/gold — gold spot (INR/gram), daily history (USD/oz) and India gold news.
// Public data only, no login. Vercel's edge caches the answer for an hour,
// so the upstream services are called at most about once an hour for everyone.
const UA = { 'User-Agent': 'SavingsExpenses/3.1 (gold tab)', Accept: 'application/json, application/rss+xml, text/xml' };
const OZ = 31.1034768;

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
function decode(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}
async function news() {
  const q = encodeURIComponent('gold rate India when:7d');
  const r = await fetch('https://news.google.com/rss/search?q=' + q + '&hl=en-IN&gl=IN&ceid=IN:en', { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('news ' + r.status);
  const xml = await r.text(), out = [], seen = new Set();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = t => { const k = m[1].match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return k ? decode(k[1]) : ''; };
    const src = get('source');
    let title = get('title');
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    const link = get('link');
    if (!title || !/^https?:\/\//.test(link) || seen.has(title)) continue;
    seen.add(title);
    out.push({ t: title.slice(0, 220), u: link, s: src.slice(0, 80), d: get('pubDate') });
    if (out.length >= 12) break;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  const [spot, hist, nw] = await Promise.allSettled([
    getJSON('https://xaus.com/api/v1/spot?currency=INR&unit=gram&compact=1'),
    getJSON('https://xaus.com/api/v1/history'),
    news()
  ]);
  const out = { fetched: new Date().toISOString(), spot: null, history: [], news: null, source: 'xaus.com (indicative mid-market), Google News' };
  if (spot.status === 'fulfilled') {
    const s = spot.value, inr = Number(s.xau && s.xau.price), usd = Number(s.spot_usd_oz);
    if (inr > 0 && usd > 0) out.spot = { inr_g: inr, usd_oz: usd, fx: inr * OZ / usd, as_of: s.price_as_of || s.updated_at || out.fetched };
  }
  if (hist.status === 'fulfilled' && Array.isArray(hist.value.points)) {
    out.history = hist.value.points.map(p => ({ d: String(p.d).slice(0, 10), c: Number(p.c) })).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && p.c > 0);
  }
  if (nw.status === 'fulfilled') out.news = nw.value;
  if (!out.spot && !out.history.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Gold prices are not available right now.', news: out.news });
  }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(out);
};
