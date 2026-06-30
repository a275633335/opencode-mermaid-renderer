import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { renderMermaidAscii } from "./vendor/beautiful-mermaid/index.js"
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

// ── Output directory ────────────────────────────────────────────────────
const OUTPUT_DIR = join(homedir(), ".opencode-mermaid-html")

// ── Regex ───────────────────────────────────────────────────────────────
const MERMAID_BLOCK_REGEX = /```mermaid\n([\s\S]*?)```/g

// ── Plugin ──────────────────────────────────────────────────────────────

export const MermaidRenderer: Plugin = async () => {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // One-time: copy mermaid.min.js into output dir from global install
  ensureLocalMermaid()

  return {
    "experimental.text.complete": async (
      _input: { sessionID: string; messageID: string; partID: string },
      output: { text: string }
    ) => {
      try {
        output.text = renderMermaidBlocks(output.text)
      } catch (error) {
        output.text =
          output.text +
          "\n\n<!-- mermaid-renderer: unexpected error - " +
          (error as Error).message +
          " -->"
      }
    },
  } as Hooks
}

// ── Find + cache local mermaid.js ───────────────────────────────────────

let mermaidAvailable = false

function ensureLocalMermaid(): void {
  const dest = join(OUTPUT_DIR, "mermaid.min.js")
  if (existsSync(dest)) {
    mermaidAvailable = true
    return
  }

  const src = findMermaidJs()
  if (src) {
    copyFileSync(src, dest)
    mermaidAvailable = true
  }
  // else: mermaid not installed, HTML will show install instructions
}

function findMermaidJs(): string | null {
  // Use module resolution (works regardless of npm/bun/pnpm, global or local)
  try {
    const entry = import.meta.resolve("mermaid")
    const entryPath = fileURLToPath(entry)
    const distDir = dirname(entryPath) // .../mermaid/dist/
    const minJs = join(distDir, "mermaid.min.js")
    if (existsSync(minJs)) return minJs
  } catch {}

  // Fallback: search known global install paths
  const candidates: string[] = []
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, "npm", "node_modules", "mermaid", "dist", "mermaid.min.js"))
  }
  candidates.push("/usr/local/lib/node_modules/mermaid/dist/mermaid.min.js")
  candidates.push(join(homedir(), "node_modules", "mermaid", "dist", "mermaid.min.js"))
  candidates.push(join(homedir(), ".bun", "install", "global", "node_modules", "mermaid", "dist", "mermaid.min.js"))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

// ── Block processing ────────────────────────────────────────────────────

let blockIndex = 0

function renderMermaidBlocks(text: string): string {
  blockIndex = 0
  return text.replace(MERMAID_BLOCK_REGEX, (_match, mermaidCode: string) => {
    return renderSingleBlock(mermaidCode.trim())
  })
}

function renderSingleBlock(mermaidCode: string): string {
  const parts: string[] = []

  // 1. Terminal ASCII preview
  try {
    const ascii = renderMermaidAscii(mermaidCode)
    parts.push("```\n" + ascii + "\n```")
  } catch (error) {
    const errorMessage = (error as Error).message || "Unknown error"
    parts.push(
      "```mermaid\n" +
      mermaidCode +
      "\n```\n<!-- mermaid render failed: " +
      escapeHtmlComment(errorMessage) +
      " -->"
    )
  }

  // 2. Browser HTML link
  try {
    const htmlPath = writeMermaidHtml(mermaidCode)
    const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/")
    parts.push(`\n📊 [在浏览器中查看此图](${fileUrl})\n`)
  } catch {
    // silent fallback — ASCII already rendered
  }

  return parts.join("\n")
}

// ── HTML generator (fully offline) ──────────────────────────────────────

function writeMermaidHtml(mermaidCode: string): string {
  const timestamp = Date.now()
  const index = blockIndex++
  const filename = `mermaid-${timestamp}-${index}.html`
  const filePath = join(OUTPUT_DIR, filename)

  // Only escape & and < (inside <pre>, > is safe and must stay as-is for mermaid arrows)
  const escapedCode = mermaidCode
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")

  // If mermaid found locally, relative <script> tag; else show setup hint
  const mermaidScript = mermaidAvailable
    ? `\n  <script src="mermaid.min.js"></script>`
    : ""
  const setupHint = mermaidAvailable
    ? ""
    : `<div class="setup-hint">
  <p><strong>需要先安装 mermaid 本地渲染引擎（仅需一次）：</strong></p>
  <pre><code>npm install -g mermaid</code></pre>
  <p>安装后重新生成图表即可，无需网络。</p>
</div>`

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mermaid Diagram</title>${mermaidScript}
<style>
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;justify-content:center;align-items:flex-start;min-height:100vh;padding:24px;background:#fff;color:#1a1a1a;font-family:system-ui,-apple-system,sans-serif}
  .wrap{width:100%;max-width:100%;overflow-x:auto}
  .mermaid{text-align:center}
  .toolbar{position:fixed;top:12px;right:12px;z-index:100;display:flex;gap:8px}
  .toolbar button{padding:6px 14px;border:1px solid #d0d0d0;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:#333}
  .toolbar button:hover{background:#f0f0f0;border-color:#aaa}
  .setup-hint{margin:60px auto;padding:24px 32px;border:2px dashed #ff9800;border-radius:8px;background:#fff8e1;max-width:500px;font-size:15px;line-height:1.8}
  .setup-hint pre{margin:8px 0;padding:8px 12px;background:#263238;color:#aed581;border-radius:4px;font-size:14px}
</style>
</head>
<body>
${setupHint}
<div class="toolbar">
  <button onclick="toggleTheme()" title="切换暗色/亮色主题">🌓 主题</button>
  <button onclick="downloadSVG()" title="下载为 SVG 文件">📥 SVG</button>
</div>
<div class="wrap">
  <pre class="mermaid">
${escapedCode}
  </pre>
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
  if (typeof mermaid === 'undefined') return;
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
  mermaid.run({ querySelector: '.mermaid' });
});

var _dark = false;
function toggleTheme() {
  _dark = !_dark;
  document.body.style.background = _dark ? '#1a1a2e' : '#ffffff';
  document.body.style.color = _dark ? '#e0e0e0' : '#1a1a1a';
  mermaid.initialize({ startOnLoad: false, theme: _dark ? 'dark' : 'default', securityLevel: 'loose' });
  mermaid.run({ querySelector: '.mermaid' });
}
function downloadSVG() {
  var svg = document.querySelector('.mermaid svg');
  if (!svg) { alert('图表尚未渲染完成'); return; }
  var clone = svg.cloneNode(true);
  var box = svg.getBoundingClientRect();
  clone.setAttribute('width', box.width);
  clone.setAttribute('height', box.height);
  var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\\n' + clone.outerHTML], { type: 'image/svg+xml' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mermaid-diagram.svg';
  a.click();
}
</script>
</body>
</html>`

  writeFileSync(filePath, html, "utf-8")
  return filePath
}

function escapeHtmlComment(text: string): string {
  return text.replace(/--/g, "- -").replace(/>/g, "&gt;")
}

export default MermaidRenderer
