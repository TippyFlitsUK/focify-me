import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 8090;
const app = express();

app.use(express.json());
app.use(express.static("public"));

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

function createJob(input) {
  const id = randomUUID();
  const job = {
    id,
    input,
    events: [],      // { id: number, data: object }
    nextEventId: 1,
    finished: false,
    clients: new Set(),
    child: null,
    keepalive: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
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
const MAX_JOBS = 10;
const JOB_TIMEOUT = 10 * 60_000; // Kill subprocess after 10 minutes

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
  const job = createJob(input);

  addEvent(job, { type: "info", text: `Starting demo for ${input}...` });

  // Keep connection alive during long crawls
  job.keepalive = setInterval(() => {
    for (const client of job.clients) {
      client.write(": keepalive\n\n");
    }
  }, 30_000);

  // Spawn nova demo
  const novaCli = process.env.NOVA_CLI;
  const args = ["demo", input, "--json", "--provider-id", "9", "--max-pages", "100"];
  const spawnOpts = { env: { ...process.env, FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] };
  const child = novaCli
    ? spawn("node", [novaCli, ...args], spawnOpts)
    : spawn("npx", ["-y", "--package", "filecoin-nova", "nova", ...args], spawnOpts);

  job.child = child;
  let stdoutBuf = "";

  // Kill subprocess if it runs too long (prevents hung jobs blocking slots)
  const jobTimer = setTimeout(() => {
    if (!job.finished) {
      addEvent(job, { type: "error", text: "Job timed out after 10 minutes" });
      child.kill("SIGTERM");
    }
  }, JOB_TIMEOUT);

  const rl = createInterface({ input: child.stderr });
  rl.on("line", (raw) => {
    const event = parseLine(raw);
    if (event) {
      addEvent(job, event);
    }
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
  });

  child.on("close", (code) => {
    clearTimeout(jobTimer);
    activeJobs--;

    let directory;
    if (code === 0) {
      try {
        const result = JSON.parse(stdoutBuf.trim());
        directory = result.directory;
        addEvent(job, { type: "complete", ...result });
      } catch {
        const cidMatch = stdoutBuf.match(/baf[a-z0-9]{50,}/);
        if (cidMatch) {
          addEvent(job, {
            type: "complete",
            cid: cidMatch[0],
            gatewayUrl: `https://${cidMatch[0]}.ipfs.dweb.link/`,
          });
        } else {
          addEvent(job, { type: "error", text: "Deploy finished but no CID found in output" });
        }
      }
    } else {
      addEvent(job, { type: "error", text: `Deploy failed (exit code ${code})` });
    }

    addEvent(job, { type: "done" });
    finishJob(job);

    if (directory) {
      rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  });

  child.on("error", (err) => {
    clearTimeout(jobTimer);
    activeJobs--;
    addEvent(job, { type: "error", text: err.message });
    addEvent(job, { type: "done" });
    finishJob(job);
  });

  res.json({ jobId: job.id });
});

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
      process.exit(0);
    }
  }, 1000);
});
