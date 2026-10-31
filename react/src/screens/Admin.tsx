import { useCallback, useEffect, useState } from "react";
import { useApp } from "../App";
import { DEFAULT_BASE, POLICY_BACKEND_MESSAGE, apiGet, isAllowedBackendUrl } from "../lib/api";
import { BackButton, Badge } from "../lib/ui";

const LOCAL_BASE = "http://localhost:8787";
const TOKEN_KEY = "snapclaim.adminToken";

interface SpendEntry {
  label: string;
  usd: number;
  at: string;
}

interface SpendInfo {
  spentUsd: number;
  remainingUsd: number;
  limitUsd: number;
  entries: SpendEntry[];
}

interface AdminStatus {
  version?: string;
  mockMode?: boolean;
  mockSource?: string;
  mode?: string;
  adminEnabled?: boolean;
  spend?: SpendInfo | null;
  models?: Record<string, string>;
  endpoints?: Record<string, string>;
  minReferenceConfidence?: number;
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function ModeBadge({ mode }: { mode?: string }) {
  if (mode === "live") return <Badge kind="fail">Live</Badge>;
  if (mode === "mock") return <Badge kind="ok">Mock</Badge>;
  if (mode === "config-error") return <Badge kind="fail">Config error</Badge>;
  return <Badge kind="wait">Unknown</Badge>;
}

export default function Admin() {
  const ctx = useApp();
  const { base, setBase, toast } = ctx;
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [token, setToken] = useState(readToken);
  const [tokenSaved, setTokenSaved] = useState(() => readToken() !== "");
  const [urlDraft, setUrlDraft] = useState(base);
  const [legacy, setLegacy] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    setStatusError("");
    const t0 = performance.now();
    try {
      const { res, j } = await apiGet(base, "/v1/admin/status");
      if (res.ok && j.ok) {
        setStatus(((j.result ?? {}) as AdminStatus));
        setLegacy(false);
        setMs(Math.round(performance.now() - t0));
        return;
      }
      if (res.status === 404) {
        // Older backend without the admin route: health + spend still answer.
        const [{ res: hRes, j: h }, { res: sRes, j: s }] = await Promise.all([
          apiGet(base, "/v1/health"),
          apiGet(base, "/v1/spend"),
        ]);
        if (!hRes.ok || !h.ok) throw new Error(h.error ?? `health HTTP ${hRes.status}`);
        setStatus({
          version: String((h as { version?: unknown }).version ?? "?"),
          mode: String((h as { mode?: unknown }).mode ?? "unknown"),
          spend: sRes.ok && s.ok ? ((s.result ?? s) as unknown as SpendInfo) : null,
          adminEnabled: false,
        });
        setLegacy(true);
        setMs(Math.round(performance.now() - t0));
        return;
      }
      throw new Error(j.error ?? `HTTP ${res.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(null);
      setStatusError(msg.includes("security policy") ? msg : `Unreachable — is the backend running at ${base}? (${msg})`);
    } finally {
      setChecking(false);
    }
  }, [base]);

  useEffect(() => {
    setUrlDraft(base);
    void loadStatus();
  }, [base, loadStatus]);

  const applyPreset = (url: string) => {
    if (!isAllowedBackendUrl(url)) {
      toast(POLICY_BACKEND_MESSAGE);
      return;
    }
    setBase(url);
    toast(`Backend → ${url.replace(/^https?:\/\//, "")}`);
  };

  const switchMode = async (body: Record<string, unknown>, label: string) => {
    if (!isAllowedBackendUrl(base)) {
      toast(POLICY_BACKEND_MESSAGE);
      return;
    }
    const saved = readToken();
    if (!saved) {
      toast("Save the admin token first — it lives only in this tab");
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch(`${base}/v1/admin/mode`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${saved}` },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: AdminStatus };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStatus(j.result ?? null);
      toast(label);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(false);
    }
  };

  const saveToken = () => {
    try {
      if (token.trim()) sessionStorage.setItem(TOKEN_KEY, token.trim());
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* private mode: keep it in memory only */ }
    setTokenSaved(token.trim() !== "");
    toast(token.trim() ? "Admin token saved for this tab only" : "Admin token cleared");
  };

  const copyDiagnostics = async () => {
    const payload = JSON.stringify(
      { base, checkedAt: new Date().toISOString(), latencyMs: ms, status },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      toast("Diagnostics copied");
    } catch {
      toast("Copy blocked — select the status manually");
    }
  };

  const spend = status?.spend ?? null;
  const spendPct = spend && spend.limitUsd > 0
    ? Math.min(100, (spend.spentUsd / spend.limitUsd) * 100)
    : 0;
  const live = status?.mode === "live";
  const mockActive = status?.mockMode !== false;

  return (
    <section className="screen on" aria-labelledby="h-admin">
      <div className="wrap">
        <BackButton label="Home" onClick={() => window.location.assign("/")} />
        <h1 id="h-admin">Admin panel.</h1>
        <p className="sub">Mock vs live, backend, and spend — on this device only. Live mode spends real API budget.</p>

        <div className="group">
          <h3>Mode {status && <ModeBadge mode={status.mode} />}</h3>
          <p className="fineprint" style={{ marginTop: 4 }}>
            {checking
              ? "Checking…"
              : status
                ? `Backend v${status.version ?? "?"} · answered in ${ms ?? "?"} ms · source: ${status.mockSource ?? "env"}${legacy ? " · legacy backend (no /v1/admin/status)" : ""}`
                : "Not checked yet."}
          </p>
          {statusError && <p className="fineprint danger-text" role="alert">{statusError}</p>}
          <div className="seg" role="group" aria-label="Backend mode">
            <button
              id="adminMock"
              type="button"
              className={mockActive ? "on" : undefined}
              aria-pressed={mockActive}
              disabled={switching || !status?.adminEnabled}
              onClick={() => void switchMode({ mode: "mock" }, "Mock mode on — $0 spend")}
            >
              Mock · $0
            </button>
            <button
              id="adminLive"
              type="button"
              className={!mockActive ? "on" : undefined}
              aria-pressed={!mockActive}
              disabled={switching || !status?.adminEnabled}
              onClick={() => void switchMode({ mode: "live" }, "Live mode on — spends budget")}
            >
              Live · metered
            </button>
          </div>
          <div className="rowbtns">
            <button
              id="adminReset"
              className="btn-ghostline"
              type="button"
              disabled={switching || !status?.adminEnabled}
              onClick={() => void switchMode({ reset: true }, "Back to the backend's env default")}
            >
              Reset to env default
            </button>
            <button
              id="adminRefresh"
              className="btn-ghostline"
              type="button"
              disabled={checking}
              onClick={() => void loadStatus()}
            >
              Refresh
            </button>
          </div>
          {!status?.adminEnabled && status && !legacy && (
            <p className="fineprint">Runtime switching is off on this backend — set <span className="mono">ADMIN_TOKEN</span> on a local dev server to enable it. Restarting the backend also returns to the env default.</p>
          )}
          {legacy && (
            <p className="fineprint">This backend predates the admin route: switch modes by restarting it with <span className="mono">MOCK_MODE=0</span> (live) or unset (mock), or point the panel at a newer backend.</p>
          )}
          {live && (
            <p className="fineprint danger-text">Live mode calls metered models (findings, skeptic, SAM, voice). Watch the spend meter below.</p>
          )}
        </div>

        <div className="group">
          <h3>Backend</h3>
          <p className="fineprint" style={{ marginTop: 4 }}>{base.replace(/^https?:\/\//, "")}</p>
          <div className="rowbtns">
            <button id="adminProd" className="btn-secondary" type="button" onClick={() => applyPreset(DEFAULT_BASE)}>
              Production
            </button>
            <button id="adminLocal" className="btn-secondary" type="button" onClick={() => applyPreset(LOCAL_BASE)}>
              Local :8787
            </button>
          </div>
          <label className="field" htmlFor="adminUrl">Custom URL (policy: production host or loopback only)</label>
          <input
            id="adminUrl"
            className="text-input"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
          />
          <div className="rowbtns">
            <button id="adminApplyUrl" className="btn-secondary" type="button" onClick={() => applyPreset(urlDraft.trim().replace(/\/$/, ""))}>
              Use this backend
            </button>
          </div>
        </div>

        <div className="group">
          <h3>Spend</h3>
          {spend ? (
            <>
              <p className="fineprint" style={{ marginTop: 4 }}>
                ${spend.spentUsd.toFixed(4)} spent · ${spend.remainingUsd.toFixed(4)} left of ${spend.limitUsd.toFixed(2)}
              </p>
              <div
                className="meter meter-true"
                role="progressbar"
                aria-label="API spend used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(spendPct * 10) / 10}
              >
                <i style={{ width: `${Math.max(spendPct, spend.spentUsd > 0 ? 1.5 : 0)}%` }} />
              </div>
              {spend.entries.length > 0 ? (
                <div className="about-rows" style={{ marginTop: 8 }}>
                  {spend.entries.slice(-8).reverse().map((e, i) => (
                    <span className="about-row" key={i}>
                      <span>{e.label}</span>
                      <b>${Number(e.usd).toFixed(4)}</b>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="fineprint">No charges yet — mock mode stays at $0.</p>
              )}
            </>
          ) : (
            <p className="fineprint">No spend data — check the backend connection above.</p>
          )}
        </div>

        <div className="group">
          <h3>Admin token</h3>
          <p className="fineprint" style={{ marginTop: 4 }}>Saved in session storage (this tab only) — never in cases or local storage. Only set <span className="mono">ADMIN_TOKEN</span> on backends you run yourself; never on the public Worker.</p>
          <label className="field" htmlFor="adminToken">Bearer token</label>
          <input
            id="adminToken"
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={tokenSaved ? "Saved for this tab — paste to replace" : "Paste ADMIN_TOKEN"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="rowbtns">
            <button id="adminSaveToken" className="btn-secondary" type="button" onClick={saveToken}>
              {tokenSaved ? "Replace token" : "Save token"}
            </button>
            <button
              id="adminClearToken"
              className="btn-ghostline"
              type="button"
              onClick={() => {
                try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
                setToken("");
                setTokenSaved(false);
                toast("Admin token cleared");
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {(status?.models || status?.endpoints) && (
          <div className="group">
            <h3>Config</h3>
            <div className="about-rows" style={{ marginTop: 4 }}>
              {status.models && Object.entries(status.models).map(([k, v]) => (
                <span className="about-row" key={k}><span>{k}</span><b>{v}</b></span>
              ))}
              {typeof status.minReferenceConfidence === "number" && (
                <span className="about-row"><span>minReferenceConfidence</span><b>{status.minReferenceConfidence}</b></span>
              )}
              {status.endpoints && Object.entries(status.endpoints).map(([k, v]) => (
                <span className="about-row" key={k}><span>{k}</span><b>{String(v).replace(/^https?:\/\//, "")}</b></span>
              ))}
            </div>
          </div>
        )}

        <div className="group">
          <h3>What changes with the mode</h3>
          <div className="about-rows" style={{ marginTop: 4 }}>
            <span className="about-row"><span>measure · observe · crosscheck</span><b>same</b></span>
            <span className="about-row"><span>segment</span><b>fixture vs SAM 3.1</b></span>
            <span className="about-row"><span>transcribe</span><b>fixture vs voice model</b></span>
            <span className="about-row"><span>findings · report</span><b>mock vs Muse Spark</b></span>
            <span className="about-row"><span>skeptic</span><b>mock vs Spark Open</b></span>
          </div>
          <div className="rowbtns">
            <button id="adminCopy" className="btn-secondary" type="button" onClick={() => void copyDiagnostics()}>
              Copy diagnostics
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
