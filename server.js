import express from "express";
import multer from "multer";
import Database from "better-sqlite3";
import { spawn, execFile } from "node:child_process";
import { rm, mkdtemp } from "node:fs/promises";
import { readdirSync, statSync, lstatSync, existsSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 8090;
const app = express();
const execFileAsync = promisify(execFile);

// ── SQLite tracking ──
const DB_PATH = process.env.FOCIFY_DB || join(import.meta.dirname, "focify.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    input_type TEXT NOT NULL,
    cid TEXT,
    gateway_url TEXT,
    pages INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER
  )
`);

const insertJob = db.prepare(
  "INSERT INTO jobs (id, input, input_type, started_at) VALUES (?, ?, ?, ?)"
);
const completeJob = db.prepare(
  "UPDATE jobs SET status = ?, cid = ?, gateway_url = ?, pages = ?, error = ?, finished_at = ?, duration_ms = ? WHERE id = ?"
);

app.use(express.json());
// The converter page is the site root. /demo/ is kept as an alias so links
// to it keep working. In production nginx serves the gallery pages
// (/demos/, /guides/, /about/) from site/dist and proxies everything else here.
app.use(express.static("public"));
app.use("/demo", express.static("public"));

// File upload to temp dir, accept .zip .tar.gz .tgz .tar
const upload = multer({
  dest: join(tmpdir(), "focify-uploads"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".zip", ".tar", ".tgz", ".gz"];
    const ext = extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip, .tar, .tar.gz, .tgz archives are supported"));
    }
  },
});

// Compute directory size in bytes (recursive)
function dirSize(dir, seen = new Set()) {
  let total = 0;
  try {
    const st = lstatSync(dir);
    if (seen.has(st.ino)) return 0;
    seen.add(st.ino);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(p, seen);
        else total += statSync(p).size;
      } catch {}
    }
  } catch {}
  return total;
}

// Strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/\x1b\[[\x20-\x3f]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

// Parse a line of Nova CLI output into a structured event
function parseLine(raw) {
  const line = stripAnsi(raw).trim();
  if (!line) return null;

  // Skip ASCII banner and server file paths
  if (/[╔╗╚╝║═╦╩╠╣╬]/.test(line)) return null;
  if (line.includes("/home/") || line.includes("/tmp/")) return null;

  // Step: [1/4] Crawling and capturing assets
  const stepMatch = line.match(/^\[(\d+)\/(\d+)\]\s+(.+)/);
  if (stepMatch) {
    return { type: "step", current: +stepMatch[1], total: +stepMatch[2], text: stepMatch[3] };
  }

  // Success: ✔ Crawled 5 page(s)
  if (line.startsWith("✔") || line.startsWith("✓")) {
    return { type: "success", text: line.slice(1).trim() };
  }

  // Fail: ✘ Something went wrong
  if (line.startsWith("✘")) {
    return { type: "error", text: line.slice(1).trim() };
  }

  // Page progress: 3/50 https://example.com/about
  const pageMatch = line.match(/^(\d+)(\/\d+)?\s+(https?:\/\/.+)/);
  if (pageMatch) {
    return { type: "progress", current: +pageMatch[1], total: pageMatch[2] ? +pageMatch[2].slice(1) : undefined, url: pageMatch[3] };
  }

  // Rewrite progress: 3/5 /index.html
  const rewriteMatch = line.match(/^(\d+)\/(\d+)\s+(\/\S+)/);
  if (rewriteMatch) {
    return { type: "rewrite", current: +rewriteMatch[1], total: +rewriteMatch[2], path: rewriteMatch[3] };
  }

  // Box-drawing section borders: ┏━━ header ━━ and ┗━━
  if (/^[┏┗]━/.test(line)) {
    const header = line.replace(/[┏┗━┓┛]/g, "").trim();
    return header ? { type: "section", text: header } : null;
  }
  // Box-drawing content lines: strip ┃ prefix and re-parse inner content
  if (line.startsWith("┃")) {
    const inner = line.slice(1).trim();
    if (!inner) return null;
    if (inner.startsWith("✔") || inner.startsWith("✓")) {
      return { type: "success", text: inner.slice(1).trim() };
    }
    if (inner.startsWith("✘")) {
      return { type: "error", text: inner.slice(1).trim() };
    }
    if (/^https?:\/\//.test(inner) || /^ipfs:\/\//.test(inner)) {
      return { type: "info", text: inner, isUrl: true };
    }
    // Upload progress: "Uploading: 45% (12.3 MB / 27.1 MB)"
    const uploadMatch = inner.match(/^Uploading:\s+(\d+)%\s+\((.+)\)/);
    if (uploadMatch) {
      return { type: "upload_progress", pct: +uploadMatch[1], detail: uploadMatch[2] };
    }
    // Upload lifecycle phases
    if (inner === "Upload complete, committing on-chain...") {
      return { type: "upload_phase", phase: "committing", text: "Committing on-chain..." };
    }
    if (inner.startsWith("Transaction sent:")) {
      return { type: "upload_phase", phase: "tx_sent", text: inner };
    }
    if (inner === "Waiting for confirmation...") {
      return { type: "upload_phase", phase: "confirming", text: "Waiting for confirmation..." };
    }
    if (inner === "Confirmed on-chain") {
      return { type: "success", text: "Confirmed on-chain" };
    }
    return { type: "info", text: inner };
  }

  // Deploy complete line with CID
  if (line.includes("Deploy complete")) {
    return { type: "deploy_complete" };
  }

  // CID line
  const cidMatch = line.match(/^CID\s+(baf\S+)/);
  if (cidMatch) {
    return { type: "cid", cid: cidMatch[1] };
  }

  // Info line (anything else)
  return { type: "info", text: line };
}

// ── Job store ──
// Each job stores all events with incrementing IDs for SSE replay on reconnect.
const jobs = new Map();
const JOB_TTL = 10 * 60_000; // Clean up jobs after 10 minutes

function createJob(input, inputType) {
  const id = randomUUID();
  const now = Date.now();
  const job = {
    id,
    input,
    inputType,
    events: [],      // { id: number, data: object }
    nextEventId: 1,
    finished: false,
    clients: new Set(),
    child: null,
    keepalive: null,
    createdAt: now,
  };
  jobs.set(id, job);
  insertJob.run(id, input, inputType, new Date(now).toISOString());
  return job;
}

function addEvent(job, data) {
  const eventId = job.nextEventId++;
  job.events.push({ id: eventId, data });
  // Send to all connected clients
  for (const res of job.clients) {
    writeSSE(res, eventId, data);
  }
}

function writeSSE(res, id, data) {
  res.write(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
}

function finishJob(job) {
  job.finished = true;
  clearInterval(job.keepalive);
  // Close all client connections
  for (const res of job.clients) {
    res.end();
  }
  job.clients.clear();
  // Clean up after TTL
  setTimeout(() => jobs.delete(job.id), JOB_TTL);
}

// Active jobs (limit concurrency)
let activeJobs = 0;
const MAX_JOBS = 25;

// ── Pipeline configuration ──
// Two subprocesses per job: focify-clone crawls the site into a directory,
// then filecoin-pin uploads that directory to Filecoin Onchain Cloud.
const CLONE_CLI = process.env.FOCIFY_CLONE_CLI || join(import.meta.dirname, "focify-clone", "dist", "cli.js");
const PIN_CLI = process.env.FILECOIN_PIN_CLI || join(import.meta.dirname, "node_modules", ".bin", "filecoin-pin");
const PIN_NETWORK = process.env.FOCIFY_NETWORK || "calibration";
const PIN_PROVIDER_ID = process.env.FOCIFY_PROVIDER_ID || "";
const PIN_COPIES = process.env.FOCIFY_COPIES || "1";
const PIN_CREDENTIALS_FILE = process.env.FOCIFY_CREDENTIALS_FILE || "";
const MAX_PAGES = process.env.FOCIFY_MAX_PAGES || "100";
// Smaller cap that applies only when the cloner routes a challenge-protected
// site through the residential proxy (metered, ~35 s a page). Direct crawls
// keep MAX_PAGES.
const PROXY_MAX_PAGES = process.env.FOCIFY_PROXY_MAX_PAGES || "20";

// Result links use the subdomain gateway form: the clone keeps links
// root-relative, which only works when "/" is the site root.
function gatewayLinks(cid) {
  return {
    gatewayUrl: `https://${cid}.ipfs.inbrowser.link/`,
    dwebUrl: `https://${cid}.ipfs.dweb.link/`,
  };
}

