"use client";

import { Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { websiteFaviconUrl } from "@/lib/dns/favicon.ts";
import styles from "./dns-diagnostics.module.css";

export function DiagnosticFavicon({ hostname }: { hostname: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const src = websiteFaviconUrl(hostname);
  if (!src || state === "failed") return null;
  return <img alt="" className={`${styles.favicon}${state === "loaded" ? ` ${styles.faviconLoaded}` : ""}`} decoding="async" height="32" onError={() => setState("failed")} onLoad={() => setState("loaded")} referrerPolicy="no-referrer" src={src} width="32" />;
}

export function DiagnosticResultHeader({
  hostname,
  children,
  checkedAt,
  durationMs,
  action,
}: {
  hostname: string;
  children: ReactNode;
  checkedAt?: string;
  durationMs?: number;
  action?: ReactNode;
}) {
  return <header className={styles.resultHeader}>
    <div>
      <div className={styles.resultTitle}><DiagnosticFavicon hostname={hostname} /><h2>{hostname}</h2></div>
      <div className={styles.resultCopy}>{children}</div>
      {checkedAt ? <p className={styles.resultMeta}>Checked {new Date(checkedAt).toLocaleString()}{typeof durationMs === "number" ? ` in ${durationMs.toLocaleString("en-US")} ms` : ""}.</p> : null}
    </div>
    {action ? <div className={styles.resultActions}>{action}</div> : null}
  </header>;
}

export function downloadText(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function diagnosticReportJson(tool: string, result: object) {
  return JSON.stringify({ tool, reportVersion: 1, ...result }, null, 2);
}

export function DownloadResultButton({ filename, contents, type = "application/json;charset=utf-8" }: { filename: string; contents: string; type?: string }) {
  return <button className={styles.downloadButton} onClick={() => downloadText(filename, contents, type)} type="button"><Download aria-hidden="true" size={16} />Download report</button>;
}
