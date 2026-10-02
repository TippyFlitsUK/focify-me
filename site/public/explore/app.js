const OBS = 'https://observer.yablu.net';
const NETS = {
  mainnet: { obs: 'mainnet', label: 'Mainnet', usdfc: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045' },
  calibration: { obs: 'calibnet', label: 'Calibration testnet', usdfc: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0' },
};
const EPOCH_SECONDS = 30;
const EPOCHS_PER_DAY = 2880;
const ALERT_TH = { warning: 30, critical: 7, emergency: 3 };
const MAXUINT_LEN = 70;
const VERIFY_MAX_BYTES = 33554432;
const TIMEOUT_MS = 25000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const num = (n) => Number(n).toLocaleString('en-GB');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
function bytes(n) {
  n = Number(n);
  if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
}
const day = (ts) => new Date(Number(ts) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function span(seconds) {
  const s = Math.abs(seconds);
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)} days`;
  if (s >= 2 * 3600) return `${Math.floor(s / 3600)} hours`;
  return `${Math.max(1, Math.floor(s / 60))} minutes`;
}
const usd = (wei) => {
  const v = Number(BigInt(wei)) / 1e18;
  return v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
};

async function getJson(url, init) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`the index answered HTTP ${r.status}`);
    const j = await r.json();
    if (j && j.error) throw new Error(j.error);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('timeout'); err.timeout = true; throw err; }
    throw e;
  } finally { clearTimeout(t); }
}
const sql = (net, q) => getJson(`${OBS}/sql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: NETS[net].obs, sql: q }) }).then((j) => j.rows || []);

const HEAD_SQL = 'SELECT block_number AS head, timestamp AS head_ts FROM (SELECT block_number, timestamp FROM pdp_possession_proven ORDER BY block_number DESC LIMIT 1) a UNION ALL SELECT block_number, timestamp FROM (SELECT block_number, timestamp FROM pdp_next_proving_period ORDER BY block_number DESC LIMIT 1) b ORDER BY head DESC LIMIT 1';
const setsSql = (payer) => `WITH s AS (SELECT data_set_id, provider_id, timestamp AS created, metadata, pdp_rail_id FROM fwss_data_set_created WHERE lower(payer) = '${payer}'),
rm AS (SELECT r.set_id, jsonb_array_elements_text(r.piece_ids::jsonb)::bigint AS piece_id FROM pdp_pieces_removed r JOIN s ON s.data_set_id = r.set_id),
a AS (SELECT x.data_set_id, COUNT(*) AS added, MAX(x.timestamp) AS last_add, COUNT(*) FILTER (WHERE rm.piece_id IS NULL) AS pieces, COALESCE(SUM(x.raw_size) FILTER (WHERE rm.piece_id IS NULL), 0) AS bytes FROM fwss_piece_added x JOIN s ON s.data_set_id = x.data_set_id LEFT JOIN rm ON rm.set_id = x.data_set_id AND rm.piece_id = x.piece_id GROUP BY x.data_set_id),
t AS (SELECT e.data_set_id, MAX(e.end_epoch) AS end_epoch FROM fwss_pdp_payment_terminated e JOIN s ON s.data_set_id = e.data_set_id GROUP BY e.data_set_id),
d AS (SELECT x.set_id, MIN(x.timestamp) AS deleted_at FROM pdp_data_set_deleted x JOIN s ON s.data_set_id = x.set_id GROUP BY x.set_id)
SELECT s.data_set_id, s.provider_id, s.created, s.metadata, COALESCE(a.pieces, 0) AS pieces, COALESCE(a.bytes, 0) AS bytes, a.last_add, t.end_epoch, d.deleted_at
FROM s LEFT JOIN a ON a.data_set_id = s.data_set_id LEFT JOIN t ON t.data_set_id = s.data_set_id LEFT JOIN d ON d.set_id = s.data_set_id ORDER BY s.data_set_id`;
const sharedFileSql = (ids) => `WITH rm AS (SELECT r.set_id, jsonb_array_elements_text(r.piece_ids::jsonb)::bigint AS piece_id FROM pdp_pieces_removed r WHERE r.set_id IN (${ids}))
SELECT MIN(x.raw_size) AS raw_size, MIN(x.metadata) AS metadata, COUNT(DISTINCT x.data_set_id) AS n, string_agg(DISTINCT x.data_set_id::text, ',') AS sets
FROM fwss_piece_added x LEFT JOIN rm ON rm.set_id = x.data_set_id AND rm.piece_id = x.piece_id
WHERE x.data_set_id IN (${ids}) AND rm.piece_id IS NULL AND x.raw_size <= ${VERIFY_MAX_BYTES} AND x.metadata LIKE '%ipfsRootCID%'
GROUP BY x.piece_cid ORDER BY 3 DESC, 1 ASC LIMIT 1`;