// Spawn a child, stream its stderr and stdout lines through `onLine`,
// and resolve with { code, stdout } once it exits.
function runChild(job, cmd, args, { onStderrLine, onStdoutLine, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, FORCE_COLOR: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    let stdoutBuf = "";
    createInterface({ input: child.stderr }).on("line", (line) => onStderrLine?.(line));
    createInterface({ input: child.stdout }).on("line", (line) => {
      stdoutBuf += line + "\n";
      onStdoutLine?.(line);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdoutBuf }));
  });
}

// Lines from the upload step that must never reach visitors: anything naming
// a server path, the credential source, or the wallet.
function isSensitivePinLine(line) {
  return /\/home\/|\/tmp\/|\/root\/|session\.env|^Using session|\bowner 0x|credentials/i.test(line);
}

// Parse a line of filecoin-pin (non-TTY) output into an SSE event.
function parsePinLine(raw) {
  const line = stripAnsi(raw).trim();
  if (!line) return null;
  if (isSensitivePinLine(line)) return null;
  if (line.startsWith("✓")) return { type: "success", text: line.slice(1).trim() };
  if (line.startsWith("✗")) return { type: "error", text: line.slice(1).trim() };
  const cidMatch = line.match(/^Root CID:\s+(\S+)/);
  if (cidMatch) return { type: "cid", cid: cidMatch[1] };
  const pieceMatch = line.match(/^Piece CID:\s+(\S+)/);
  if (pieceMatch) return { type: "piece_cid", pieceCid: pieceMatch[1], text: line };
  const dsMatch = line.match(/^Data Set ID:\s+(\d+)/);
  if (dsMatch) return { type: "data_set", dataSetId: dsMatch[1], text: line };
  if (/Add Complete/.test(line)) return { type: "deploy_complete" };
  if (/^Add completed/.test(line)) return { type: "success", text: line };
  if (/^(Explorer|Retrieval URL):/.test(line)) return null;
  return { type: "info", text: line };
}

