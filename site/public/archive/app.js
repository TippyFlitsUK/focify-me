const OBS = 'https://observer.yablu.net';
const NET = { obs: 'calibnet', label: 'Calibration testnet', chainId: 314159, rpc: 'https://api.calibration.node.glif.io/rpc/v1', explorer: 'https://filecoin-testnet.blockscout.com' };
const USDFC = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0';
const FILECOIN_PAY = '0x09a0fDc2723fAd1A7b8e3e00eE5DF73841df55a0';
const ACCOUNT = '0x12e83C954051B7c91F70d001F80dc9Ff91737b83';
const ARCHIVE_KEY = 'archive';
const ARCHIVE_VALUE = 'apollo-11';
const EPOCH_SECONDS = 30;
const EPOCHS_PER_DAY = 2880;
const EPOCHS_100_YEARS = Math.round(EPOCHS_PER_DAY * 365.25 * 100);
const PROOF_STALE_SECONDS = 6 * 3600;
const MAXUINT_LEN = 70;
const TIMEOUT_MS = 25000;
const ETHERS = 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js';
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)', 'function allowance(address owner, address spender) view returns (uint256)', 'function balanceOf(address owner) view returns (uint256)'];
const PAY_ABI = ['function deposit(address token, address to, uint256 amount) payable'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => Number(n).toLocaleString('en-GB');
const day = (ts) => new Date(Number(ts) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function bytes(n) {
  n = Number(n); if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
}
function usd(wei) {
  const v = Number(wei) / 1e18;
  return v >= 100 ? num(Math.round(v)) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toFixed(6);
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

const HEAD_SQL = 'SELECT block_number AS head, timestamp AS head_ts FROM (SELECT block_number, timestamp FROM pdp_possession_proven ORDER BY block_number DESC LIMIT 1) a UNION ALL SELECT block_number, timestamp FROM (SELECT block_number, timestamp FROM pdp_next_proving_period ORDER BY block_number DESC LIMIT 1) b ORDER BY head DESC LIMIT 1';
const SET_SQL = `SELECT d.data_set_id, d.provider_id, d.pdp_rail_id, d.timestamp AS created, (SELECT MAX(p.timestamp) FROM pdp_possession_proven p WHERE p.set_id = d.data_set_id) AS last_proof, (SELECT COUNT(*) FROM pdp_possession_proven p WHERE p.set_id = d.data_set_id) AS proofs FROM fwss_data_set_created d WHERE lower(d.payer) = '${ACCOUNT.toLowerCase()}' AND d.metadata::jsonb ->> '${ARCHIVE_KEY}' = '${ARCHIVE_VALUE}' AND NOT EXISTS (SELECT 1 FROM fwss_pdp_payment_terminated t WHERE t.data_set_id = d.data_set_id) ORDER BY d.data_set_id`;
const piecesSql = (ids) => `WITH rm AS (SELECT r.set_id, jsonb_array_elements_text(r.piece_ids::jsonb)::bigint AS piece_id FROM pdp_pieces_removed r WHERE r.set_id IN (${ids})) SELECT x.data_set_id, x.piece_id, x.piece_cid, x.raw_size, x.timestamp, x.metadata FROM fwss_piece_added x LEFT JOIN rm ON rm.set_id = x.data_set_id AND rm.piece_id = x.piece_id WHERE x.data_set_id IN (${ids}) AND rm.piece_id IS NULL ORDER BY x.piece_id`;

let state = { head: null, headTs: null };
const epochTs = (epoch) => state.headTs + (Number(epoch) - state.head) * EPOCH_SECONDS;

function renderFunding() {
  const a = state.account; const box = $('funding');
  if (!a || a.funds == null || state.head == null) { box.innerHTML = '<p class="big">Funding could not be read</p><p class="fine">The account lookup did not answer. Try again in a minute.</p>'; return; }
  const rate = BigInt(a.currentLockupRate || a.lockupRate || '0');
  const avail = BigInt(a.availableFunds || '0');
  const asOf = `as of block ${state.head}`;
  let headline, fine;
  if (rate === 0n) { headline = 'Nothing is being charged yet'; fine = `No storage payments are running from this account, ${asOf}.`; }
  else if (String(a.fundedUntilEpoch).length >= MAXUINT_LEN) { headline = 'Funded with no end date'; fine = asOf; }
  else {
    const until = Number(a.fundedUntilEpoch); const runway = until - state.head;
    if (runway <= 0) { headline = `Funding ran out on ${day(epochTs(until))}`; fine = `The account needs a deposit, ${asOf}.`; }
    else {
      const left = runway * EPOCH_SECONDS; const years = left / (365.25 * 86400);
      headline = `Funded until ${day(epochTs(until))}`;
      fine = `${years >= 2 ? years.toFixed(1) + ' years' : num(Math.floor(left / 86400)) + ' days'} from now at today's rate, ${asOf}.`;
    }
  }
  const need = rate * BigInt(EPOCHS_100_YEARS) - avail;
  const hundred = rate === 0n ? '' : need > 0n
    ? `<p class="hundred"><strong>${usd(need)} USDFC more</strong> would fund this account for 100 years at today's rate.</p>`
    : `<p class="hundred">At today's rate the account already holds enough for 100 years.</p>`;
  let share = '';
  if (state.rail && state.rail.paymentRate != null) {
    const r = BigInt(state.rail.paymentRate);
    share = `<div><dt>This archive costs</dt><dd>${usd(r * BigInt(EPOCHS_PER_DAY * 30))} USDFC per 30 days</dd></div><div><dt>This archive, 100 years</dt><dd>${usd(r * BigInt(EPOCHS_100_YEARS))} USDFC</dd></div>`;
  }
  box.innerHTML = `<p class="big">${headline}</p><p class="fine">${fine}</p>${hundred}
    <dl class="kv"><div><dt>In the account</dt><dd>${usd(a.funds)} USDFC</dd></div><div><dt>Whole account costs</dt><dd>${usd(rate * BigInt(EPOCHS_PER_DAY * 30))} USDFC per 30 days</dd></div>${share}</dl>
    <p class="fine">The rate can change, and so can the price of storage, so these are projections and not promises. The account also pays for other focify.me demos, which is why the whole-account figure is larger than the archive's own.</p>`;
}

function renderItems() {
  const now = Date.now() / 1000;
  const set = state.sets[0];
  const fresh = set && set.last_proof && now - Number(set.last_proof) < PROOF_STALE_SECONDS;
  const provider = set ? state.providers[set.provider_id] : null;
  const byName = new Map();
  for (const p of state.pieces) { try { const m = JSON.parse(p.metadata || '{}'); if (m.name) byName.set(m.name, { ...p, root: m.ipfsRootCID }); } catch (e) {} }
  let stored = 0;
  $('items').innerHTML = state.collection.items.map((it) => {
    const p = byName.get(it.file);
    let st, link = '';
    if (!p) st = '<span class="st ended">Not stored yet</span>';
    else {
      stored++;
      st = fresh ? `<span class="st live">Stored, proof current</span><small>last proof ${ago(now - Number(set.last_proof))}</small>`
        : set.last_proof ? `<span class="st ending">Stored, proof overdue</span><small>last proof ${ago(now - Number(set.last_proof))}</small>`
        : '<span class="st ending">Stored, first proof pending</span>';
      if (p.root) link = `<a href="https://inbrowser.link/ipfs/${esc(p.root)}" target="_blank">Open from Filecoin</a>`;
    }
    return `<div class="focified-card item"><div class="item-in">
      <img src="./thumbs/${esc(it.file)}" alt="" loading="lazy" width="640" height="640">
      <div class="focified-info"><div class="focified-name">${esc(it.title)}</div>
      <div class="focified-stats">
        <div class="focified-stat"><span class="label">Frame</span><span class="value">${esc(it.id)}</span></div>
        <div class="focified-stat"><span class="label">Taken</span><span class="value">${esc(it.date)}</span></div>
        <div class="focified-stat"><span class="label">Size</span><span class="value">${bytes(it.bytes)}</span></div>
        <div class="focified-stat status"><span class="label">Status</span><span class="value">${st}</span></div>
      </div>
      <div class="item-links">${link}<a href="${esc(it.source)}" target="_blank">NASA record</a></div></div>
    </div></div>`;
  }).join('');
  const total = state.collection.items.reduce((a, i) => a + i.bytes, 0);
  $('summary').innerHTML = `<div class="net-stats">
    <div class="net-stat"><span class="net-value">${stored} / ${state.collection.items.length}</span><span class="net-label">photographs stored</span></div>
    <div class="net-stat"><span class="net-value">${bytes(total)}</span><span class="net-label">collection size</span></div>
    <div class="net-stat"><span class="net-value">${set ? num(set.proofs) : 0}</span><span class="net-label">storage proofs so far</span></div>
    <div class="net-stat"><span class="net-value">${set && set.last_proof ? ago(now - Number(set.last_proof)) : 'none'}</span><span class="net-label">last proof</span></div>
  </div><p class="net-note">${set ? `Data set #${esc(set.data_set_id)} with provider #${esc(set.provider_id)}${provider ? ' ' + esc(provider.name) : ''} on the ${NET.label}` : `Not uploaded yet on the ${NET.label}`}, as of block ${state.head}. Proofs cover the data set as a whole: the provider is challenged on randomly chosen parts of it. Source: observer.yablu.net</p>`;
  $('summary').hidden = false;
}

function renderPlain() {
  $('items').innerHTML = state.collection.items.map((it) => `<div class="focified-card item"><div class="item-in"><img src="./thumbs/${esc(it.file)}" alt="" loading="lazy" width="640" height="640"><div class="focified-info"><div class="focified-name">${esc(it.title)}</div><div class="item-links"><a href="${esc(it.source)}" target="_blank">NASA record</a></div></div></div></div>`).join('');
}
async function load() {
  if (!state.collection) { state.collection = await getJson('./collection.json'); state.sets = []; state.pieces = []; state.providers = {}; renderPlain(); }
  getJson(`${OBS}/providers/${NET.obs}`).then((j) => {
    for (const p of (j.providers || [])) state.providers[p.providerId] = { name: p.name };
    if (state.head != null) renderItems();
  }).catch(() => {});
  const [head, sets, account] = await Promise.allSettled([sql(HEAD_SQL), sql(SET_SQL), getJson(`${OBS}/account/${NET.obs}/${USDFC}/${ACCOUNT}`)]);
  if (head.status === 'fulfilled' && head.value.length) { state.head = Number(head.value[0].head); state.headTs = Number(head.value[0].head_ts); }
  if (sets.status === 'fulfilled') state.sets = sets.value;
  state.account = account.status === 'fulfilled' ? account.value : null;
  if (state.sets.length) {
    const [pieces, rail] = await Promise.allSettled([sql(piecesSql(state.sets.map((s) => Number(s.data_set_id)).join(','))), getJson(`${OBS}/rail/${NET.obs}/${state.sets[0].pdp_rail_id}`)]);
    if (pieces.status === 'fulfilled') state.pieces = pieces.value;
    state.rail = rail.status === 'fulfilled' ? rail.value : null;
  }
  if (state.head == null || sets.status === 'rejected') { $('summary').hidden = true; $('live-note').hidden = false; }
  else { $('live-note').hidden = true; renderItems(); }
  renderFunding();
}

function loadScript(src) { return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); }); }
function say(kind, html) { const el = $('donate-status'); el.className = `dstatus ${kind}`; el.innerHTML = html; }
let wallet = null;
async function connect() {
  if (!window.ethereum) { say('bad', 'No browser wallet found. Install MetaMask, then reload this page.'); return; }
  $('connect').disabled = true;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const hexChain = '0x' + NET.chainId.toString(16);
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] }); }
    catch (err) {
      if (err.code !== 4902) throw err;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain, chainName: 'Filecoin Calibration testnet', nativeCurrency: { name: 'tFIL', symbol: 'tFIL', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: [NET.explorer] }] });
    }
    if (!window.ethers) await loadScript(ETHERS);
    wallet = accounts[0];
    const provider = new ethers.BrowserProvider(window.ethereum);
    const bal = await new ethers.Contract(USDFC, ERC20_ABI, provider).balanceOf(wallet);
    $('connect').hidden = true; $('donate-form').hidden = false;
    say('', `Connected as <span class="mono">${esc(wallet)}</span>. Your wallet holds ${usd(bal)} test USDFC.`);
  } catch (err) { say('bad', esc(err.shortMessage || err.message || 'Could not connect')); }
  finally { $('connect').disabled = false; }
}
async function donate(e) {
  e.preventDefault();
  const raw = $('amount').value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(raw) || Number(raw) <= 0) { say('bad', 'Enter an amount of USDFC, for example 1 or 0.5.'); return; }
  $('give').disabled = true;
  try {
    const amount = ethers.parseUnits(raw, 18);
    const provider = new ethers.BrowserProvider(window.ethereum); const signer = await provider.getSigner();
    const token = new ethers.Contract(USDFC, ERC20_ABI, signer); const pay = new ethers.Contract(FILECOIN_PAY, PAY_ABI, signer);
    if (await token.balanceOf(wallet) < amount) { say('bad', 'Your wallet does not hold that much USDFC.'); return; }
    if (await token.allowance(wallet, FILECOIN_PAY) < amount) {
      say('wait', 'Step 1 of 2: approve the amount in your wallet.');
      const tx1 = await token.approve(FILECOIN_PAY, amount);
      say('wait', 'Step 1 of 2: waiting for the approval to confirm. This takes about a minute.');
      await tx1.wait();
    }
    say('wait', 'Step 2 of 2: confirm the deposit in your wallet.');
    const tx2 = await pay.deposit(USDFC, ACCOUNT, amount);
    say('wait', 'Step 2 of 2: waiting for the deposit to confirm. This takes about a minute.');
    await tx2.wait();
    say('ok', `Deposited ${esc(raw)} USDFC into the archive's account. <a href="${NET.explorer}/tx/${esc(tx2.hash)}" target="_blank">See the transaction</a>. The funded-until date above updates within a few minutes.`);
    load();
  } catch (err) { say('bad', esc(err.code === 'ACTION_REJECTED' ? 'Cancelled in the wallet. Nothing was sent.' : (err.shortMessage || err.message || 'The transaction failed'))); }
  finally { $('give').disabled = false; }
}
$('connect').onclick = connect;
$('donate-form').addEventListener('submit', donate);
$('account').textContent = ACCOUNT;
load();
