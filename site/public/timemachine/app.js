const OBS = 'https://observer.yablu.net';
const NET = { obs: 'calibnet', label: 'Calibration testnet' };
const ACCOUNT = '0x12e83C954051B7c91F70d001F80dc9Ff91737b83';
const KEY = 'timemachine';
const PROOF_STALE_SECONDS = 6 * 3600;
const TIMEOUT_MS = 25000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => Number(n).toLocaleString('en-GB');
const when = (ts) => new Date(Number(ts) * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
function bytes(n) {
  n = Number(n); if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
}
function ago(seconds) {
  if (seconds < 120) return 'just now';
  if (seconds < 7200) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
async function getJson(url, init) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json(); if (j && j.error) throw new Error(j.error); return j;
  } finally { clearTimeout(t); }
}
const sql = (q) => getJson(`${OBS}/sql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: NET.obs, sql: q }) }).then((j) => j.rows || []);

const HEAD_SQL = 'SELECT block_number AS head FROM (SELECT block_number FROM pdp_possession_proven ORDER BY block_number DESC LIMIT 1) a UNION ALL SELECT block_number FROM (SELECT block_number FROM pdp_next_proving_period ORDER BY block_number DESC LIMIT 1) b ORDER BY head DESC LIMIT 1';
const SETS_SQL = `SELECT d.data_set_id, d.provider_id, d.metadata::jsonb ->> '${KEY}' AS site, (SELECT MAX(p.timestamp) FROM pdp_possession_proven p WHERE p.set_id = d.data_set_id) AS last_proof FROM fwss_data_set_created d WHERE lower(d.payer) = '${ACCOUNT.toLowerCase()}' AND d.metadata::jsonb ->> '${KEY}' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fwss_pdp_payment_terminated t WHERE t.data_set_id = d.data_set_id) ORDER BY d.data_set_id`;
const piecesSql = (ids) => `WITH rm AS (SELECT r.set_id, jsonb_array_elements_text(r.piece_ids::jsonb)::bigint AS piece_id FROM pdp_pieces_removed r WHERE r.set_id IN (${ids})) SELECT x.data_set_id, x.piece_id, x.raw_size, x.timestamp, x.block_number, x.tx_hash, x.metadata FROM fwss_piece_added x LEFT JOIN rm ON rm.set_id = x.data_set_id AND rm.piece_id = x.piece_id WHERE x.data_set_id IN (${ids}) AND rm.piece_id IS NULL ORDER BY x.timestamp`;

const state = { sites: [], site: null, head: null, providers: {} };

function proof(set) {
  const now = Date.now() / 1000;
  if (!set.last_proof) return '<span class="st ending">First proof pending</span>';
  const age = now - Number(set.last_proof);
  return age < PROOF_STALE_SECONDS ? `<span class="st live">Proof current</span><small>last proof ${ago(age)}</small>` : `<span class="st ending">Proof overdue</span><small>last proof ${ago(age)}</small>`;
}
function show(i) {
  const s = state.site; const v = s.versions[i]; if (!v) return;
  const provider = state.providers[s.provider_id];
  $('pos').textContent = `Version ${i + 1} of ${s.versions.length}`;
  $('version').innerHTML = `<p class="big">${when(v.timestamp)}</p>
    <dl class="kv">
      <div><dt>Size</dt><dd>${bytes(v.raw_size)}</dd></div>
      <div><dt>Stored in block</dt><dd>${num(v.block_number)}</dd></div>
      <div><dt>Storage proof</dt><dd class="proofcell">${proof(s)}</dd></div>
      <div><dt>Held by</dt><dd>#${esc(s.provider_id)}${provider ? ' ' + esc(provider) : ''}</dd></div>
    </dl>
    <p class="fine">Content address <span class="mono">${esc(v.cid)}</span></p>
    <a class="visit-btn" href="https://${esc(v.cid)}.ipfs.inbrowser.link/" target="_blank">Open this version</a>
    <div class="action-btns"><a href="https://${esc(v.cid)}.ipfs.dweb.link/" target="_blank">Another gateway</a><a href="https://filecoin-testnet.blockscout.com/tx/${esc(v.tx_hash)}" target="_blank">Storage transaction</a></div>`;
  for (const t of $('ticks').children) t.classList.toggle('on', Number(t.dataset.i) === i);
}
function pick(site) {
  state.site = site;
  for (const b of $('sites').children) b.classList.toggle('active', b.dataset.site === site.site);
  const n = site.versions.length; const slider = $('slider');
  slider.max = String(Math.max(0, n - 1)); slider.value = slider.max; slider.disabled = n < 2;
  $('ticks').innerHTML = site.versions.map((v, i) => `<button type="button" class="tick" data-i="${i}" title="${esc(when(v.timestamp))}"></button>`).join('');
  for (const t of $('ticks').children) t.onclick = () => { slider.value = t.dataset.i; show(Number(t.dataset.i)); };
  $('range').textContent = n ? `${when(site.versions[0].timestamp)} to ${when(site.versions[n - 1].timestamp)}` : '';
  $('note').textContent = `One data set for this site: #${site.data_set_id} on the ${NET.label}, as of block ${state.head}. Every snapshot is a new piece in it. Proofs cover the data set as a whole.`;
  show(n - 1);
}
async function load() {
  try {
    const [head, sets] = await Promise.all([sql(HEAD_SQL), sql(SETS_SQL)]);
    state.head = head.length ? Number(head[0].head) : null;
    if (!sets.length) { $('empty').hidden = false; return; }
    const pieces = await sql(piecesSql(sets.map((s) => Number(s.data_set_id)).join(',')));
    state.sites = sets.map((s) => ({ ...s, versions: pieces.filter((p) => p.data_set_id === s.data_set_id).map((p) => { let m = {}; try { m = JSON.parse(p.metadata || '{}'); } catch (e) {} return { ...p, cid: m.ipfsRootCID }; }).filter((p) => p.cid) })).filter((s) => s.versions.length);
    if (!state.sites.length) { $('empty').hidden = false; return; }
    $('sites').innerHTML = state.sites.map((s) => `<button type="button" class="tab" data-site="${esc(s.site)}">${esc(s.site)} <span>${s.versions.length}</span></button>`).join('');
    for (const b of $('sites').children) b.onclick = () => pick(state.sites.find((s) => s.site === b.dataset.site));
    $('slider').oninput = (e) => show(Number(e.target.value));
    $('machine').hidden = false;
    pick(state.sites[0]);
    getJson(`${OBS}/providers/${NET.obs}`).then((j) => { for (const p of (j.providers || [])) state.providers[p.providerId] = p.name; show(Number($('slider').value)); }).catch(() => {});
  } catch (e) { $('error').hidden = false; }
}
load();
