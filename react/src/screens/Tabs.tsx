import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useApp } from "../App";
import { loadSample } from "../lib/sample";
import { DEFAULT_BASE, DEFAULT_BACKEND_HOST, POLICY_BACKEND_MESSAGE, apiGet } from "../lib/api";
import type { SnapCase } from "../lib/store";
import { Badge, downloadFile } from "../lib/ui";

function formatSize(c: SnapCase): string {
  const parts: string[] = [];
  if (typeof c.crackLengthMm === "number") parts.push(`${String(c.crackLengthMm)} mm long`);
  if (typeof c.areaCm2 === "number") parts.push(`${String(c.areaCm2)} cm²`);
  if (!parts.length && typeof c.percent === "number") parts.push(`${String(c.percent)}% of surface`);
  if (!parts.length && c.mode === "percent-only") parts.push("Percent only · no scale");
  return parts.join(" · ") || "Not measured yet";
}

function isSafePhoto(src: unknown): src is string {
  return typeof src === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(src);
}

function CaseItem({ c, onOpen }: { c: SnapCase; onOpen: (id: string) => void }) {
  const when = new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const done = Boolean(c.severity ?? c.label);
  return (
    <button type="button" className="casecard" onClick={() => onOpen(c.id)}>
      {isSafePhoto(c.photo)
        ? <img className="case-thumb" alt="" src={c.photo} />
        : (
          <span className="case-thumb case-thumb--ph" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></svg>
          </span>
        )}
      <span className="case-main">
        <b className="case-title">{c.name ?? "Untitled case"}</b>
        <small className="case-size">{formatSize(c)}</small>
        <small className="case-date">{when}</small>
      </span>
      <span className="case-side">
        <Badge kind={done ? "ok" : "wait"}>{done ? "Complete" : "Draft"}</Badge>
        <svg className="case-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </span>
    </button>
  );
}

function StatusPill({ online }: { online: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="status-wrap" id="netPill">
      <button
        type="button"
        className={`status-pill ${online ? "is-on" : "is-off"}`}
        aria-expanded={open}
        title="Cases stay on this device. Saved cases and capture work offline; measuring needs a connection. On-device outlining and voice need one online load first to download their models."
        onClick={() => setOpen((v) => !v)}
      >
        <i className="status-dot" aria-hidden="true" />
        {online ? "Saved on device" : "Offline · saved on device"}
      </button>
      {open && (
        <span className="status-tip" role="status">
          Cases never leave this phone. Saved cases and capture work offline; measuring needs a connection. On-device outlining and voice need one online load first to download their models.
        </span>
      )}
    </span>
  );
}

