import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { canOpenModule, getFirstOpenModule } from "./lib/moduleAccess";

import LoginPage                from "./pages/LoginPage";
import CRMAssistant             from "./components/CRMAssistant";
import DialogSystem             from "./components/DialogSystem";
import MobileNav                from "./components/MobileNav";
import MobileDock               from "./components/MobileDock";
import DailyMotivationGate      from "./components/DailyMotivationPopup";

class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) { console.error("[PageErrorBoundary]", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 12, color: "#64748b", fontFamily: "sans-serif" }}>
          <p style={{ fontSize: 15, fontWeight: 600 }}>Error al cargar este módulo.</p>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#5b7cfa", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

class SafeRender extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) { console.error("[SafeRender]", err); }
  componentDidUpdate(_, prevState) {
    if (prevState.hasError) this.setState({ hasError: false });
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

const ManagerDashboard      = lazy(() => import("./pages/ManagerDashboard"));
const SellerDashboard       = lazy(() => import("./pages/SellerDashboard"));
const AccountsPage          = lazy(() => import("./pages/AccountsPage"));
const AccountDetailPage     = lazy(() => import("./pages/AccountDetailPage"));
const ProductsPage          = lazy(() => import("./pages/ProductsPage"));
const OpportunitiesPage     = lazy(() => import("./pages/OpportunitiesPage"));
const CampaignsPage         = lazy(() => import("./pages/CampaignsPage"));
const TodayActionsPage      = lazy(() => import("./pages/TodayActionsPage"));
const VisitsPage            = lazy(() => import("./pages/VisitsPage"));
const CalendarPage          = lazy(() => import("./pages/CalendarPage"));
const AdminUsersPage        = lazy(() => import("./pages/AdminUsersPage"));
const SalesAnalyticsPage    = lazy(() => import("./pages/SalesAnalyticsPage"));
const ImporterPage          = lazy(() => import("./pages/ImporterPage"));
const TendersPage           = lazy(() => import("./pages/TendersPage"));
const CotizadorPage         = lazy(() => import("./pages/CotizadorPage"));
const PreciosHistoricosPage = lazy(() => import("./pages/PreciosHistoricosPage"));
const NotificationsPage     = lazy(() => import("./pages/NotificationsPage"));
const TasksPage             = lazy(() => import("./pages/TasksPage"));
const HabitsPage            = lazy(() => import("./pages/HabitsPage"));
const SuppliersPage         = lazy(() => import("./pages/SuppliersPage"));
const SettingsPage          = lazy(() => import("./pages/SettingsPage"));
const MobileHomePage        = lazy(() => import("./pages/MobileHomePage"));
const FarapulsePage         = lazy(() => import("./pages/FarapulsePage"));
const FarapulseDetailPage   = lazy(() => import("./pages/FarapulseDetailPage"));

const ALL_PAGES = [
  { id: "managerDashboard",  Component: ManagerDashboard },
  { id: "sellerDashboard",   Component: SellerDashboard },
  { id: "accounts",          Component: AccountsPage },
  { id: "accountDetail",     Component: AccountDetailPage },
  { id: "products",          Component: ProductsPage },
  { id: "opportunities",     Component: OpportunitiesPage },
  { id: "campaigns",         Component: CampaignsPage },
  { id: "todayActions",      Component: TodayActionsPage },
  { id: "visits",            Component: VisitsPage },
  { id: "calendar",          Component: CalendarPage },
  { id: "adminUsers",        Component: AdminUsersPage },
  { id: "salesAnalytics",    Component: SalesAnalyticsPage },
  { id: "importer",          Component: ImporterPage },
  { id: "tenders",           Component: TendersPage },
  { id: "cotizador",         Component: CotizadorPage },
  { id: "preciosHistoricos", Component: PreciosHistoricosPage },
  { id: "notifications",     Component: NotificationsPage },
  { id: "tasks",             Component: TasksPage },
  { id: "habits",            Component: HabitsPage },
  { id: "suppliers",         Component: SuppliersPage },
  { id: "settings",          Component: SettingsPage },
  { id: "mobileHome",        Component: MobileHomePage },
  { id: "farapulse",         Component: FarapulsePage },
  { id: "farapulseDetail",   Component: FarapulseDetailPage },
];

const FALLBACK_PROFILE = {
  id: null,
  full_name: "Usuario",
  email: "",
  role: "pending",
  approved: false,
  is_active: false,
  allowed_modules: [],
};

function canOpenPageForProfile(profile, pageId, isMobile = false) {
  if (["notifications","settings","tasks","suppliers","mobileHome"].includes(pageId)) return true;
  if (pageId === "accountDetail") return canOpenModule(profile, "accounts", isMobile);
  return canOpenModule(profile, pageId, isMobile);
}

function hasPasswordRecoveryIntent() {
  const params = new URLSearchParams(window.location.search);
  return params.get("recovery") === "1" || window.location.hash.includes("type=recovery");
}

function buildPendingProfile(user, reason = "profile_missing") {
  return {
    id: user?.id || null,
    email: user?.email || "",
    full_name: user?.email || "Usuario pendiente",
    role: "pending",
    approved: false,
    is_active: false,
    allowed_modules: [],
    access_reason: reason,
  };
}

function FullPageLoader({ label = "Cargando módulo…", overlay = false }) {
  return (
    <div className={`crm-loader${overlay ? " crm-loader--overlay" : ""}`} role="status" aria-live="polite">
      <div className="crm-loader__card">
        <svg className="crm-loader__pulse" viewBox="0 0 320 70" aria-hidden="true">
          <defs>
            <linearGradient id="crmLoaderPulse" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="#0f4e89" stopOpacity="0" />
              <stop offset="0.32" stopColor="#1d9bd7" />
              <stop offset="0.68" stopColor="#0f4e89" />
              <stop offset="1" stopColor="#1d9bd7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            className="crm-loader__pulse-base"
            d="M10 38 H88 C96 38 98 18 106 18 C115 18 116 54 126 54 C134 54 137 38 146 38 H310"
          />
          <path
            className="crm-loader__pulse-live"
            d="M10 38 H88 C96 38 98 18 106 18 C115 18 116 54 126 54 C134 54 137 38 146 38 H310"
          />
        </svg>

        <div className="crm-loader__status">
          <span>{label}</span>
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session,      setSession]      = useState(null);
  const [profile,      setProfile]      = useState(null);
  const [page,         setPage]         = useState(() => {
    const saved = localStorage.getItem("crm_current_page") || "managerDashboard";
    if (window.matchMedia?.("(max-width: 768px)").matches && (saved === "managerDashboard" || saved === "sellerDashboard")) return "mobileHome";
    return saved;
  });
  const [navigateData, setNavigateData] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [crmData,      setCrmData]      = useState(null);
  const [transitionKey, setTransitionKey] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(() => hasPasswordRecoveryIntent());
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia?.("(max-width: 768px)").matches || false);
  const routeLoadingTimer = useRef(null);
  const profileRetryTimer = useRef(null);
  // Pages that have been visited at least once (stay mounted forever after)
  const [mounted,      setMounted]      = useState(() => {
    const saved = localStorage.getItem("crm_current_page") || "managerDashboard";
    const isMob = window.matchMedia?.("(max-width: 768px)").matches;
    const initial = (isMob && (saved === "managerDashboard" || saved === "sellerDashboard")) ? "mobileHome" : saved;
    return new Set([initial]);
  });

  useEffect(() => {
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        setSession(s);
        if (s?.user) loadProfile(s.user);
        else setProfile(null);
      }
    );
    return () => {
      subscription.unsubscribe();
      if (routeLoadingTimer.current) clearTimeout(routeLoadingTimer.current);
      if (profileRetryTimer.current) clearTimeout(profileRetryTimer.current);
    };
  }, []);

  useEffect(() => { if (session) loadCrmData(); }, [session]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 768px)");
    if (!media) return;
    const onChange = e => setIsMobileViewport(e.matches);
    setIsMobileViewport(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (!session || !profile?.approved || profile.is_active === false) return;

    // Rotation: portrait→landscape while on mobileHome → go to desktop module
    if (!isMobileViewport && page === "mobileHome") {
      const fallbackPage = getFirstOpenModule(profile, false) || "settings";
      setPage(fallbackPage);
      localStorage.setItem("crm_current_page", fallbackPage);
      setMounted(prev => {
        if (prev.has(fallbackPage)) return prev;
        const next = new Set(prev); next.add(fallbackPage); return next;
      });
      return;
    }

    // Rotation: landscape→portrait while on a desktop-only dashboard → go to mobileHome
    if (isMobileViewport && (page === "managerDashboard" || page === "sellerDashboard")) {
      setPage("mobileHome");
      localStorage.setItem("crm_current_page", "mobileHome");
      setMounted(prev => {
        if (prev.has("mobileHome")) return prev;
        const next = new Set(prev); next.add("mobileHome"); return next;
      });
      return;
    }

    if (canOpenPageForProfile(profile, page, isMobileViewport)) return;
    const fallbackPage = getFirstOpenModule(profile, isMobileViewport) || "settings";
    setPage(fallbackPage);
    localStorage.setItem("crm_current_page", fallbackPage);
    setMounted(prev => {
      if (prev.has(fallbackPage)) return prev;
      const next = new Set(prev);
      next.add(fallbackPage);
      return next;
    });
  }, [session, profile, page, isMobileViewport]);

  // Silently preload the most visited modules after auth resolves
  useEffect(() => {
    if (!session || loading) return;
    import("./pages/AccountsPage");
    import("./pages/OpportunitiesPage");
    import("./pages/VisitsPage");
  }, [session, loading]);

  async function init() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) { setSession(null); setProfile(null); return; }
      const s = data?.session || null;
      setSession(s);
      if (s?.user) loadProfile(s.user);
    } catch { setSession(null); setProfile(null); }
    finally { setTimeout(() => setLoading(false), 900); }
  }

  async function loadProfile(user) {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (data && !error) {
        setProfile(data);
      } else {
        clearTimeout(profileRetryTimer.current);
        profileRetryTimer.current = setTimeout(async () => {
          const { data: retry } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
          if (retry) { setProfile(retry); return; }
          setProfile(buildPendingProfile(user));
        }, 1000);
      }
    } catch {
      setProfile(buildPendingProfile(user, "profile_error"));
    }
  }

  async function loadCrmData() {
    try {
      const [oppsRes, visitsRes, accountsRes, campaignsRes] = await Promise.all([
        supabase.from("opportunities").select("stage, amount, forecast_amount, probability, next_action, expected_close"),
        supabase.from("visits").select("visit_date, account_id"),
        supabase.from("accounts").select("id, follow_status"),
        supabase.from("campaigns").select("target_amount"),
      ]);
      const opps = oppsRes.data || [], visits = visitsRes.data || [], accounts = accountsRes.data || [], campaigns = campaignsRes.data || [];
      const open = opps.filter((o) => !["Ganado","Perdido"].includes(o.stage));
      const pipeline = open.reduce((s, o) => s + Number(o.amount || 0), 0);
      const forecast = open.reduce((s, o) => s + Number(o.forecast_amount || 0), 0);
      const target   = campaigns.reduce((s, c) => s + Number(c.target_amount || 0), 0);
      const hotDeals = open.filter((o) => Number(o.probability || 0) >= 70).length;
      const noAction = open.filter((o) => !o.next_action).length;
      const overdue  = open.filter((o) => o.expected_close && new Date(o.expected_close) < new Date()).length;
      const won  = opps.filter((o) => o.stage === "Ganado").length;
      const lost = opps.filter((o) => o.stage === "Perdido").length;
      const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
      const today = new Date();
      const coldAccounts = accounts.filter((a) => {
        const av = visits.filter((v) => v.account_id === a.id);
        if (!av.length) return true;
        const last = av.sort((x, y) => new Date(y.visit_date) - new Date(x.visit_date))[0];
        return Math.floor((today - new Date(last.visit_date)) / 86400000) > 30;
      }).length;
      const in30 = new Date(today.getTime() + 30 * 86400000);
      const closingThisMonth = open.filter((o) => {
        if (!o.expected_close) return false;
        const d = new Date(o.expected_close);
        return d >= today && d <= in30;
      }).length;
      setCrmData({ pipeline, forecast, target, openOpps: open.length, hotDeals, noAction, overdue, visits: visits.length, accounts: accounts.length, winRate, coldAccounts, closingThisMonth });
    } catch { /* silent */ }
  }

  if (loading) return <FullPageLoader label="Trabajando…" />;

  if (passwordRecovery) {
    return <LoginPage initialMode="recovery" onRecoveryComplete={() => setPasswordRecovery(false)} />;
  }

  if (!session) return <LoginPage />;

  const safeProfile = profile || FALLBACK_PROFILE;
  const accessBlocked = !safeProfile.approved || safeProfile.is_active === false;

  if (accessBlocked) {
    const title = safeProfile.is_active === false
      ? "Acceso pendiente de revisión"
      : "Usuario pendiente de aprobación";
    const detail = safeProfile.access_reason === "profile_error"
      ? "No pudimos validar tu perfil. Cerrá sesión e intentá nuevamente, o pedile a un administrador que revise tu usuario."
      : "Tu cuenta debe existir en Administración y ser aprobada antes de entrar al CRM.";
    return (
      <div style={st.pending}>
        <div style={st.card}>
          <h2>{title}</h2>
          <p>{detail}</p>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} style={st.btn}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  async function handleLogout() { await supabase.auth.signOut(); }

  function navigate(p, data) {
    const targetPage = canOpenPageForProfile(safeProfile, p, isMobileViewport)
      ? p
      : getFirstOpenModule(safeProfile, isMobileViewport) || "settings";
    setNavigateData(data || null);
    if (targetPage !== page) {
      setRouteLoading(true);
      if (routeLoadingTimer.current) clearTimeout(routeLoadingTimer.current);
      routeLoadingTimer.current = setTimeout(() => {
        setRouteLoading(false);
        routeLoadingTimer.current = null;
      }, 520);
    }
    setPage(targetPage);
    setTransitionKey((key) => key + 1);
    localStorage.setItem("crm_current_page", targetPage);
    // Add to mounted set so the page stays alive after first visit
    setMounted(prev => {
      if (prev.has(targetPage)) return prev;
      const next = new Set(prev);
      next.add(targetPage);
      return next;
    });
  }

  const PAGE_IDS = new Set(ALL_PAGES.map(p => p.id));

  function canOpenPage(pageId) {
    return PAGE_IDS.has(pageId) && canOpenPageForProfile(safeProfile, pageId, isMobileViewport);
  }

  const currentPage = canOpenPage(page)
    ? page
    : getFirstOpenModule(safeProfile, isMobileViewport) || "settings";
  const pageProps   = { profile: safeProfile, onNavigate: navigate, pageKey: transitionKey };

  // A page should be in the DOM if it's the current page OR was previously visited
  const shouldMount = (id) => id === currentPage || mounted.has(id);

  return (
    <>
      {ALL_PAGES.map(({ id, Component }) => {
        if (!shouldMount(id)) return null;
        const isActive   = id === currentPage;
        const extraProps = id === "cotizador"
          ? { initialData: navigateData }
          : id === "visits"
            ? { navigationData: navigateData }
            : id === "accountDetail" || id === "opportunities"
              ? { navigationData: navigateData }
            : id === "farapulseDetail"
              ? { navigationData: navigateData }
            : {};
        return (
          <div
            key={id}
            className={`page-keepalive${isActive ? " page-keepalive--active" : ""}`}
            style={isActive ? { "--crm-enter-name": transitionKey % 2 === 0 ? "crm-fade-slide-up-a" : "crm-fade-slide-up-b" } : undefined}
            aria-hidden={!isActive}
          >
            <PageErrorBoundary>
              <Suspense fallback={isActive ? <FullPageLoader /> : <></>}>
                <Component {...pageProps} {...extraProps} />
              </Suspense>
            </PageErrorBoundary>
          </div>
        );
      })}
      {routeLoading && <FullPageLoader label="Preparando módulo…" overlay />}
      <SafeRender><CRMAssistant profile={safeProfile} currentPage={currentPage} crmData={crmData} /></SafeRender>
      <SafeRender><DialogSystem /></SafeRender>
      <SafeRender><MobileNav currentPage={currentPage} onNavigate={navigate} /></SafeRender>
      <SafeRender><MobileDock currentPage={currentPage} onNavigate={navigate} profile={safeProfile} onLogout={handleLogout} /></SafeRender>
      <SafeRender><DailyMotivationGate userId={safeProfile.id} /></SafeRender>
    </>
  );
}

const st = {
  pending: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f6fb" },
  card:    { background: "#fff", padding: 30, borderRadius: 20, boxShadow: "0 10px 30px rgba(0,0,0,0.08)", textAlign: "center" },
  btn:     { marginTop: 12, padding: "12px 16px", borderRadius: 10, border: "none", background: "#1677ff", color: "white", fontWeight: 800, cursor: "pointer" },
};