// Extract an uploaded archive (.zip, .tar, .tar.gz, .tgz) into a temp dir.
// If the archive wraps everything in a single top-level folder, use that
// folder as the site root so index.html sits at the top.
async function extractArchive(archivePath, originalName) {
  const tmpDir = await mkdtemp(join(tmpdir(), "focify-site-"));
  const lower = (originalName || archivePath).toLowerCase();
  // For zips, prefer unzip and fall back to Python's zipfile module when
  // unzip is not installed (it is not part of a minimal Ubuntu).
  const attempts = lower.endsWith(".zip")
    ? [["unzip", ["-q", archivePath, "-d", tmpDir]], ["python3", ["-m", "zipfile", "-e", archivePath, tmpDir]]]
    : lower.endsWith(".tar.gz") || lower.endsWith(".tgz")
      ? [["tar", ["-xzf", archivePath, "-C", tmpDir]]]
      : [["tar", ["-xf", archivePath, "-C", tmpDir]]];
  let lastErr = null;
  for (const [cmd, args] of attempts) {
    try {
      await execFileAsync(cmd, args);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code !== "ENOENT") break; // a real extraction error, don't try the next tool
    }
  }
  if (lastErr) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to extract archive: ${lastErr.stderr?.trim() || lastErr.message}`);
  }
  const entries = readdirSync(tmpDir).filter((n) => !n.startsWith("."));
  if (entries.length === 1 && statSync(join(tmpDir, entries[0])).isDirectory() && !existsSync(join(tmpDir, "index.html"))) {
    return { root: join(tmpDir, entries[0]), tmpDir };
  }
  return { root: tmpDir, tmpDir };
}

// ── Start a job ──
app.post("/api/demo/start", (req, res) => {
  const url = req.body.url;
  const filePath = req.body.file;
  const input = url || filePath;

  if (!input) {
    res.status(400).json({ error: "url or file parameter required" });
    return;
  }

  if (activeJobs >= MAX_JOBS) {
    res.status(503).json({ error: "Server busy -- too many concurrent jobs. Try again in a minute." });
    return;
  }

  if (url) {
    try {
      const normalized = url.startsWith("http") ? url : `https://${url}`;
      new URL(normalized);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }
  }

  // Validate uploaded file path -- must be in the uploads temp dir
  if (filePath) {
    const uploadsDir = join(tmpdir(), "focify-uploads");
    const resolved = resolve(filePath);
    if (!resolved.startsWith(uploadsDir)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }
  }

  activeJobs++;
  const inputType = url ? "url" : "file";
  const job = createJob(input, inputType);

  addEvent(job, { type: "info", text: `Starting demo for ${input}...` });

  // Keep connection alive during long crawls
  job.keepalive = setInterval(() => {
    for (const client of job.clients) {
      client.write(": keepalive\n\n");
    }
  }, 30_000);

  // Run the pipeline in the background; the response returns the job id now.
  runPipeline(job, { url, filePath, originalName: req.body.originalName });

  res.json({ jobId: job.id });
});

