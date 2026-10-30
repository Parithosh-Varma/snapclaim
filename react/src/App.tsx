import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { DEFAULT_BASE, POLICY_BACKEND_MESSAGE, isAllowedBackendUrl } from "./lib/api";
import { SamClient } from "./lib/sam";
import { createSession, resetDmg, type Session } from "./lib/session";
import { appStore, type CaseStore } from "./lib/store";
import Capture from "./screens/Capture";
import Mark from "./screens/Mark";
import Say from "./screens/Say";
import Numbers from "./screens/Numbers";
import Check from "./screens/Check";
import Report from "./screens/Report";
import { Home, Cases, Settings } from "./screens/Tabs";

export type Screen =
  | "tHome" | "tCases" | "tSettings"
  | "capture" | "sReview" | "sMark" | "sSay" | "sNum" | "sCheck" | "sReport";

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
  setChecks(c: { skeptic: CheckPhase; xcheck: CheckPhase }): void;
  swUpdateReady: boolean;
  checkForUpdates(): Promise<void>;
  applyUpdate(): void;
  online: boolean;
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

  const [screen, setScreen] = useState<Screen>("tHome");
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

  const go = useCallback((s: Screen) => setScreen(s), []);

  const startCapture = useCallback(() => {
    const s = sessionRef.current;
    s.currentCaseId = null;
    resetDmg(s);
    setScreen("capture");
  }, []);

  const bumpCases = useCallback(() => setCasesVersion((v) => v + 1), []);

  /* body classes the CSS keys off (tab bar, camera control hiding) */
  useEffect(() => {
    document.body.classList.toggle("tabbing", TAB_SCREENS.includes(screen));
    document.body.classList.toggle("reviewing", screen === "sReview");
    document.body.classList.toggle("step2", screen === "sSay");
  }, [screen]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /* service worker: register, surface waiting updates, reload on activation */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      swReg.current = reg;
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingSw.current = reg.waiting;
        setUpdateReady(true);
      }
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            waitingSw.current = sw;
            setUpdateReady(true);
          }
        });
      });
    }).catch(() => { /* the app still runs uncached */ });
    const onController = () => {
      if (reloading.current) return;
      reloading.current = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!swReg.current) {
      toast("Service worker not registered yet — reload once, then check again");
      return;
    }
    await swReg.current.update().catch(() => {});
    toast(updateReady ? "Update ready — tap Reload at the top" : "You are on the latest version");
  }, [toast, updateReady]);

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
  };

  return (
    <Ctx.Provider value={ctx}>
      {(screen === "capture" || screen === "sReview") && <Capture />}
      {screen === "sMark" && <Mark />}
      {screen === "sSay" && <Say />}
      {screen === "sNum" && <Numbers />}
      {screen === "sCheck" && <Check />}
      {screen === "sReport" && <Report />}
      {screen === "tHome" && <Home />}
      {screen === "tCases" && <Cases />}
      {screen === "tSettings" && <Settings />}

      {TAB_SCREENS.includes(screen) && (
        <nav id="tabs" aria-label="Main">
          <button type="button" data-tab="tHome" aria-current={screen === "tHome" ? "page" : undefined} onClick={() => go("tHome")}>
            <span className="tabicon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></svg>
            </span>
            <span className="tablabel">Home</span>
          </button>
          <button type="button" data-tab="capture" id="tabNew" aria-label="Start a new claim" onClick={startCapture}>
            <span className="fabdot" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <span className="tablabel">New</span>
          </button>
          <button type="button" data-tab="tCases" aria-current={screen === "tCases" ? "page" : undefined} onClick={() => go("tCases")}>
            <span className="tabicon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            </span>
            <span className="tablabel">Cases</span>
          </button>
          <button type="button" data-tab="tSettings" aria-current={screen === "tSettings" ? "page" : undefined} onClick={() => go("tSettings")}>
            <span className="tabicon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h9M19 8h1M4 16h3M13 16h7" /><circle cx="16" cy="8" r="2.2" /><circle cx="10" cy="16" r="2.2" /></svg>
            </span>
            <span className="tablabel">Settings</span>
          </button>
        </nav>
      )}
      {updateReady && (
        <div id="updateBar" role="status">
          <span>A new version of SnapClaim is ready.</span>
          <button id="updateGo" type="button" onClick={applyUpdate}>Reload</button>
        </div>
      )}
      {!online && (
        <div id="offlineBar" role="status">
          You&apos;re offline. Saved cases and capture still work here — new measurements, reports and checks need a connection. On-device outlining and voice need one online load first to download their models.
        </div>
      )}
      {toastMsg && <div id="toast" role="status">{toastMsg}</div>}
      <div id="appLive" className="sr-only" aria-live="polite">{toastMsg ?? ""}</div>
    </Ctx.Provider>
  );
}
