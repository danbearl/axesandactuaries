#!/usr/bin/env node
// Generates a read-only Kanban-style view of ROADMAP.md — no separate source of truth,
// just a projection of the same file. Re-run any time ROADMAP.md changes:
//   pnpm roadmap:board
// then open the resulting roadmap-board.html directly in a browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const roadmapPath = path.join(repoRoot, 'ROADMAP.md');
const outputPath = path.join(repoRoot, 'roadmap-board.html');

function parseRoadmap(markdown) {
  const lines = markdown.split('\n');
  const phases = [];
  let current = null;
  let inGoal = false;

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch) {
      current = { name: headerMatch[1].trim(), goal: '', items: [] };
      phases.push(current);
      inGoal = false;
      continue;
    }
    if (!current) continue;

    const goalMatch = line.match(/^\*\*Goal:\*\*\s*(.+)$/);
    if (goalMatch) {
      current.goal = goalMatch[1].trim();
      inGoal = true;
      continue;
    }
    // Goal statements wrap onto unindented continuation lines until a blank line.
    if (inGoal) {
      if (line.trim() === '') {
        inGoal = false;
      } else {
        current.goal += ' ' + line.trim();
        continue;
      }
    }

    const doneMatch = line.match(/^- \[x\] (.+)$/);
    const pendingMatch = line.match(/^- (?!\[)(.+)$/);

    if (doneMatch) {
      current.items.push({ done: true, text: doneMatch[1].trim() });
    } else if (pendingMatch) {
      current.items.push({ done: false, text: pendingMatch[1].trim() });
    } else if (current.items.length > 0 && /^\s{2,}\S/.test(line)) {
      // Wrapped continuation line (or a nested sub-bullet) — fold into the current card's text.
      current.items[current.items.length - 1].text += ' ' + line.trim();
    }
  }

  // Only sections that actually contain roadmap items (skips "Current State" prose and
  // the "Development Phases" numbered overview, neither of which use "- " item bullets).
  return phases.filter((p) => p.items.length > 0);
}

function splitTitleDescription(text) {
  // Find the first " — " that isn't nested inside parentheses — some items have their own
  // em-dash inside a provenance/date parenthetical (e.g. "Foo (2026-07-05, concepts
  // captured — needs refinement) — actual description"), and naively splitting on the
  // first occurrence would cut the title off mid-parenthetical.
  let depth = 0;
  let splitIdx = -1;
  for (let i = 0; i < text.length - 2; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(' — ', i)) {
      splitIdx = i;
      break;
    }
  }
  let title = splitIdx === -1 ? text : text.slice(0, splitIdx);
  const description = splitIdx === -1 ? '' : text.slice(splitIdx + 3);
  // Strip a trailing provenance/date parenthetical from the title, e.g. "(2026-07-03)" or
  // "(from original TODO.md, Game Mechanics)", with or without a trailing period.
  title = title.replace(/\s*\([^)]*\)\.?\s*$/, '').trim();
  return { title, description: description.trim() };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emphasize(s) {
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic requires a non-space, non-asterisk-bearing span, so bare asterisks used as
  // multiplication signs ("10 * x") or cron wildcards ("* * * * *") aren't misread as
  // emphasis markers.
  s = s.replace(/\*(\S(?:[^*]*\S)?)\*/g, '<em>$1</em>');
  return s;
}

// Light inline-markdown pass — just enough for how ROADMAP.md actually uses emphasis.
// Code spans are isolated and treated as opaque literal text *before* emphasis parsing
// runs, so a literal "*" inside two separate `code` spans (e.g. a package-rename example)
// can't be misread as an emphasis pair spanning both of them.
function inlineMarkdown(text) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => (part.startsWith('`') && part.endsWith('`')
      ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
      : emphasize(escapeHtml(part))))
    .join('');
}

function renderCard(item) {
  const { title, description } = splitTitleDescription(item.text);
  const statusClass = item.done ? 'card-done' : 'card-todo';
  if (!description) {
    return `<div class="card ${statusClass}"><div class="card-title">${inlineMarkdown(title)}</div></div>`;
  }
  return `
    <details class="card ${statusClass}">
      <summary class="card-title">${inlineMarkdown(title)}</summary>
      <div class="card-desc">${inlineMarkdown(description)}</div>
    </details>`;
}