async function runPipeline(job, { url, filePath, originalName }) {
  let siteDir = null;      // directory handed to filecoin-pin
  let cleanupDir = null;   // directory to delete afterwards
  let pages = null;
  let proxied = false;
  let cid = null;
  let pieceCid = null;
  let dataSetId = null;
  let gatewayUrl = null;
  let error = null;

  // Crawl steps come from focify-clone as [n/4]; the upload is step 5.
  const CLONE_STEPS = 4;
  const TOTAL_STEPS = url ? CLONE_STEPS + 1 : 2;

  try {
    if (url) {
      const normalized = url.startsWith("http") ? url : `https://${url}`;
      const outDir = await mkdtemp(join(tmpdir(), "focify-clone-"));
      cleanupDir = outDir;
      const clone = await runChild(job, process.execPath, [CLONE_CLI, normalized, "--out", outDir, "--max-pages", MAX_PAGES, "--proxy-max-pages", PROXY_MAX_PAGES], {
        onStderrLine: (raw) => {
          const event = parseLine(raw);
          if (!event) return;
          if (event.type === "step") event.total = TOTAL_STEPS;
          addEvent(job, event);
        },
      });
      if (clone.code !== 0) {
        throw new Error(clone.code === 3
          ? "This site is behind a security challenge that the demo cannot pass."
          : `Site clone failed (exit code ${clone.code})`);
      }
      const result = JSON.parse(clone.stdout.trim());
      siteDir = result.directory;
      pages = result.pages || null;
      proxied = result.proxied === true;
    } else {
      addEvent(job, { type: "step", current: 1, total: TOTAL_STEPS, text: "Extracting archive" });
      const extracted = await extractArchive(filePath, originalName);
      siteDir = extracted.root;
      cleanupDir = extracted.tmpDir;
      addEvent(job, { type: "success", text: "Archive extracted" });
    }

    const siteBytes = dirSize(siteDir);

    addEvent(job, { type: "step", current: TOTAL_STEPS, total: TOTAL_STEPS, text: "Uploading to Filecoin Onchain Cloud" });
    const pinArgs = ["add", siteDir, "--network", PIN_NETWORK, "--copies", PIN_COPIES];
    if (PIN_PROVIDER_ID) pinArgs.push("--provider-id", PIN_PROVIDER_ID);
    if (PIN_CREDENTIALS_FILE) pinArgs.push("--credentials-file", PIN_CREDENTIALS_FILE);
    let pinError = null;
    const pin = await runChild(job, PIN_CLI, pinArgs, {
      onStdoutLine: (raw) => {
        const event = parsePinLine(raw);
        if (!event) return;
        if (event.type === "error") pinError = event.text;
        if (event.type === "cid") cid = event.cid;
        if (event.type === "piece_cid") pieceCid = event.pieceCid;
        if (event.type === "data_set" && !dataSetId) dataSetId = event.dataSetId;
        if (event.type === "piece_cid" || event.type === "data_set") event.type = "info";
        addEvent(job, event);
      },
      onStderrLine: (raw) => {
        const text = stripAnsi(raw).trim();
        if (text && !isSensitivePinLine(text)) addEvent(job, { type: "info", text });
      },
    });
    if (pin.code !== 0 || !cid) {
      throw new Error(pinError || (cid ? `Upload finished with errors (exit code ${pin.code})` : "Upload finished but no CID found in output"));
    }

    const links = gatewayLinks(cid);
    gatewayUrl = links.gatewayUrl;
    addEvent(job, {
      type: "complete",
      cid,
      pieceCid,
      dataSetId,
      ...links,
      pages,
      proxied,
      proxyMaxPages: proxied ? Number(PROXY_MAX_PAGES) : null,
      siteBytes,
      sourceUrl: url || originalName || null,
    });
  } catch (err) {
    error = err.message || String(err);
    // filecoin-pin's own ✗ line was already streamed; don't repeat it.
    if (!job.events.some((e) => e.data.type === "error" && e.data.text === error)) {
      addEvent(job, { type: "error", text: error });
    }
  }

  activeJobs--;
  const now = new Date().toISOString();
  const durationMs = Date.now() - job.createdAt;
  completeJob.run(cid ? "success" : "error", cid, gatewayUrl, pages, error, now, durationMs, job.id);
  addEvent(job, { type: "done" });
  finishJob(job);

  if (cleanupDir) rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
  if (filePath) rm(filePath, { force: true }).catch(() => {});
}