export function Home() {
  const ctx = useApp();
  const { store, casesVersion, startCapture, online, go } = ctx;
  const cases = store.list();
  void casesVersion;
  const [sampleErr, setSampleErr] = useState("");
  const recent = cases.slice(0, 3);
  return (
    <section className="screen tab on home" aria-labelledby="h-home">
      <div className="wrap home-wrap">
        <header className="home-top">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="12" cy="13.5" r="3.4" /><circle cx="12" cy="13.5" r="0.6" fill="currentColor" /><path d="M8.5 7l1-2.2h5L15.5 7" /></svg>
            </span>
            <span className="brand-name">SnapClaim</span>
          </span>
          <StatusPill online={online} />
        </header>
        <h1 id="h-home">Damage, measured.</h1>
        <p className="sub home-sub">Coin for scale, photo for proof — a report in minutes.</p>

        <button id="ctaNew" className="hero-tap" type="button" onClick={startCapture} aria-describedby="heroSteps">
          <span className="hero-art" aria-hidden="true">
            <img className="hero-photo" src="./hero-crack.jpg" alt="" />
            <span className="hero-corners"><i className="hc tl" /><i className="hc tr" /><i className="hc bl" /><i className="hc br" /></span>
            <span className="hero-frame-tag">Damage + coin in frame</span>
          </span>
          <span className="hero-body">
            <span className="hero-title">Start a new claim
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
            <span className="hero-desc">Take a photo with a coin beside the damage.</span>
            <span className="hero-steps" id="heroSteps">
              <span><b aria-hidden="true">1</b> Place coin</span>
              <span><b aria-hidden="true">2</b> Frame damage</span>
              <span><b aria-hidden="true">3</b> Add one line</span>
            </span>
            <span className="hero-cta">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></svg>
              Take a photo
            </span>
          </span>
        </button>
        <div className="sample-row">
          <button
            id="ctaSample"
            className="link-btn"
            type="button"
            onClick={async () => {
              try {
                await loadSample(ctx.base, ctx.session);
                ctx.go("sSay");
              } catch (e) {
                setSampleErr(`Sample failed (${e instanceof Error ? e.message : String(e)}). Is the backend reachable?`);
              }
            }}
          >
            Try a sample instead
          </button>
        </div>
        {sampleErr && <p role="alert" className="sample-err">{sampleErr}</p>}

        <div className="home-duo">
          <div className="tipcard">
            <p className="tipcard-title">Coin tips</p>
            <ul>
              <li>Lay the coin flat, touching the damage</li>
              <li>Keep coin + damage sharp, fill the frame</li>
              <li>Flat light — no flash glare</li>
            </ul>
          </div>
          <details className="how">
            <summary>How accuracy works</summary>
            <p>The coin sets the millimetres. Tilt is corrected from its ellipse — no coin, percent-only report.</p>
          </details>
        </div>

        <div className="recent-head">
          <h2>Recent cases</h2>
          {cases.length > 3 && (
            <button type="button" className="link-btn" onClick={() => go("tCases")}>
              View all ({cases.length})
            </button>
          )}
        </div>
        {recent.length > 0 && (
          <div id="recentList" className="recent-list">
            {recent.map((c) => (
              <CaseItem key={c.id} c={c} onOpen={() => go("tCases")} />
            ))}
          </div>
        )}
        {cases.length === 0 && (
          <div id="recentEmpty" className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></svg>
            </span>
            <p className="empty-title">No cases yet</p>
            <p className="empty-sub">Your first measured report will land here — photo, size, and status at a glance.</p>
            <button type="button" className="btn-primary empty-cta" onClick={startCapture}>Start your first claim</button>
          </div>
        )}
      </div>
    </section>
  );
}