function renderPhase(phase) {
  const done = phase.items.filter((i) => i.done);
  const todo = phase.items.filter((i) => !i.done);
  const total = phase.items.length;

  return `
    <section class="phase">
      <div class="phase-header">
        <h2>${escapeHtml(phase.name)}</h2>
        <span class="phase-progress">${done.length} / ${total} done</span>
      </div>
      ${phase.goal ? `<p class="phase-goal">${inlineMarkdown(phase.goal)}</p>` : ''}
      <div class="phase-columns">
        <div class="column">
          <div class="column-header">To Do <span class="count">${todo.length}</span></div>
          <div class="column-body">
            ${todo.length ? todo.map(renderCard).join('\n') : '<div class="empty">Nothing left here.</div>'}
          </div>
        </div>
        <div class="column">
          <div class="column-header">Done <span class="count">${done.length}</span></div>
          <div class="column-body">
            ${done.length ? done.map(renderCard).join('\n') : '<div class="empty">Nothing done yet.</div>'}
          </div>
        </div>
      </div>
    </section>`;
}

function renderPage(phases) {
  const totalDone = phases.reduce((s, p) => s + p.items.filter((i) => i.done).length, 0);
  const totalItems = phases.reduce((s, p) => s + p.items.length, 0);
  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Axes &amp; Actuaries — Roadmap Board</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f2ec; --panel: #ffffff; --border: #ddd6c8; --ink: #2c1a0e;
    --ink-light: #5c3d20; --accent: #9e7520; --done-bg: #eaf3ea; --done-border: #4a8f4a;
    --todo-bg: #fdfaf3; --todo-border: #ddd6c8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1c1712; --panel: #262019; --border: #3a3226; --ink: #ece4d6;
      --ink-light: #b8a988; --accent: #d4a94a; --done-bg: #1e2b1e; --done-border: #3d6b3d;
      --todo-bg: #2a241b; --todo-border: #3a3226;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.5;
  }
  .page-header { max-width: 1400px; margin: 0 auto 1.5rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
  .subtitle { color: var(--ink-light); font-size: 0.9rem; }
  .overall-progress {
    max-width: 1400px; margin: 0 auto 2rem; background: var(--panel);
    border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem;
  }
  .bar-track { height: 10px; background: var(--todo-bg); border-radius: 5px; overflow: hidden; margin-top: 0.5rem; }
  .bar-fill { height: 100%; background: var(--accent); }
  .phase {
    max-width: 1400px; margin: 0 auto 2rem; background: var(--panel);
    border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 1.5rem;
  }
  .phase-header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .phase-header h2 { margin: 0; font-size: 1.15rem; }
  .phase-progress { font-size: 0.85rem; color: var(--ink-light); white-space: nowrap; }
  .phase-goal { color: var(--ink-light); font-size: 0.88rem; margin: 0.35rem 0 1rem; }
  .phase-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 800px) { .phase-columns { grid-template-columns: 1fr; } }
  .column-header {
    font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--ink-light); margin-bottom: 0.5rem; display: flex; justify-content: space-between;
  }
  .count { color: var(--ink-light); font-weight: 400; }
  .column-body { display: flex; flex-direction: column; gap: 0.5rem; }
  .card {
    border: 1px solid var(--todo-border); background: var(--todo-bg); border-radius: 8px;
    padding: 0.6rem 0.75rem; font-size: 0.88rem;
  }
  .card-done { background: var(--done-bg); border-color: var(--done-border); }
  .card-title { font-weight: 600; cursor: pointer; }
  .card:not(details) .card-title { cursor: default; }
  .card-desc { margin-top: 0.5rem; color: var(--ink-light); font-size: 0.85rem; }
  .card code {
    background: rgba(128,128,128,0.15); padding: 0.05rem 0.3rem; border-radius: 4px;
    font-size: 0.85em;
  }
  .empty { color: var(--ink-light); font-size: 0.85rem; font-style: italic; }
  footer { max-width: 1400px; margin: 2rem auto 0; color: var(--ink-light); font-size: 0.8rem; }
</style>
</head>
<body>
  <div class="page-header">
    <h1>Axes &amp; Actuaries — Roadmap Board</h1>
    <div class="subtitle">Generated from ROADMAP.md — regenerate with <code>pnpm roadmap:board</code>, don't edit this file directly.</div>
  </div>

  <div class="overall-progress">
    <strong>${totalDone} / ${totalItems}</strong> items done across all phases
    <div class="bar-track"><div class="bar-fill" style="width:${totalItems ? Math.round((totalDone / totalItems) * 100) : 0}%"></div></div>
  </div>

  ${phases.map(renderPhase).join('\n')}

  <footer>Generated ${generatedAt}</footer>
</body>
</html>
`;
}

const markdown = fs.readFileSync(roadmapPath, 'utf8');
const phases = parseRoadmap(markdown);
fs.writeFileSync(outputPath, renderPage(phases));
console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${phases.length} phases)`);
