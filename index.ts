import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

// ── Paths ───────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const VENDOR_MERMAID = join(__dirname, "vendor", "mermaid.min.js")
const OUTPUT_DIR = join(homedir(), ".opencode-mermaid-html")

// ── Regex ───────────────────────────────────────────────────────────────
const MERMAID_BLOCK_REGEX = /```mermaid\n([\s\S]*?)```/g

// ── Plugin ──────────────────────────────────────────────────────────────

export const MermaidRenderer: Plugin = async () => {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // One-time: copy bundled mermaid.min.js into output dir
  const dest = join(OUTPUT_DIR, "mermaid.min.js")
  if (!existsSync(dest) && existsSync(VENDOR_MERMAID)) {
    copyFileSync(VENDOR_MERMAID, dest)
  }

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

// ── Block processing ────────────────────────────────────────────────────

let blockIndex = 0

function renderMermaidBlocks(text: string): string {
  blockIndex = 0
  return text.replace(MERMAID_BLOCK_REGEX, (_match, mermaidCode: string) => {
    return renderSingleBlock(mermaidCode.trim())
  })
}

function renderSingleBlock(mermaidCode: string): string {
  try {
    const htmlPath = writeMermaidHtml(mermaidCode)
    const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/")
    return `\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n\n📊 [在浏览器中查看此图](${fileUrl})\n`
  } catch (error) {
    const errorMessage = (error as Error).message || "Unknown error"
    return (
      "```mermaid\n" +
      mermaidCode +
      "\n```\n<!-- mermaid render failed: " +
      escapeHtmlComment(errorMessage) +
      " -->"
    )
  }
}

// ── HTML generator ──────────────────────────────────────────────────────

function writeMermaidHtml(mermaidCode: string): string {
  const timestamp = Date.now()
  const index = blockIndex++
  const filename = `mermaid-${timestamp}-${index}.html`
  const filePath = join(OUTPUT_DIR, filename)

  const escapedCode = mermaidCode
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mermaid Diagram</title>
<script src="mermaid.min.js"></script>
<style>
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;justify-content:center;align-items:flex-start;min-height:100vh;padding:24px;background:#fff;color:#1a1a1a;font-family:system-ui,-apple-system,sans-serif}
  .wrap{width:100%;max-width:100%;overflow-x:auto}
  .mermaid{text-align:center}
  .toolbar{position:fixed;top:12px;right:12px;z-index:100;display:flex;gap:8px}
  .toolbar button{padding:6px 14px;border:1px solid #d0d0d0;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:#333}
  .toolbar button:hover{background:#f0f0f0;border-color:#aaa}
</style>
</head>
<body>
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