export function Cases() {
  const ctx = useApp();
  const { store, casesVersion, bumpCases, toast } = ctx;
  const cases = store.list();
  void casesVersion;
  const dlgRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dlgId, setDlgId] = useState<string | null>(null);
  const dlg = dlgId ? store.get(dlgId) : null;
  const [name, setName] = useState("");
  const [prop, setProp] = useState("");
  const [notes, setNotes] = useState("");

  const openCase = (id: string) => {
    const c = store.get(id);
    if (!c) return;
    setDlgId(id);
    setName(c.name ?? "");
    setProp(c.property ?? "");
    setNotes(c.notes ?? "");
    dlgRef.current?.showModal();
  };

  return (
    <section className="screen tab on" aria-labelledby="h-cases">
      <div className="wrap">
        <h1 id="h-cases" style={{ fontSize: 32 }}>Cases</h1>
        <p className="sub">Saved on this device only. Export before deleting — there is no cloud copy.</p>
        <div id="caseList">
          {cases.map((c) => (
            <CaseItem key={c.id} c={c} onOpen={openCase} />
          ))}
        </div>
        {cases.length === 0 && <div id="caseEmpty" className="empty">No cases saved yet.</div>}
      </div>

      <dialog id="caseDlg" ref={dlgRef} aria-labelledby="h-case">
        <h2 id="h-case" style={{ fontSize: 20, marginBottom: 12 }}>Case</h2>
        <label className="field">Name<input id="dlgName" type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Property<input id="dlgProp" type="text" placeholder="e.g. Flat 4B, MG Road" value={prop} onChange={(e) => setProp(e.target.value)} /></label>
        <label className="field">Notes<textarea id="dlgNotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div id="dlgPhotos" style={{ marginBottom: 12 }}>
          {isSafePhoto(dlg?.photo) ? (
            <img src={dlg.photo as string} alt="Case photo" />
          ) : (
            <div className="empty">{dlg?.photoDropped ? "Photo was dropped to fit device storage." : "No photo saved for this case."}</div>
          )}
        </div>
        <div className="rowbtns">
          <button id="dlgAddPhoto" className="btn-ghostline" type="button" onClick={() => fileRef.current?.click()}>Replace photo</button>
          <input
            id="dlgFile"
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !dlgId) return;
              const url = URL.createObjectURL(file);
              const img = new Image();
              img.onload = () => {
                URL.revokeObjectURL(url);
                const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
                const cap = document.createElement("canvas");
                cap.width = Math.round(img.width * side);
                cap.height = Math.round(img.height * side);
                cap.getContext("2d")?.drawImage(img, 0, 0, cap.width, cap.height);
                const saved = store.save({ id: dlgId, photo: cap.toDataURL("image/jpeg", 0.85), photoDropped: false });
                bumpCases();
                toast(saved.photoDropped ? "Photo too large for device storage — case kept without it" : "Photo updated");
              };
              img.src = url;
            }}
          />
        </div>
        <div className="rowbtns">
          <button
            id="dlgSave"
            className="btn-primary"
            type="button"
            onClick={() => {
              if (!dlgId) return;
              store.save({ id: dlgId, name: name.trim() || "Untitled case", property: prop.trim(), notes: notes.trim() });
              bumpCases();
              toast("Case saved on this device");
            }}
          >
            Save
          </button>
          <button
            id="dlgExport"
            className="btn-ghostline"
            type="button"
            onClick={() => {
              const c = dlgId ? store.get(dlgId) : null;
              if (c) downloadFile(`snapclaim-case-${c.id}.json`, JSON.stringify(c, null, 2));
            }}
          >
            Export
          </button>
        </div>
        <div className="rowbtns">
          <button
            id="dlgDelete"
            className="btn-ghostline"
            type="button"
            onClick={() => {
              if (!dlgId || !confirm("Delete this case? This cannot be undone.")) return;
              store.remove(dlgId);
              setDlgId(null);
              dlgRef.current?.close();
              bumpCases();
              toast("Case deleted");
            }}
          >
            Delete case
          </button>
          <button id="dlgClose" className="btn-ghostline" type="button" onClick={() => dlgRef.current?.close()}>Close</button>
        </div>
      </dialog>
    </section>
  );
}

const APP_VERSION = "0.3.0";
const FALLBACK_QUOTA = 2 * 1024 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1048576) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtQuota(n: number): string {
  if (n >= 1073741824) return `of ${Math.round(n / 1073741824)} GB`;
  return `of ~${Math.round(n / 1048576)} MB`;
}

function validBackendUrl(v: string): string {
  const t = v.trim().replace(/\/$/, "");
  if (!t) return "Enter a backend URL.";
  if (!/^https?:\/\//i.test(t)) return "URL must start with https:// (or http:// for localhost).";
  try {
    const u = new URL(t);
    if (u.username !== "" || u.password !== "") return POLICY_BACKEND_MESSAGE;
    if (u.protocol === "https:") {
      if (u.hostname.toLowerCase() !== DEFAULT_BACKEND_HOST) return POLICY_BACKEND_MESSAGE;
      return "";
    }
    if (u.protocol === "http:") {
      const h = u.hostname.toLowerCase();
      if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1" && !h.endsWith(".localhost")) {
        return POLICY_BACKEND_MESSAGE;
      }
      return "";
    }
    return POLICY_BACKEND_MESSAGE;
  } catch {
    return "That URL does not parse — check for typos.";
  }
}

function Section({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={label}>
      <p className="set-label">
        <span className="set-label-icon" aria-hidden="true">{icon}</span>
        {label}
      </p>
      <div className="set-card">{children}</div>
    </section>
  );
}

type BackendState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; ms: number; version: string }
  | { kind: "error"; detail: string };

