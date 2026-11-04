import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { DEFAULT_BASE, POLICY_BACKEND_MESSAGE, isAllowedBackendUrl } from "./lib/api";
import {
  applyDraft, clearDraft, collectDraft, draftSummary, loadDraft, saveDraft, type DraftSummary,
} from "./lib/draft";
import { SamClient } from "./lib/sam";
import { createSession, resetDmg, type Session } from "./lib/session";
import { appStore, type CaseStore } from "./lib/store";
import Capture from "./screens/Capture";
import Mark from "./screens/Mark";
import Say from "./screens/Say";
import Numbers from "./screens/Numbers";
import Check from "./screens/Check";
import Report from "./screens/Report";
import Admin from "./screens/Admin";
import Shared from "./screens/Shared";
import { decodeShareHash, type SharedReport } from "./lib/share";
import { Home, Cases, Settings } from "./screens/Tabs";
import Onboarding, { useOnboardingGate } from "./screens/Onboarding";

export type Screen =
  | "tHome" | "tCases" | "tSettings" | "tAdmin"
  | "capture" | "sReview" | "sMark" | "sSay" | "sNum" | "sCheck" | "sReport" | "sShared";

export type CheckPhase = "idle" | "loading" | "ok" | "error";

export interface AppCtx {
  session: Session;
  store: CaseStore;
  base: string;
  setBase(url: string): void;
  screen: Screen;
  go(s: Screen): void;
  startCapture(): void;
  toast(msg: string): void;
  casesVersion: number;
  bumpCases(): void;
  sam: SamClient;
  embeddings: { current: boolean };
  measuring: boolean;
  setMeasuring(v: boolean): void;
  numError: { title: string; detail: string } | null;
  setNumError(e: { title: string; detail: string } | null): void;
  measureRef: { current: (() => void) | null };
  checks: { skeptic: CheckPhase; xcheck: CheckPhase };
  setChecks(c: React.SetStateAction<{ skeptic: CheckPhase; xcheck: CheckPhase }>): void;
  swUpdateReady: boolean;
  checkForUpdates(): Promise<void>;
  applyUpdate(): void;
  online: boolean;
  /** Newest autosaved in-progress claim, if any (Home resume banner). */
  draft: DraftSummary | null;
  resumeDraft(): void;
  discardDraft(): void;
  clearDraft(): void;
  /** Re-open first-run onboarding from Settings / How it works. */
  replayOnboarding(): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

const TAB_SCREENS: Screen[] = ["tHome", "tCases", "tSettings"];

export default function App() {
  const store = useMemo(appStore, []);
  const sessionRef = useRef<Session>(createSession());
  const samRef = useRef<SamClient>(new SamClient());
  const embeddings = useRef(false);
  const measureRef = useRef<(() => void) | null>(null);
  const waitingSw = useRef<ServiceWorker | null>(null);
  const swReg = useRef<ServiceWorkerRegistration | null>(null);
  const reloading = useRef(false);
  const measuringRef = useRef(false);

  /* a finished or abandoned claim unblocks a pending update */
  const sharedRef = useRef<SharedReport | null>(null);
  const [screen, setScreen] = useState<Screen>(() => {
    if (window.location.pathname.startsWith("/admin")) return "tAdmin";
    // A landlord link carries the whole report in `#/s/...` - open the
    // read-only view straight away; garbage hashes fall through to home.
    try {
      const shared = decodeShareHash(window.location.hash);
      if (shared) {
        sharedRef.current = shared;
        return "sShared";
      }
    } catch { /* fall through to home */ }
    return "tHome";
  });
  const [base, setBaseState] = useState<string>(() => {
    const saved = String(store.getSettings().baseUrl ?? DEFAULT_BASE);
    return isAllowedBackendUrl(saved) ? saved : DEFAULT_BASE;
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [casesVersion, setCasesVersion] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [numError, setNumError] = useState<AppCtx["numError"]>(null);
  const [checks, setChecks] = useState<AppCtx["checks"]>({ skeptic: "idle", xcheck: "idle" });
  const [updateReady, setUpdateReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const setBase = useCallback((url: string) => {
    if (!isAllowedBackendUrl(url)) {
      toast(POLICY_BACKEND_MESSAGE);
      return;
    }
    setBaseState(url.trim().replace(/\/$/, ""));
    store.setSettings({ baseUrl: url.trim().replace(/\/$/, "") });
  }, [store, toast]);

  const [stepLoading, setStepLoading] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Draft: autosave the in-progress claim on every step change and when the
     page hides, so a reload or crash never wastes progress. Finished or
     abandoned claims clear it (see startCapture / Report save). */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [draft, setDraft] = useState<DraftSummary | null>(() => {
    try {
      const d = loadDraft(localStorage);
      return d ? draftSummary(d) : null;
    } catch {
      return null;
    }
  });
  const persistDraft = useCallback((forScreen: string) => {
    try {
      const d = collectDraft(sessionRef.current, forScreen);
      if (d) {
        if (saveDraft(localStorage, d)) setDraft(draftSummary(d));
      }
    } catch { /* autosave is best-effort; the claim continues */ }
  }, []);

  /* Deferred step-change save: collectDraft serializes full photo data URLs
     (stills + location + payload overlays). That must never run between the
     tap and first paint: even requestAnimationFrame + setTimeout(0) usually
     fires pre-paint in the same frame, which is exactly the loader-then-page
     flash. requestIdleCallback runs when the browser is idle (post-paint);
     the double-rAF fallback paints first, then saves. Crash coverage stays
     synchronous via the pagehide/visibilitychange handlers below. */
  const persistDraftSoon = useCallback((forScreen: string) => {
    const save = () => persistDraft(forScreen);
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === "function") {
      ric.call(window, save, { timeout: 2000 });
    } else {
      requestAnimationFrame(() => requestAnimationFrame(save));
    }
  }, [persistDraft]);

  /* Slow-transition cover only: instant screens render with no flash. The
     loader appears only when a screen takes longer than 250 ms to settle,
     then clears itself - rapid taps never stack it. */
  const go = useCallback((s: Screen) => {
    setScreen(s);
    setStepLoading(false);
    if (stepTimer.current) clearTimeout(stepTimer.current);
    if (stepHideTimer.current) clearTimeout(stepHideTimer.current);
    stepTimer.current = setTimeout(() => {
      setStepLoading(true);
      stepHideTimer.current = setTimeout(() => setStepLoading(false), 700);
    }, 250);
    persistDraftSoon(s);
  }, [persistDraftSoon]);

  useEffect(() => () => {
    if (stepTimer.current) clearTimeout(stepTimer.current);
    if (stepHideTimer.current) clearTimeout(stepHideTimer.current);
  }, []);

  const resumeDraft = useCallback(() => {
    try {
      const d = loadDraft(localStorage);
      if (!d) {
        setDraft(null);
        return;
      }
      Object.assign(sessionRef.current, createSession());
      applyDraft(sessionRef.current, d);
      setDraft(draftSummary(d));
      setScreen(d.screen);
      setStepLoading(false);
      if (stepTimer.current) clearTimeout(stepTimer.current);
      if (stepHideTimer.current) clearTimeout(stepHideTimer.current);
      stepTimer.current = setTimeout(() => {
        setStepLoading(true);
        stepHideTimer.current = setTimeout(() => setStepLoading(false), 700);
      }, 250);
    } catch {
      toast("That draft could not be restored - starting fresh");
      try {
        clearDraft(localStorage);
      } catch { /* ignore */ }
      setDraft(null);
    }
  }, [toast]);

  const discardDraft = useCallback(() => {
    try {
      clearDraft(localStorage);
    } catch { /* ignore */ }
    setDraft(null);
  }, []);

  const clearDraftState = useCallback(() => {
    try {
      clearDraft(localStorage);
    } catch { /* ignore */ }
    setDraft(null);
  }, []);

  /* Crash coverage: the step-change save above misses a kill between steps. */
  useEffect(() => {
    const save = () => persistDraft(screenRef.current);
    const onVis = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [persistDraft]);

  const startCapture = useCallback(() => {
    try {
      clearDraft(localStorage);
    } catch { /* ignore */ }
    setDraft(null);
    const s = sessionRef.current;
    s.currentCaseId = null;
    s.capturingAngle = 1;
    s.stillA = "";
    s.still2DataUrl = "";
    s.bundleA = null;
    s.bundleB = null;
    s.measurementA = null;
    s.measurementB = null;
    s.payloadA = null;
    s.payloadB = null;
    s.winnerAngle = null;
    // A new case supersedes any in-flight background job: its late landing
    // must be discarded, never applied to the fresh claim.
    s.measureSeq = (s.measureSeq ?? 0) + 1;
    s.measureJob = null;
    s.payload = null;
    s.measurement = null;
    resetDmg(s);
    go("capture");
  }, [go]);

  const bumpCases = useCallback(() => setCasesVersion((v) => v + 1), []);

  /* body classes the CSS keys off (tab bar, camera control hiding) */
  useEffect(() => {
    document.body.classList.toggle("tabbing", TAB_SCREENS.includes(screen));
    document.body.classList.toggle("reviewing", screen === "sReview");
    document.body.classList.toggle("step2", screen === "sSay");
  }, [screen]);

  /* First-run onboarding gate: overlay until completed or dismissed. */
  const obGate = useOnboardingGate();
  const [obActive, setObActive] = useState(obGate.active);
  const replayOnboarding = useCallback(() => setObActive(true), []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  measuringRef.current = measuring;

  const tryAutoUpdate = useCallback(() => {
    if (!waitingSw.current) return false;
    if (sessionRef.current.stillDataUrl || measuringRef.current) return false;
    waitingSw.current.postMessage("SKIP_WAITING");
    return true;
  }, []);

  /* a finished or abandoned claim unblocks a pending update */
  useEffect(() => {
    tryAutoUpdate();
  }, [screen, measuring, tryAutoUpdate]);

  /* service worker: register, auto-apply waiting updates, reload on activation.
     An update applies itself the moment it is safe: no photo taken yet and
     no measurement running. Mid-claim the bar stays until the claim ends. */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      swReg.current = reg;
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingSw.current = reg.waiting;
        if (!tryAutoUpdate()) setUpdateReady(true);
      }
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            waitingSw.current = sw;
            if (!tryAutoUpdate()) setUpdateReady(true);
          }
        });
      });
    }).catch(() => { /* the app still runs uncached */ });
    // Long-lived sessions never navigate, so the browser may never check for
    // a new worker on its own - poll every 20 min and on every foreground.
    const poll = () => swReg.current?.update().catch(() => {});
    const beat = setInterval(poll, 20 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);
    const onController = () => {
      if (reloading.current) return;
      reloading.current = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!swReg.current) {
      toast("Service worker not registered yet - reload once, then check again");
      return;
    }
    await swReg.current.update().catch(() => {});
    if (waitingSw.current) {
      toast(tryAutoUpdate() ? "Update found - applying…" : "Update ready - finishes your claim first");
    } else {
      toast(updateReady ? "Update ready - finishes your claim first" : "You are on the latest version");
    }
  }, [toast, updateReady, tryAutoUpdate]);

  const applyUpdate = useCallback(() => {
    waitingSw.current?.postMessage("SKIP_WAITING");
  }, []);

  const ctx: AppCtx = {
    session: sessionRef.current,
    store,
    base,
    setBase,
    screen,
    go,
    startCapture,
    replayOnboarding,
    toast,
    casesVersion,
    bumpCases,
    sam: samRef.current,
    embeddings,
    measuring,
    setMeasuring,
    numError,
    setNumError,
    measureRef,
    checks,
    setChecks,
    swUpdateReady: updateReady,
    checkForUpdates,
    applyUpdate,
    online,
    draft,
    resumeDraft,
    discardDraft,
    clearDraft: clearDraftState,
  };

  // Screen routing: field proof SC-D8ECE64B (232mm / 0.73% / 7.48cm2) - see /reports URLs.
  return (
    <Ctx.Provider value={ctx}>
      {(screen === "capture" || screen === "sReview") && <Capture />}
      {screen === "sMark" && <Mark />}
      {screen === "sSay" && <Say />}
      {screen === "sNum" && <Numbers />}
      {screen === "sCheck" && <Check />}
      {screen === "sReport" && <Report />}
      {screen === "sShared" && sharedRef.current && <Shared rep={sharedRef.current} />}
      {screen === "tHome" && <Home />}
      {screen === "tCases" && <Cases />}
      {screen === "tSettings" && <Settings />}
      {screen === "tAdmin" && <Admin />}

      {TAB_SCREENS.includes(screen) && (
        <nav id="tabs" aria-label="Main">
          <button type="button" data-tab="tHome" aria-current={screen === "tHome" ? "page" : undefined} onClick={() => go("tHome")}>
            <span className="tab-pill">
              <span className="tabicon" aria-hidden="true">
                <svg className="icon-outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></svg>
                <svg className="icon-filled" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l10 8.4h-2.8v10H14v-6h-4v6H4.8V11H2z" /></svg>
              </span>
              <span className="tablabel">Home</span>
            </span>
          </button>
          <button type="button" data-tab="capture" id="tabNew" aria-label="Start a new claim" onClick={startCapture}>
            <span className="tab-pill">
              <span className="tabicon tabicon--fab" aria-hidden="true">
                <span className="fabdot">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </span>
              <span className="tablabel">New</span>
            </span>
          </button>
          <button type="button" data-tab="tCases" aria-current={screen === "tCases" ? "page" : undefined} onClick={() => go("tCases")}>
            <span className="tab-pill">
              <span className="tabicon" aria-hidden="true">
                <svg className="icon-outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                <svg className="icon-filled" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6a3 3 0 0 1 3-3h4l2 2h8a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" /></svg>
              </span>
              <span className="tablabel">Cases</span>
            </span>
          </button>
        </nav>
      )}
      {updateReady && (
        <div id="updateBar" role="status">
          <span>A new version is ready - applies when this claim ends.</span>
          <button id="updateGo" type="button" onClick={applyUpdate}>Reload</button>
        </div>
      )}
      {obActive && (
        <Onboarding
          initialStep={obGate.initialStep}
          resumed={obGate.resumed}
          onDone={() => setObActive(false)}
          onExit={() => setObActive(false)}
        />
      )}
      {!online && (
        <div id="offlineBar" role="status">
          You&apos;re offline. Saved cases and capture still work here - new measurements, reports and checks need a connection. On-device outlining and voice need one online load first to download their models.
        </div>
      )}
      {toastMsg && <div id="toast" role="status">{toastMsg}</div>}
      {stepLoading && (
        <div id="stepLoading" role="status" aria-label="Loading next step">
          <span className="spin" aria-hidden="true" />
          <b>Loading…</b>
        </div>
      )}
    </Ctx.Provider>
  );
}
