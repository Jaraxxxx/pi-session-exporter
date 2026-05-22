import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type ExportFormat = "markdown" | "plaintext" | "json";

// ---- Helpers ----

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

function trunc(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function safeStr(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function entryToMarkdown(e: any, idx: number): string {
  // Use only safe properties from Pi entries — avoid e.content, e.message (internal AgentMessage)
  const type = e.type || "";
  const role = e.role || "";
  const toolName = e.toolName || e.name || "";
  const input = e.input || e.arguments || null;
  const result = e.result != null ? safeStr(e.result) : "";
  const customType = e.customType || "";
  const metaStr = customType ? ` [${customType}]` : "";

  // Tool call entry
  if (type === "tool_call") {
    const argsStr = typeof input === "string" ? input : input ? JSON.stringify(input, null, 2) : "{}";
    return `\n### 🔧 Tool: \`${toolName || "unknown"}\`${metaStr}\n\n\`\`\`json\n${trunc(argsStr, 500)}\n\`\`\`\n`;
  }

  // Tool result entry
  if (type === "tool_result") {
    const label = toolName || e.toolCallId || "";
    if (result) {
      return `\n<details>\n<summary>📋 Result: \`${label}\`${metaStr}</summary>\n\n\`\`\`\n${trunc(result, 2000)}\n\`\`\`\n\n</details>\n`;
    }
    return `\n<details>\n<summary>📋 Result: \`${label}\`${metaStr}</summary>\n\n_(empty result)_\n\n</details>\n`;
  }

  // System entry
  if (type === "system" || role === "system") {
    return `\n### ⚙️ System\n\n\`\`\`\n${trunc(result || "(system)", 2000)}\n\`\`\`\n`;
  }

  // User message entry
  if (type === "user" || role === "user") {
    return `\n### 👤 You${metaStr}\n\n${result || "(user message)"}\n`;
  }

  // Assistant message entry
  if (type === "assistant" || role === "assistant") {
    return `\n### 🤖 Assistant${metaStr}\n\n${result || "(response)"}\n`;
  }

  // Default: use result or show type
  return `\n### ${type || role || "unknown"}${metaStr}\n\n${trunc(result, 2000)}\n`;
}

// ---- Export logic ----

function safeEntries(ctx: any): any[] {
  try {
    const entries = ctx.sessionManager.getEntries?.() || [];
    // Filter out entries that trigger the internal Pi bug with message.content iteration
    return entries.filter((e: any) => {
      try {
        // Touch key properties to detect broken entries
        void (e.type); void (e.role); void (e.result); void (e.input);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function safeEntryForExport(e: any): any {
  try {
    return {
      type: e.type,
      role: e.role,
      customType: e.customType,
      timestamp: e.timestamp,
      toolName: e.toolName,
      input: e.input,
      result: e.result != null ? safeStr(e.result) : null,
    };
  } catch {
    return { type: "error", role: "unknown" };
  }
}

function exportSession(ctx: any, format: ExportFormat): { path: string; size: number } {
  try {
    return exportSessionImpl(ctx, format);
  } catch (e: any) {
    // Pi has a known bug where session entries with message.content can throw
    // "message.content is not iterable" during serialization. Gracefully degrade.
    const cwd = ctx.sessionManager.getCwd?.() || process.cwd();
    const outDir = join(cwd, ".pi-exports");
    ensureDir(outDir);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
    const body = `# Pi Session Export\n\n> ⚠️ Export partially failed: ${e.message}\n\nPi's internal session entries could not be fully serialized due to an internal bug. Please report this.`;
    const ext = format === "json" ? ".json" : format === "plaintext" ? ".txt" : ".md";
    const filepath = join(outDir, `pi-session-${dateStr}-${timeStr}${ext}`);
    writeFileSync(filepath, body, "utf-8");
    return { path: filepath, size: Buffer.byteLength(body) };
  }
}

function exportSessionImpl(ctx: any, format: ExportFormat): { path: string; size: number } {
  const entries = safeEntries(ctx);
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
      entries: entries.map(safeEntryForExport),
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
      const type = e.type || "unknown";
      if (type === "system") continue;
      const info = safeEntryForExport(e);
      const line = `[${type.toUpperCase()}] ${trunc(String(info.result || info.input || type), 100)}`;
      lines.push(line);
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

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const type = e.type || "";

      if (type === "tool_call") {
        lines.push(entryToMarkdown(e, i));
        // Include the next entry as the tool result
        if (i + 1 < entries.length && entries[i + 1].type === "tool_result") {
          lines.push(entryToMarkdown(entries[i + 1], i + 1));
          i++;
        }
        continue;
      }

      if (type === "tool_result") {
        lines.push(entryToMarkdown(e, i));
        continue;
      }

      lines.push(entryToMarkdown(e, i));
    }

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
  pi.registerCommand({
    name: "export",
    description: "Export session as Markdown (default), plaintext, or JSON",
    async handler(_args: string[], ctx: any) {
      const format = _args[0] === "json" ? "json" : _args[0] === "plaintext" ? "plaintext" : "markdown";
      const result = exportSession(ctx, format);
      ctx.ui.notify(`Exported to ${relative(ctx.cwd, result.path)} (${(result.size / 1024).toFixed(1)}KB)`, "success");
    },
  });

  pi.registerShortcut("e", { ctrl: true }, (_event: any, ctx: any) => {
    if (!ctx.hasUI) return;
    const result = exportSession(ctx, "markdown");
    ctx.ui.notify(`Exported to ${relative(ctx.cwd, result.path)} (${(result.size / 1024).toFixed(1)}KB)`, "success");
  });

  pi.registerTool({
    name: "export_session",
    description: "Export the current session to a Markdown file in .pi-exports/ directory. Use when user asks to save/share the conversation.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["markdown", "plaintext", "json"], description: "Export format. Default is markdown." },
      },
    },
    async execute(_toolCallId: any, args: any, _signal: any, _onUpdate: any, ctx: any) {
      const format = args.format || "markdown";
      const result = exportSession(ctx, format);
      return `Session exported to \`.pi-exports/${relative(ctx.cwd, result.path)}\` (${(result.size / 1024).toFixed(1)}KB, ${safeEntries(ctx).length} entries).`;
    },
  });
}