export function Settings() {
  const ctx = useApp();
  const { store, casesVersion, bumpCases, toast, base, setBase, checkForUpdates, swUpdateReady, applyUpdate, go } = ctx;
  const cases = store.list();
  void casesVersion;
  const [theme, setTheme] = useState(() => String(store.getSettings().theme ?? document.documentElement.dataset.theme ?? "auto"));
  const [donate, setDonate] = useState(() => {
    try { return !!localStorage.getItem("snapclaim.donatePhoto"); } catch { return false; }
  });
  const [bytes, setBytes] = useState(0);
  const [quota, setQuota] = useState<number | null>(null);
  const [backend, setBackend] = useState<BackendState>({ kind: "idle" });
  const [urlDraft, setUrlDraft] = useState(base);
  const [urlError, setUrlError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [lastChecked, setLastChecked] = useState(() => String(store.getSettings().updatesCheckedAt ?? ""));
  const [updating, setUpdating] = useState(false);
  const [installed] = useState(() => {
    try {
      return window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    } catch { return false; }
  });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    let live = true;
    (async () => {
      const b = store.bytesUsed();
      let q: number | null = null;
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.quota) q = est.quota;
      } catch { /* estimate is advisory */ }
      if (!live) return;
      setBytes(b);
      setQuota(q);
    })();
    return () => { live = false; };
  }, [store, casesVersion]);

  const applyTheme = (v: string) => {
    store.setSettings({ theme: v });
    document.documentElement.dataset.theme = v;
    setTheme(v);
    toast(v === "auto" ? "Theme follows your system" : `Theme: ${v}`);
  };

  const setDonatePref = (v: boolean) => {
    setDonate(v);
    try {
      if (v) localStorage.setItem("snapclaim.donatePhoto", "1");
      else localStorage.removeItem("snapclaim.donatePhoto");
    } catch { /* ignore */ }
    toast(v ? "Photo sharing on — only with your tap" : "Photo sharing off");
  };

  const runBackendCheck = async () => {
    const err = validBackendUrl(urlDraft);
    setUrlError(err);
    if (err) return;
    const clean = urlDraft.trim().replace(/\/$/, "");
    if (clean !== base) setBase(clean);
    setBackend({ kind: "checking" });
    const t0 = performance.now();
    try {
      const { j } = await apiGet(clean, "/v1/health");
      const ms = Math.round(performance.now() - t0);
      setBackend({ kind: "ok", ms, version: `v${String(j.version ?? "?")} · ${String(j.mode ?? "live")}` });
      toast("Backend connected");
    } catch {
      setBackend({ kind: "error", detail: "Unreachable — check the URL and your connection." });
    }
  };

  const runUpdateCheck = async () => {
    setUpdating(true);
    try {
      await checkForUpdates();
    } finally {
      const at = new Date().toISOString();
      store.setSettings({ updatesCheckedAt: at });
      setLastChecked(at);
      setUpdating(false);
    }
  };

  const confirmDeleteAll = () => {
    if (deleteText.trim().toUpperCase() !== "DELETE") return;
    store.clear();
    bumpCases();
    setSheetOpen(false);
    setDeleteText("");
    toast("All cases deleted");
  };

  const pct = quota ? Math.min(100, (bytes / quota) * 100) : Math.min(100, (bytes / FALLBACK_QUOTA) * 100);
  const quotaLabel = quota ? fmtQuota(quota) : "of 2 GB";
  const checkedLabel = lastChecked
    ? new Date(lastChecked).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";
  const themeIdx = theme === "light" ? 0 : theme === "dark" ? 2 : 1;

  return (
    <section className="screen tab on settings" aria-labelledby="h-settings">
      <div className="wrap settings-wrap">
        <div className="settings-head">
          <h1 id="h-settings">Settings</h1>
        </div>

        <Section
          label="Appearance"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>}
        >
          <div
            className="theme-seg"
            role="radiogroup"
            aria-label="Appearance"
            style={{ "--seg-idx": themeIdx } as CSSProperties}
          >
            <span className="theme-seg-pill" aria-hidden="true" />
            <button id="sc-theme-light" type="button" role="radio" aria-checked={theme === "light"} className={theme === "light" ? "on" : undefined} onClick={() => applyTheme("light")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              Light
            </button>
            <button id="sc-theme-auto" type="button" role="radio" aria-checked={theme === "auto"} className={theme === "auto" ? "on" : undefined} onClick={() => applyTheme("auto")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" opacity=".45" /></svg>
              Auto
            </button>
            <button id="sc-theme-dark" type="button" role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "on" : undefined} onClick={() => applyTheme("dark")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z" /></svg>
              Dark
            </button>
          </div>
        </Section>

        <Section
          label="Privacy"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z" /><path d="M9.5 12l2 2 3.5-4" /></svg>}
        >
          <div className="privacy-row">
            <span className="privacy-text">
              <b>Share photos to improve measurements</b>
              <small>Off by default. Nothing uploads without your tap.</small>
            </span>
            <button
              id="donateSetting"
              type="button"
              role="switch"
              aria-checked={donate}
              aria-label="Share photos to improve measurements"
              className={`switch${donate ? " on" : ""}`}
              onClick={() => setDonatePref(!donate)}
            >
              <span className="switch-knob" aria-hidden="true" />
            </button>
          </div>
          <details className="learn">
            <summary>Learn what&apos;s shared</summary>
            <p>Only the photos you explicitly attach — never your whole library. Shared photos train damage measurement; names, notes and locations stay on this device and can be stripped before upload.</p>
          </details>
        </Section>

        {!installed && (
          <Section
            label="Install"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>}
          >
            <p className="install-copy" id="installHint">
              {isIos
                ? "On iPhone: Share → Add to Home Screen. Installed apps keep their data; Safari may evict uninstalled sites."
                : "Install SnapClaim from your browser menu (Install app / Add to Home screen) so cases survive storage cleanup."}
            </p>
          </Section>
        )}

        <Section
          label="Storage"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>}
        >
          <p className="storage-line" id="storeInfo">
            {cases.length} case{cases.length === 1 ? "" : "s"} · {fmtBytes(bytes)} {quotaLabel} used
          </p>
          <div
            className="meter meter-true"
            role="progressbar"
            aria-label="Device storage used by SnapClaim"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 10) / 10}
            aria-valuetext={`${fmtBytes(bytes)} ${quotaLabel} used`}
          >
            <i id="sc-store-meter" style={{ width: `${Math.max(pct, bytes > 0 ? 1.5 : 0)}%` }} />
          </div>
          <p className="fineprint">Saved cases and capture work offline; measuring and reports need a connection. Tapping damage sends the photo to the backend for outlining (falls back to on-device once its model has downloaded); cross-check and report attach also upload. First use contacts Google Fonts, jsDelivr and Hugging Face for fonts and on-device models.</p>
        </Section>

        <Section
          label="Data"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>}
        >
          <button
            id="exportAllBtn"
            className="btn-secondary"
            type="button"
            disabled={!cases.length}
            onClick={() => {
              if (!cases.length) { toast("No cases to export"); return; }
              downloadFile("snapclaim-cases.json", store.exportAll());
              toast("Export ready");
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
            Export all cases
          </button>
          <button
            id="wipeBtn"
            className="danger-row"
            type="button"
            disabled={!cases.length}
            onClick={() => { setDeleteText(""); setSheetOpen(true); }}
          >
            <span className="danger-text">
              <b>Delete all cases</b>
              <small>Danger zone · irreversible, no cloud copy</small>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
          </button>
        </Section>

        <Section
          label="Connection"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /></svg>}
        >
          <div className="conn-row">
            <span className="conn-text">
              <b>Backend</b>
              <small>{base.replace(/^https?:\/\//, "")}</small>
            </span>
            {backend.kind === "idle" && <span className="conn-chip idle">Not checked</span>}
            {backend.kind === "checking" && <span className="conn-chip checking">Checking…</span>}
            {backend.kind === "ok" && <span className="conn-chip ok">Connected · {backend.ms} ms</span>}
            {backend.kind === "error" && (
              <button type="button" className="conn-chip err" onClick={() => void runBackendCheck()}>Retry</button>
            )}
          </div>
          {backend.kind === "ok" && <p className="fineprint mono" role="status">{backend.version}</p>}
          {backend.kind === "error" && <p className="fineprint danger-text" role="alert">{backend.detail}</p>}
          <details className="learn advanced">
            <summary>Advanced</summary>
            <label className="field" htmlFor="baseUrl2">Backend URL</label>
            <input
              id="baseUrl2"
              className="text-input"
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              value={urlDraft}
              onChange={(e) => { setUrlDraft(e.target.value); if (urlError) setUrlError(validBackendUrl(e.target.value)); }}
              onBlur={() => setUrlError(validBackendUrl(urlDraft))}
            />
            {urlError && <p className="fineprint danger-text" role="alert">{urlError}</p>}
            <div className="rowbtns">
              <button type="button" className="btn-secondary" onClick={() => { setUrlDraft(DEFAULT_BASE); setUrlError(""); }}>Reset to default</button>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    if (t) { setUrlDraft(t.trim()); setUrlError(""); }
                  } catch { toast("Clipboard blocked — paste manually"); }
                }}
              >
                Paste
              </button>
            </div>
            <button id="setCheck" className="btn-secondary" type="button" onClick={() => void runBackendCheck()}>
              Check backend
            </button>
            <span id="setHealth" className="sr-only" role="status">
              {backend.kind === "ok" ? `Connected in ${backend.ms} milliseconds, ${backend.version}` : backend.kind === "error" ? backend.detail : ""}
            </span>
          </details>
        </Section>

        <Section
          label="Developer"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 5l-2 14" /></svg>}
        >
          <button
            id="openAdminBtn"
            className="btn-secondary"
            type="button"
            onClick={() => window.location.assign("/admin")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h9M19 8h1M4 16h3M13 16h7" /><circle cx="16" cy="8" r="2.2" /><circle cx="10" cy="16" r="2.2" /></svg>
            Open admin panel
          </button>
          <p className="fineprint">Mock vs live switch, backend presets, spend meter, and diagnostics — one screen.</p>
        </Section>

        <Section
          label="Updates"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v5h-5" /></svg>}
        >
          <div className="conn-row">
            <span className="conn-text">
              <b>SnapClaim {APP_VERSION}</b>
              <small>Last checked: {checkedLabel}</small>
            </span>
            {updating
              ? <span className="conn-chip checking">Updating…</span>
              : swUpdateReady
                ? <span className="conn-chip warn">Update available</span>
                : <span className="conn-chip ok">Up to date</span>}
          </div>
          <div className="rowbtns">
            <button id="updateBtn" className="btn-secondary" type="button" onClick={() => void runUpdateCheck()}>
              Check for updates
            </button>
            {swUpdateReady && (
              <button className="btn-primary" type="button" onClick={applyUpdate}>Reload</button>
            )}
          </div>
        </Section>

        <Section
          label="About"
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /></svg>}
        >
          <div className="about-rows">
            <span className="about-row"><span>Version</span><b>{APP_VERSION}</b></span>
            <details className="learn about-detail">
              <summary>Privacy policy</summary>
              <p>Tapping damage sends the photo to the backend for outlining (falls back to on-device). Optional cross-checks send the tapped photo again to the backend you configure. Sharing for measurement improvement is off by default and per-photo.</p>
            </details>
            <details className="learn about-detail">
              <summary>Licenses</summary>
              <p>SnapClaim · Apache-2.0. On-device models (SlimSAM, Whisper) ship under their own licenses — see the model cards on first download.</p>
            </details>
            <a className="about-row about-link" href="mailto:feedback@snapclaim.app?subject=SnapClaim%20feedback">
              <span>Send feedback</span><b aria-hidden="true">→</b>
            </a>
          </div>
        </Section>
      </div>

      {sheetOpen && (
        <div className="sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div
            className="sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sheetTitle"
            aria-describedby="sheetDesc"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="sheet-title" id="sheetTitle">Delete all {cases.length} case{cases.length === 1 ? "" : "s"}?</p>
            <p className="sheet-desc" id="sheetDesc">
              This is permanent — there is no cloud copy. Export first so you keep a backup.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (!cases.length) return;
                downloadFile("snapclaim-cases.json", store.exportAll());
                toast("Export ready — now confirm to delete");
              }}
            >
              Export first
            </button>
            <label className="field" htmlFor="deleteConfirm">Type DELETE to confirm</label>
            <input
              id="deleteConfirm"
              className="text-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="DELETE"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
            />
            <div className="rowbtns">
              <button type="button" className="btn-secondary" onClick={() => setSheetOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleteText.trim().toUpperCase() !== "DELETE"}
                onClick={confirmDeleteAll}
              >
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
