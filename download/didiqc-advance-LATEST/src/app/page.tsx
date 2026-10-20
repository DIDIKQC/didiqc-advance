"use client";

/**
 * didiQCsys v9 — Next.js Port
 *
 * This page renders the original Google Apps Script `index.html` verbatim
 * via a full-viewport iframe pointing to /app.html. The iframe approach
 * preserves 100% of the original HTML/CSS/JS without any conversion to JSX.
 *
 * The google.script.run shim injected into /app.html intercepts all backend
 * calls and routes them to /api/rpc, which dispatches to the ported TypeScript
 * backend functions (mirroring code.gs 1:1).
 *
 * NO original code is modified — only wrapped.
 */
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Pre-warm: ping the API to ensure backend is up
    fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: "__ping", args: [] }),
    }).catch(() => {
      /* ignore — backend may still be starting */
    });

    // Safety net: in some sandboxed preview environments the iframe `load`
    // event is swallowed by the outer sandbox wrapper, which would leave the
    // loading overlay visible forever. Hide the overlay after a short delay
    // regardless, so the user always sees the app.
    const t = window.setTimeout(() => setLoaded(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        margin: 0,
        padding: 0,
        background: "#0f172a",
        overflow: "hidden",
      }}
    >
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f1f5f9",
            fontFamily: "Inter, system-ui, sans-serif",
            zIndex: 1,
            flexDirection: "column",
            gap: "16px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              border: "4px solid #1e293b",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <div>Memuat didiQCsys v9...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/app.html"
        title="didiQCsys v9"
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          margin: 0,
          padding: 0,
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
      />
    </main>
  );
}