function varint(u8, off) { let r = 0n, s = 0n, i = off; for (;;) { const b = u8[i++]; r |= BigInt(b & 0x7f) << s; s += 7n; if (!(b & 0x80)) return [Number(r), i]; } }
async function decodeCar(u8, wantDigest) {
  let [hlen, p] = varint(u8, 0); p += hlen;
  const leaves = []; let blocks = 0, verified = 0, rootSeen = false, total = 0;
  while (p < u8.length) {
    const [blen, q] = varint(u8, p); p = q;
    const blockEnd = p + blen;
    let codec, digest;
    if (u8[p] === 0x12) { codec = 0x70; digest = u8.subarray(p + 2, p + 34); p += 34; }
    else { let v, c, mh, ml; [v, p] = varint(u8, p); [c, p] = varint(u8, p); [mh, p] = varint(u8, p); [ml, p] = varint(u8, p); codec = c; digest = u8.subarray(p, p + ml); p += ml; }
    const data = u8.subarray(p, blockEnd); p = blockEnd; blocks++;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    if (h.length === digest.length && h.every((x, i) => x === digest[i])) verified++; else throw new Error(`block ${blocks} failed its hash check`);
    if (wantDigest && hex(h) === wantDigest) rootSeen = true;
    if (codec === 0x55) { leaves.push(data); total += data.length; }
  }
  const out = new Uint8Array(total); let o = 0; for (const l of leaves) { out.set(l, o); o += l.length; }
  return { bytes: out, blocks, verified, rootSeen };
}
function cidDigestHex(cid) {
  if (!cid.startsWith('b')) return null;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, value = 0; const out = [];
  for (const ch of cid.slice(1)) { const v = alphabet.indexOf(ch); if (v < 0) return null; value = (value << 5) | v; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  const u = new Uint8Array(out); let p = 0, x; [x, p] = varint(u, p); [x, p] = varint(u, p); [x, p] = varint(u, p); let ml; [ml, p] = varint(u, p);
  return hex(u.subarray(p, p + ml));
}
async function ipniHosts(cid) {
  const hosts = new Set();
  try {
    const r = await fetch(`https://cid.contact/cid/${cid}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return hosts;
    const j = await r.json();
    for (const pr of (j.MultihashResults?.[0]?.ProviderResults || [])) for (const a of (pr.Provider?.Addrs || [])) { const m = /^\/dns4?6?\/([^/]+)\/tcp\/(\d+)\/(https?)$/.exec(a); if (m) hosts.add(m[1]); }
  } catch (e) {}
  return hosts;
}

function tierFor(runway) {
  if (runway < ALERT_TH.emergency * EPOCHS_PER_DAY) return 'emergency';
  if (runway < ALERT_TH.critical * EPOCHS_PER_DAY) return 'critical';
  if (runway < ALERT_TH.warning * EPOCHS_PER_DAY) return 'warning';
  return 'healthy';
}
function funding(acct, head) {
  if (!acct || acct.funds == null) return { tier: 'unknown' };
  const rate = BigInt(acct.currentLockupRate || acct.lockupRate || '0');
  if (rate === 0n) return { tier: 'idle' };
  if (String(acct.fundedUntilEpoch).length >= MAXUINT_LEN) return { tier: 'healthy', forever: true };
  const until = Number(acct.fundedUntilEpoch);
  const runway = until - head;
  if (runway <= 0) return { tier: 'emergency', exhausted: true, until, overdue: -runway };
  return { tier: tierFor(runway), days: Math.floor(runway / EPOCHS_PER_DAY), until, runway };
}

let state = null;
const epochTs = (epoch) => state.headTs + (Number(epoch) - state.head) * EPOCH_SECONDS;

function metaKey(m) {
  if (!m) return '';
  try { const o = JSON.parse(m); return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); } catch (e) { return m; }
}
function metaChips(m) {
  if (!m) return '<span class="chip none">no metadata</span>';
  try {
    const o = JSON.parse(m); const keys = Object.keys(o).sort();
    if (!keys.length) return '<span class="chip none">no metadata</span>';
    return keys.map((k) => `<span class="chip">${esc(k)}${o[k] === '' ? '' : ': ' + esc(o[k])}</span>`).join('');
  } catch (e) { return `<span class="chip">${esc(m)}</span>`; }
}
function status(s) {
  if (s.deleted_at) return { key: 'ended', html: `<span class="st ended">Terminated</span><small>removed by the provider on ${day(s.deleted_at)}</small>` };
  if (s.end_epoch == null) return { key: 'live', html: '<span class="st live">Live</span>' };
  const end = epochTs(s.end_epoch); const left = end - Date.now() / 1000;
  if (left > 0) return { key: 'ending', html: `<span class="st ending">Terminating</span><small>ends ${day(end)}, in ${span(left)}</small>` };
  return { key: 'ended', html: `<span class="st ended">Terminated</span><small>ended ${day(end)}</small>` };
}
function providerName(id) {
  const p = state.providers[id];
  return `#${esc(id)}${p ? ' ' + esc(p.name) : ''}`;
}

function analyse(sets) {
  const groups = new Map();
  for (const s of sets) {
    s.status = status(s);
    const k = metaKey(s.metadata);
    if (!groups.has(k)) groups.set(k, { key: k, metadata: s.metadata, sets: [] });
    groups.get(k).sets.push(s);
  }
  const flags = [];
  for (const g of groups.values()) {
    g.live = g.sets.filter((s) => s.status.key === 'live');
    const byProvider = new Map();
    for (const s of g.live) { if (!byProvider.has(s.provider_id)) byProvider.set(s.provider_id, []); byProvider.get(s.provider_id).push(s); }
    g.duplicates = [...byProvider.entries()].filter(([, v]) => v.length > 1);
    g.providers = byProvider.size;
    g.diverged = false;
    if (byProvider.size > 1) {
      const sizes = new Set(g.live.map((s) => `${s.bytes}/${s.pieces}`));
      g.diverged = sizes.size > 1;
    }
    for (const [pid, v] of g.duplicates) {
      for (const s of v) s.dup = true;
      flags.push(`<strong>Possible duplicates.</strong> ${plural(v.length, 'live data set', 'live data sets')} with identical metadata on provider ${providerName(pid)}: ${v.map((s) => '#' + esc(s.data_set_id)).join(', ')}. Each one is paid for separately.`);
    }
    if (g.diverged) {
      const big = g.live.reduce((a, b) => (Number(b.bytes) > Number(a.bytes) ? b : a));
      for (const s of g.live) if (s.bytes !== big.bytes || s.pieces !== big.pieces) s.behind = true;
      flags.push(`<strong>Copies differ.</strong> Data sets ${g.live.map((s) => '#' + esc(s.data_set_id)).join(', ')} share the same metadata across ${g.providers} providers but do not hold the same amount: ${g.live.map((s) => `#${esc(s.data_set_id)} has ${bytes(s.bytes)} in ${plural(Number(s.pieces), 'piece', 'pieces')}`).join('; ')}.`);
    }
  }
  return { groups: [...groups.values()], flags };
}

function renderFunding() {
  const a = state.account; const f = funding(a, state.head);
  const asOf = `as of block ${state.head}`;
  let headline, cls = f.tier, detail = '';
  if (f.tier === 'unknown') { headline = 'Funding could not be read'; detail = 'The account lookup did not answer. The data sets below are unaffected.'; }
  else if (f.tier === 'idle') { headline = 'Nothing is being charged'; detail = `No storage payments are running from this account, ${asOf}.`; }
  else if (f.forever) { headline = 'Funded with no end date'; detail = asOf; }
  else if (f.exhausted) { headline = `Funding ran out on ${day(epochTs(f.until))}`; detail = `${span(f.overdue * EPOCH_SECONDS)} ago, ${asOf}. Providers can end storage for an unfunded account, so it needs a deposit.`; }
  else { headline = `Funded until ${day(epochTs(f.until))}`; detail = `${plural(f.days, 'day', 'days')} at the current rate, ${asOf}.`; }
  let rows = '';
  if (a && a.funds != null) {
    const rate = BigInt(a.currentLockupRate || a.lockupRate || '0');
    rows = `<dl class="kv">
      <div><dt>In Filecoin Pay</dt><dd>${usd(a.funds)} USDFC</dd></div>
      <div><dt>Free to spend</dt><dd>${usd(a.availableFunds || '0')} USDFC</dd></div>
      <div><dt>Held as lockup</dt><dd>${usd(a.lockupCurrent || '0')} USDFC</dd></div>
      <div><dt>Charged per 30 days</dt><dd>${usd(rate * BigInt(EPOCHS_PER_DAY * 30))} USDFC</dd></div>
    </dl>`;
  }
  $('funding').innerHTML = `<h2>Funding runway</h2><div class="panel fund ${cls}"><p class="big">${headline}</p><p class="fine">${detail}</p>${rows}</div>`;
}

function renderGroup(g, i) {
  const rows = g.sets.map((s) => `<tr class="${s.status.key}">
    <td data-l="Data set"><span class="mono">#${esc(s.data_set_id)}</span>${s.dup ? '<span class="tag warn">duplicate?</span>' : ''}${s.behind ? '<span class="tag warn">differs</span>' : ''}</td>
    <td data-l="Provider">${providerName(s.provider_id)}</td>
    <td data-l="Size" class="r">${bytes(s.bytes)}</td>
    <td data-l="Pieces" class="r">${num(s.pieces)}</td>
    <td data-l="Status">${s.status.html}</td>
    <td data-l="Created">${day(s.created)}</td>
    <td data-l="Last add">${s.last_add ? day(s.last_add) : 'never'}</td>
  </tr>`).join('');
  const withData = g.live.filter((s) => Number(s.pieces) > 0);
  const tiles = withData.map((s) => {
    const p = state.providers[s.provider_id];
    return `<div class="tile" data-set="${esc(s.data_set_id)}"><div class="tname">${providerName(s.provider_id)}</div><div class="tsub">data set #${esc(s.data_set_id)}</div><button class="tbtn" data-group="${i}" data-set="${esc(s.data_set_id)}"${p && p.url ? '' : ' disabled'}>Fetch and verify</button><div class="tstat" aria-live="polite">${p && p.url ? '' : 'no public address for this provider'}</div></div>`;
  }).join('');
  const copies = g.providers > 1 ? `${g.providers} providers hold data sets with this metadata` : g.providers === 1 ? 'One provider holds this data' : 'No live data sets';
  return `<div class="group">
    <div class="ghead"><div class="chips">${metaChips(g.metadata)}</div><span class="gnote ${g.providers > 1 ? 'ok' : g.providers === 1 ? 'single' : ''}">${copies}</span></div>
    <div class="tablewrap"><table class="sets"><thead><tr><th>Data set</th><th>Provider</th><th class="r">Size</th><th class="r">Pieces</th><th>Status</th><th>Created</th><th>Last add</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${withData.length ? `<div class="verify" id="verify-${i}"><div class="vfile"><span class="vlabel">Test file</span><span class="vcid">Press a button and one small stored file is fetched straight from that provider and checked block by block in your browser.</span></div><div class="tiles">${tiles}</div><p class="verdict" hidden></p></div>` : ''}
  </div>`;
}

function render() {
  const { groups, flags } = analyse(state.sets);
  state.groups = groups;
  const live = state.sets.filter((s) => s.status.key === 'live');
  const sum = (k) => live.reduce((a, s) => a + Number(s[k]), 0);
  const ending = state.sets.filter((s) => s.status.key === 'ending').length;
  $('summary').innerHTML = `<div class="net-stats">
    <div class="net-stat"><span class="net-value">${num(live.length)}</span><span class="net-label">live data sets</span></div>
    <div class="net-stat"><span class="net-value">${bytes(sum('bytes'))}</span><span class="net-label">stored</span></div>
    <div class="net-stat"><span class="net-value">${num(sum('pieces'))}</span><span class="net-label">pieces</span></div>
    <div class="net-stat"><span class="net-value">${num(new Set(live.map((s) => s.provider_id)).size)}</span><span class="net-label">providers</span></div>
  </div><p class="net-note">${esc(state.payer)} on ${NETS[state.net].label}, as of block ${state.head}.${ending ? ` ${plural(ending, 'data set is', 'data sets are')} terminating.` : ''} ${num(state.sets.length - live.length - ending)} terminated. Source: observer.yablu.net</p>`;
  $('summary').hidden = false;
  renderFunding();
  $('flags').innerHTML = `<h2>Things to look at</h2>` + (flags.length ? `<ul class="flags">${flags.map((f) => `<li>${f}</li>`).join('')}</ul>` : '<p class="subtitle">No duplicate data sets and no copies that differ.</p>');
  $('groups').innerHTML = `<h2>Data sets</h2><p class="subtitle">Grouped by metadata. Data sets with the same metadata on different providers are treated as copies of each other.</p>` + groups.map(renderGroup).join('');
  for (const b of $('groups').querySelectorAll('.tbtn')) b.onclick = () => verify(Number(b.dataset.group), b.dataset.set, b);
  $('results').hidden = false;
}

function pickFile(g, box) {
  if (!g.filePromise) g.filePromise = (async () => {
    const ids = g.live.filter((s) => Number(s.pieces) > 0).map((s) => Number(s.data_set_id)).join(',');
    const rows = await sql(state.net, sharedFileSql(ids));
    if (!rows.length) return null;
    const meta = JSON.parse(rows[0].metadata);
    const file = { cid: meta.ipfsRootCID, name: meta.name || '', size: rows[0].raw_size, sets: rows[0].sets.split(','), loads: {} };
    box.querySelector('.vcid').innerHTML = `<span class="mono">${esc(file.cid)}</span>${file.name ? ' ' + esc(file.name) : ''} (${bytes(file.size)})`;
    ipniHosts(file.cid).then((hosts) => {
      for (const t of box.querySelectorAll('.tile')) {
        const s = g.sets.find((x) => x.data_set_id === t.dataset.set); const p = state.providers[s.provider_id];
        if (p && p.url && hosts.has(new URL(p.url).hostname)) t.querySelector('.tsub').insertAdjacentHTML('beforeend', ' · listed in the public index');
      }
    });
    return file;
  })().catch((e) => { g.filePromise = null; throw e; });
  return g.filePromise;
}
async function verify(gi, setId, btn) {
  const g = state.groups[gi]; const box = $(`verify-${gi}`);
  const tile = box.querySelector(`.tile[data-set="${setId}"]`); const stat = tile.querySelector('.tstat');
  const s = g.sets.find((x) => x.data_set_id === setId); const p = state.providers[s.provider_id];
  btn.disabled = true; tile.className = 'tile busy'; stat.textContent = 'choosing a file…';
  try {
    const file = await pickFile(g, box);
    if (!file) { tile.className = 'tile'; stat.textContent = `no stored file under ${bytes(VERIFY_MAX_BYTES)} with an IPFS address to test with`; return; }
    if (!file.sets.includes(setId)) { tile.className = 'tile miss'; stat.textContent = 'this data set does not hold the test file'; return; }
    stat.textContent = 'fetching…'; const t0 = performance.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let car;
    try {
      const r = await fetch(`${p.url}/ipfs/${file.cid}`, { headers: { accept: 'application/vnd.ipld.car' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`the provider answered HTTP ${r.status}`);
      car = new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(timer); }
    stat.textContent = 'verifying…';
    const out = await decodeCar(car, cidDigestHex(file.cid));
    const sha = hex(await crypto.subtle.digest('SHA-256', out.bytes));
    file.loads[setId] = sha;
    tile.className = 'tile done';
    stat.innerHTML = `✓ ${out.verified}/${out.blocks} blocks verified in ${Math.round(performance.now() - t0)} ms<br><span class="mono">sha256 ${sha.slice(0, 16)}…</span>`;
    const shas = Object.values(file.loads); const v = box.querySelector('.verdict'); v.hidden = false;
    if (new Set(shas).size > 1) { v.className = 'verdict bad'; v.textContent = 'The copies returned different bytes.'; }
    else if (shas.length > 1) { v.className = 'verdict ok'; v.textContent = `${shas.length} providers returned the same bytes, each checked against the file's own address. Reading this file does not depend on any one of them.`; }
    else { v.className = 'verdict'; v.textContent = withOthers(g, file, setId); }
  } catch (e) {
    tile.className = 'tile fail';
    stat.textContent = e.name === 'AbortError' || e.timeout ? '✗ the provider took too long to answer' : `✗ ${e.message}`;
  } finally { btn.disabled = false; }
}
function withOthers(g, file, setId) {
  const others = file.sets.filter((x) => x !== setId).length;
  return others ? `Verified from one provider. ${plural(others, 'other data set holds', 'other data sets hold')} this file: fetch from another to compare.` : 'Verified. Only this provider holds the file, so reading it depends on this provider.';
}

function fail(html) { $('message').innerHTML = html; $('message').hidden = false; $('results').hidden = true; $('summary').hidden = true; }
async function load(net, payer) {
  $('message').hidden = true; $('results').hidden = true; $('summary').hidden = true;
  $('go').disabled = true; $('go').textContent = 'Looking…';
  try {
    const [sets, head, account, providers] = await Promise.allSettled([
      sql(net, setsSql(payer)), sql(net, HEAD_SQL),
      getJson(`${OBS}/account/${NETS[net].obs}/${NETS[net].usdfc}/${payer}`),
      getJson(`${OBS}/providers/${NETS[net].obs}`),
    ]);
    if (sets.status === 'rejected') throw sets.reason;
    if (head.status === 'rejected' || !head.value.length) throw head.reason || new Error('the index returned no block');
    if (!sets.value.length) {
      const other = net === 'mainnet' ? 'calibration' : 'mainnet';
      return fail(`<p><strong>No data sets found.</strong> Nothing on ${NETS[net].label} has been paid for by ${esc(payer)} through Filecoin Warm Storage Service. Check the address, or <a href="?network=${other}&payer=${payer}">look on ${NETS[other].label}</a>.</p>`);
    }
    const provMap = {};
    if (providers.status === 'fulfilled') for (const p of (providers.value.providers || [])) provMap[p.providerId] = { name: p.name, url: (p.capabilities && p.capabilities.serviceURL || '').replace(/\/$/, '') };
    state = { net, payer, sets: sets.value, head: Number(head.value[0].head), headTs: Number(head.value[0].head_ts), account: account.status === 'fulfilled' ? account.value : null, providers: provMap };
    render();
  } catch (e) {
    fail(e.timeout
      ? `<p><strong>The index took too long to answer.</strong> Nothing is wrong with the data; the lookup was stopped after ${TIMEOUT_MS / 1000} seconds. <button class="focify-btn" id="retry">Try again</button></p>`
      : `<p><strong>The lookup failed.</strong> ${esc(e.message)}. <button class="focify-btn" id="retry">Try again</button></p>`);
    const r = $('retry'); if (r) r.onclick = () => load(net, payer);
  } finally { $('go').disabled = false; $('go').textContent = 'Look up'; }
}

function submit(push) {
  const payer = $('payer').value.trim().toLowerCase(); const net = $('network').value;
  if (!/^0x[0-9a-f]{40}$/.test(payer)) return fail('<p><strong>That is not a wallet address.</strong> Enter the 0x address that pays for the storage: 0x followed by 40 letters and digits.</p>');
  if (push) history.pushState(null, '', `?network=${net}&payer=${payer}`);
  load(net, payer);
}
function fromUrl() {
  const q = new URLSearchParams(location.search);
  const net = q.get('network'); const payer = q.get('payer');
  if (net && NETS[net]) $('network').value = net;
  if (payer) { $('payer').value = payer; submit(false); }
}
$('lookup').addEventListener('submit', (e) => { e.preventDefault(); submit(true); });
window.addEventListener('popstate', fromUrl);
fromUrl();
