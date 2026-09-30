// Terminal output helpers for focify-clone.
//
// Everything here writes through console.log. The CLI entry point redirects
// console.log to stderr so that stdout carries only the JSON result; callers
// such as focify-me's server stream stderr line by line for live progress.
// Keep the line shapes stable: "[n/m] text", "✔ text", "✘ text" and
// "n/m https://..." are parsed by the server.

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function step(num: number, total: number, text: string) {
  console.log(`  ${c.dim}[${num}/${total}]${c.reset} ${text}`);
}

export function info(text: string) {
  console.log(`  ${c.dim}${text}${c.reset}`);
}

export function success(text: string) {
  console.log(`  ${c.green}✔${c.reset} ${text}`);
}

export function fail(text: string) {
  console.log(`  ${c.red}✘${c.reset} ${text}`);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** True when the input has a protocol or looks like a domain.tld. */
export function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(input);
}
