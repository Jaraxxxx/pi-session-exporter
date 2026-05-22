import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type ExportFormat = "markdown" | "plaintext" | "json";
type Entry = any;

// ---- Helpers ----

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

function escapeMd(s: string): string {
  return s.replace(/[*_~`<>|]/g, "\\$&");
}

function trunc(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function formatContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => (typeof c === "string" ? c : c.text ?? "")).join("\n");
  return String(content ?? "");
}

function entryToMarkdown(e: Entry, idx: number): string {
  const role = e.role || "system";
  let content = formatContent(e.content ?? e.message?.content ?? e.result ?? "");
  if (role === "system") content = content.replace(/^<system>/, "").replace(/<\/system>$/, "");

  // Entry-level metadata
  let metaStr = "";
  if (e.customType) metaStr += ` [${e.customType}]`;

  // Tool call
  if (e.type === "tool_call" || role === "tool_call") {
    const name = e.name || e.toolName || e.callID || "unknown";
    const args = e.input || e.arguments || {};
    const argsStr = typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return `\n### 🔧 Tool: \`${name}\`${metaStr}\n\n\`\`\`json\n${trunc(argsStr, 500)}\n\`\`\`\n`;
  }

  // Tool result
  if ((e.type === "tool_result" || role === "tool_result") && content) {
    const name = e.toolName || e.name || "";
    return `\n<details>\n<summary>📋 Result: \`${name}\`${metaStr}</summary>\n\n\`\`\`\n${trunc(content, 1000)}\n\`\`\`\n\n</details>\n`;
  }

  // System
  if (role === "system") {
    return `\n### ⚙️ System\n\n\`\`\`\n${trunc(content, 2000)}\n\`\`\`\n`;
  }

  // User message
  if (role === "user") {
    // Check if it has images
    const images = e.images || e.message?.images;
    const imgTag = images?.length ? ` 🖼️(${images.length})` : "";
    return `\n### 👤 You${metaStr}${imgTag}\n\n${content}\n`;
  }

  // Assistant message
  if (role === "assistant") {
    const thinking = e.thinking || e.message?.thinking;
    let out = `\n### 🤖 Assistant${metaStr}\n\n`;
    if (thinking) out += `<details>\n<summary>🧠 Thinking</summary>\n\n\`\`\`\n${trunc(formatContent(thinking), 2000)}\n\`\`\`\n\n</details>\n\n`;
    out += `${content}\n`;
    return out;
  }

  return `\n### ${role}${metaStr}\n\n${content}\n`;
}

// ---- Export logic ----

function exportSession(ctx: any, format: ExportFormat): { path: string; size: number } {
  const entries: Entry[] = ctx.sessionManager.getEntries() || [];
  const cwd = ctx.sessionManager.getCwd();

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
  const outDir = join(cwd, ".pi-exports");
  ensureDir(outDir);

  let ext = ".md";
  let body = "";

  if (format === "json") {
    ext = ".json";
    const exportData = {
      exportedAt: now.toISOString(),
      cwd,
      sessionName: ctx.sessionManager.getSessionName?.() || null,
      entryCount: entries.length,
      entries: entries.map((e: any) => ({
        role: e.role || e.type,
        content: formatContent(e.content ?? e.message?.content ?? e.result ?? ""),
        customType: e.customType || null,
        timestamp: e.timestamp || null,
      })),
    };
    body = JSON.stringify(exportData, null, 2);
  } else if (format === "plaintext") {
    ext = ".txt";
    const lines: string[] = [];
    lines.push(`# Pi Session Export`);
    lines.push(`# Exported: ${timestamp()}`);
    lines.push(`# CWD: ${cwd}`);
    lines.push("#");
    for (const e of entries) {
      const role = e.role || e.type || "unknown";
      const content = formatContent(e.content ?? e.message?.content ?? e.result ?? "").trim();
      if (role === "system") continue;
      lines.push(`[${role.toUpperCase()}] ${trunc(content.split("\n")[0], 100)}`);
    }
    body = lines.join("\n");
  } else {
    // Markdown
    const lines: string[] = [];
    lines.push(`# Pi Session Export`);
    lines.push("");
    lines.push(`**Exported:** ${timestamp()}  `);
    lines.push(`**Directory:** \`${cwd}\`  `);
    lines.push(`**Session:** ${ctx.sessionManager.getSessionName?.() || "(unnamed)"}  `);
    lines.push(`**Entries:** ${entries.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    let lastRole = "";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const role = e.role || e.type || "";

      // Group consecutive tool results under tool calls
      if (role === "tool_call" || e.type === "tool_call") {
        // Write the preceding assistant message if it exists
        lines.push(entryToMarkdown(e, i));
        // Look ahead and add the tool result immediately
        if (i + 1 < entries.length) {
          const next = entries[i + 1];
          const nextRole = next.role || next.type || "";
          if (nextRole === "tool_result" || next.type === "tool_result") {
            lines.push(entryToMarkdown(next, i + 1));
            i++;
          }
        }
        lastRole = "tool";
        continue;
      }

      // Skip standalone tool results (already handled above)
      if (role === "tool_result" || e.type === "tool_result") {
        lines.push(entryToMarkdown(e, i));
        continue;
      }

      lines.push(entryToMarkdown(e, i));
      lastRole = role;
    }

    // Footer
    lines.push("");
    lines.push("---");
    lines.push(`_Generated by [pi-session-exporter](https://github.com/Jaraxxxx/pi-session-exporter)_`);

    body = lines.join("\n");
  }

  const filename = `pi-session-${dateStr}-${timeStr}${ext}`;
  const filepath = join(outDir, filename);
  writeFileSync(filepath, body, "utf-8");
  const size = statSync(filepath).size;

  return { path: filepath, size };
}

// ---- Extension ----

export default function (pi: ExtensionAPI) {
  // /export command — export in Markdown
  pi.registerCommand({
    name: "export",
    description: "Export session as Markdown (default), plaintext, or JSON",
    async handler(_args: string[], ctx: any) {
      const format = _args[0] === "json" ? "json" : _args[0] === "plaintext" ? "plaintext" : "markdown";
      const result = exportSession(ctx, format);
      ctx.ui.notify(`Exported to ${relative(ctx.cwd, result.path)} (${(result.size / 1024).toFixed(1)}KB)`, "success");
    },
  });

  // Shortcut: Ctrl+E to export
  pi.registerShortcut("e", { ctrl: true }, (_event: any, ctx: any) => {
    if (!ctx.hasUI) return;
    const result = exportSession(ctx, "markdown");
    ctx.ui.notify(`Exported to ${relative(ctx.cwd, result.path)} (${(result.size / 1024).toFixed(1)}KB)`, "success");
  });

  // LLM-callable tool
  pi.registerTool({
    name: "export_session",
    description: "Export the current session to a Markdown file in .pi-exports/ directory. Use when user asks to save/share the conversation.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["markdown", "plaintext", "json"],
          description: "Export format. Default is markdown.",
        },
      },
    },
    async handler(args: any, ctx: any) {
      const format = args.format || "markdown";
      const result = exportSession(ctx, format);
      return `Session exported to \`.pi-exports/${relative(ctx.cwd, result.path)}\` (${(result.size / 1024).toFixed(1)}KB, ${ctx.sessionManager.getEntries().length} entries).`;
    },
  });
}