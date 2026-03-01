#!/usr/bin/env node

// cc-context-check — See how full your Claude Code context window is
// Reads ~/.claude/projects/ session transcripts, extracts token usage from the latest exchange.
// Zero dependencies. Works with Claude Sonnet/Opus/Haiku.

import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Config ──────────────────────────────────────────────────────

const CONTEXT_LIMIT = 200_000; // Claude Sonnet/Opus context window (tokens)
const WARN_PCT = 0.70;         // yellow warning threshold
const CRIT_PCT = 0.85;         // red critical threshold
const TAIL_BYTES = 65_536;     // read last 64KB to find recent usage data

// ── Color helpers ───────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function bar(pct, width = 30) {
  const filled = Math.min(Math.round(pct * width), width);
  const color = pct >= CRIT_PCT ? C.red : pct >= WARN_PCT ? C.yellow : C.green;
  return color + '█'.repeat(filled) + C.dim + '░'.repeat(width - filled) + C.reset;
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

// ── Read last N bytes of a file ──────────────────────────────────

async function readTail(filePath, maxBytes) {
  const fh = await open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ── Find latest usage from a jsonl chunk ─────────────────────────

function extractLatestUsage(chunk) {
  const lines = chunk.split('\n').reverse();
  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant') continue;
    const usage = d?.message?.usage;
    if (!usage) continue;
    const inputTokens = (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    const outputTokens = usage.output_tokens || 0;
    if (inputTokens > 0) {
      return { inputTokens, outputTokens, raw: usage };
    }
  }
  return null;
}

// ── Find all project jsonl files sorted by mtime ─────────────────

async function findAllJsonlFiles() {
  const base = join(homedir(), '.claude', 'projects');
  let projectDirs;
  try {
    projectDirs = await readdir(base);
  } catch {
    return [];
  }

  const files = [];
  for (const dir of projectDirs) {
    const dirPath = join(base, dir);
    let entries;
    try { entries = await readdir(dirPath); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(dirPath, entry);
      try {
        const s = await stat(filePath);
        files.push({ filePath, mtime: s.mtimeMs, size: s.size, project: dir });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

// ── Format timestamp ─────────────────────────────────────────────

function relTime(mtime) {
  const diff = Date.now() - mtime;
  const min = Math.floor(diff / 60_000);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m ago`;
  if (min > 0) return `${min}m ago`;
  return 'just now';
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes('--all') || args.includes('-a');
  const jsonOut = args.includes('--json');
  const topN = showAll ? 20 : 5;

  const files = await findAllJsonlFiles();
  if (files.length === 0) {
    console.error('No Claude Code session files found in ~/.claude/projects/');
    process.exit(1);
  }

  const results = [];
  for (const f of files.slice(0, topN)) {
    let usage = null;
    try {
      const chunk = await readTail(f.filePath, TAIL_BYTES);
      usage = extractLatestUsage(chunk);
    } catch {}
    results.push({ ...f, usage });
  }

  if (jsonOut) {
    console.log(JSON.stringify(results.map(r => ({
      project: r.project,
      file: r.filePath.split('/').pop(),
      mtime: new Date(r.mtime).toISOString(),
      size_mb: (r.size / 1024 / 1024).toFixed(1),
      input_tokens: r.usage?.inputTokens ?? null,
      output_tokens: r.usage?.outputTokens ?? null,
      pct: r.usage ? (r.usage.inputTokens / CONTEXT_LIMIT * 100).toFixed(1) : null,
    })), null, 2));
    return;
  }

  // ── Header ───────────────────────────────────────────────────
  console.log(`\n${C.bold}cc-context-check${C.reset} — Context window usage across sessions\n`);
  console.log(`${C.dim}Context limit: ${fmt(CONTEXT_LIMIT)} tokens (Claude Sonnet/Opus)${C.reset}\n`);

  let anyData = false;
  for (const r of results) {
    const projectShort = r.project.replace(/-home-namakusa-?/, '~/')
      .replace(/^~\/projects\//, '~/').slice(0, 40);
    const sessionId = r.filePath.split('/').pop().slice(0, 8);
    const sizeStr = (r.size / 1024 / 1024).toFixed(1) + ' MB';

    if (!r.usage) {
      console.log(`${C.dim}${projectShort} [${sessionId}] — no usage data (${relTime(r.mtime)})${C.reset}`);
      continue;
    }

    anyData = true;
    const { inputTokens, outputTokens } = r.usage;
    const pct = inputTokens / CONTEXT_LIMIT;
    const pctStr = (pct * 100).toFixed(1) + '%';
    const statusIcon = pct >= CRIT_PCT ? '🔴' : pct >= WARN_PCT ? '🟡' : '🟢';
    const remaining = CONTEXT_LIMIT - inputTokens;

    console.log(`${statusIcon} ${C.bold}${projectShort}${C.reset} ${C.dim}[${sessionId}] ${relTime(r.mtime)} · ${sizeStr}${C.reset}`);
    console.log(`   ${bar(pct)} ${C.bold}${pctStr}${C.reset} used`);
    console.log(`   ${C.cyan}${fmt(inputTokens)}${C.reset} input · ${C.dim}${fmt(outputTokens)} output · ${fmt(remaining)} remaining${C.reset}`);

    if (pct >= CRIT_PCT) {
      console.log(`   ${C.red}⚠ Critical: Run /compact soon to avoid context overflow${C.reset}`);
    } else if (pct >= WARN_PCT) {
      console.log(`   ${C.yellow}△ Warning: Context is getting full — consider /compact${C.reset}`);
    }
    console.log();
  }

  if (!anyData) {
    console.log(`${C.dim}No token usage data found in recent sessions.${C.reset}`);
    console.log(`${C.dim}Token data appears in sessions after at least one AI response.${C.reset}\n`);
  }

  // ── Footer ───────────────────────────────────────────────────
  console.log(`${C.dim}Options: --all (-a) show top 20 sessions · --json JSON output${C.reset}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