// ── Stream events for a job (supports reconnect via Last-Event-ID) ──
app.get("/api/demo/stream/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Replay missed events
  const lastId = parseInt(req.headers["last-event-id"] || "0", 10);
  for (const evt of job.events) {
    if (evt.id > lastId) {
      writeSSE(res, evt.id, evt.data);
    }
  }

  // If job already finished, close immediately after replay
  if (job.finished) {
    res.end();
    return;
  }

  // Register for future events
  job.clients.add(res);

  req.on("close", () => {
    job.clients.delete(res);
    // Don't kill the child -- job continues in background for reconnect
  });
});

// ── Job stats ──
const recentJobs = db.prepare(
  "SELECT id, input, input_type, cid, pages, status, error, started_at, finished_at, duration_ms FROM jobs ORDER BY started_at DESC LIMIT ?"
);
const jobStats = db.prepare(
  "SELECT COUNT(*) as total, COUNT(cid) as successful, COUNT(*) - COUNT(cid) as failed FROM jobs"
);

app.get("/api/stats", (_req, res) => {
  const stats = jobStats.get();
  const recent = recentJobs.all(20);
  res.json({ ...stats, recent });
});

const allJobs = db.prepare(
  "SELECT id, input, input_type, cid, pages, status, error, started_at, finished_at, duration_ms FROM jobs ORDER BY started_at DESC"
);

app.get("/api/jobs", (_req, res) => {
  res.json(allJobs.all());
});

// ── Legacy GET endpoint (redirect to new flow) ──
app.get("/api/demo/stream", (req, res) => {
  res.status(410).json({ error: "Use POST /api/demo/start then GET /api/demo/stream/:jobId" });
});

// File upload endpoint
app.post("/api/upload", upload.single("archive"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.json({ path: req.file.path, originalName: req.file.originalname });
});

// Error handler for multer and other middleware errors
app.use((err, _req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File too large (max 500MB)" });
  } else {
    res.status(400).json({ error: err.message || "Upload failed" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`FOCify.ME server running on port ${PORT}`);
});

// Graceful shutdown: stop accepting new connections, wait for in-flight jobs to finish
process.on("SIGTERM", () => {
  console.log("SIGTERM received -- draining in-flight jobs...");
  server.close();
  const check = setInterval(() => {
    if (activeJobs === 0) {
      clearInterval(check);
      console.log("All jobs drained, exiting.");
      db.close();
      process.exit(0);
    }
  }, 1000);
});
