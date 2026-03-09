import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

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
  return str.replace(/\x1b\[[0-9;]*m/g, "");
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
    // Re-run through the same parsing logic on the inner content
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

// Active jobs (limit concurrency)
let activeJobs = 0;
const MAX_JOBS = 3;

// SSE endpoint: start a demo job
app.get("/api/demo/stream", (req, res) => {
  const url = req.query.url;
  const filePath = req.query.file;
  const input = url || filePath;

  if (!input) {
    res.status(400).json({ error: "url or file parameter required" });
    return;
  }

  if (activeJobs >= MAX_JOBS) {
    res.status(503).json({ error: "Server busy -- too many concurrent jobs. Try again in a minute." });
    return;
  }

  // Basic URL validation
  if (url) {
    try {
      const normalized = url.startsWith("http") ? url : `https://${url}`;
      new URL(normalized);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }
  }

  activeJobs++;

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Keep connection alive during long crawls (Cloudflare times out idle connections at 100s)
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30_000);

  sendEvent({ type: "info", text: `Starting demo for ${input}...` });

  // Spawn nova demo
  // NOVA_CLI env var overrides npx (for local builds before npm publish)
  const novaCli = process.env.NOVA_CLI;
  const args = ["demo", input, "--json", "--provider-id", "9", "--max-pages", "100"];
  const spawnOpts = { env: { ...process.env, FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] };
  const child = novaCli
    ? spawn("node", [novaCli, ...args], spawnOpts)
    : spawn("npx", ["-y", "--package", "filecoin-nova", "nova", ...args], spawnOpts);

  let stdoutBuf = "";

  // With --json, Nova redirects progress to stderr and writes JSON result to stdout.
  // Stream stderr progress as SSE events.
  const rl = createInterface({ input: child.stderr });
  rl.on("line", (raw) => {
    const event = parseLine(raw);
    if (event) {
      sendEvent(event);
    }
  });

  // Collect stdout (JSON result only)
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
  });

  child.on("close", (code) => {
    activeJobs--;

    let directory;
    if (code === 0) {
      // Try to parse JSON result captured from stdout
      try {
        const result = JSON.parse(stdoutBuf.trim());
        directory = result.directory;
        sendEvent({ type: "complete", ...result });
      } catch {
        // If no JSON, extract CID from output
        const cidMatch = stdoutBuf.match(/baf[a-z0-9]{50,}/);
        if (cidMatch) {
          sendEvent({
            type: "complete",
            cid: cidMatch[0],
            gatewayUrl: `https://${cidMatch[0]}.ipfs.dweb.link/`,
          });
        } else {
          sendEvent({ type: "error", text: "Deploy finished but no CID found in output" });
        }
      }
    } else {
      sendEvent({ type: "error", text: `Deploy failed (exit code ${code})` });
    }

    clearInterval(keepalive);
    sendEvent({ type: "done" });
    res.end();

    // Clean up cloned directory
    if (directory) {
      rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  });

  child.on("error", (err) => {
    activeJobs--;
    clearInterval(keepalive);
    sendEvent({ type: "error", text: err.message });
    sendEvent({ type: "done" });
    res.end();
  });

  // Clean up if client disconnects
  req.on("close", () => {
    clearInterval(keepalive);
    if (!child.killed) {
      child.kill("SIGTERM");
      activeJobs--;
    }
  });
});

// File upload endpoint -- saves archive, returns temp path
app.post("/api/upload", upload.single("archive"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.json({ path: req.file.path, originalName: req.file.originalname });
});

app.listen(PORT, () => {
  console.log(`FOCify.ME server running on port ${PORT}`);
});
