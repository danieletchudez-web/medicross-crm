import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

import LoginPage    from "./pages/LoginPage";
import CRMAssistant from "./components/CRMAssistant";
import DialogSystem from "./components/DialogSystem";

const ManagerDashboard      = lazy(() => import("./pages/ManagerDashboard"));
const SellerDashboard       = lazy(() => import("./pages/SellerDashboard"));
const AccountsPage          = lazy(() => import("./pages/AccountsPage"));
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
const SettingsPage          = lazy(() => import("./pages/SettingsPage"));

const ALL_PAGES = [
  { id: "managerDashboard",  Component: ManagerDashboard },
  { id: "sellerDashboard",   Component: SellerDashboard },
  { id: "accounts",          Component: AccountsPage },
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
  { id: "settings",          Component: SettingsPage },
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

function FullPageLoader({ label = "Cargando módulo…" }) {
  return (
    <div style={{
      minHeight:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      background:"#f0f2f5", gap:16,
      fontFamily:"DM Sans, system-ui, sans-serif"
    }}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <div style={{width:9,height:9,borderRadius:"50%",background:"#4da3f0",animation:"crmPulse 1.2s ease-in-out infinite"}}/>
        <span style={{fontSize:16,fontWeight:600,color:"#0f2444",letterSpacing:"-0.3px"}}>MediCross CRM</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
        <div style={{display:"flex",gap:5}}>
          {[0,1,2].map(i=>(
            <div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#0f2444",animation:`crmBounce 1.2s ease-in-out ${i*0.18}s infinite`}}/>
          ))}
        </div>
        <span style={{fontSize:12,color:"#94a3b8",fontWeight:500,letterSpacing:"0.5px"}}>{label}</span>
      </div>
      <style>{`
        @keyframes crmPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.35);opacity:.65} }
        @keyframes crmBounce { 0%,80%,100%{transform:translateY(0);opacity:.18} 40%{transform:translateY(-7px);opacity:.85} }
      `}</style>
    </div>
  );
}

export default function App() {
  const [session,      setSession]      = useState(null);
  const [profile,      setProfile]      = useState(null);
  const [page,         setPage]         = useState(() => localStorage.getItem("crm_current_page") || "managerDashboard");
  const [navigateData, setNavigateData] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [crmData,      setCrmData]      = useState(null);
  const [transitionKey, setTransitionKey] = useState(0);
  // Pages that have been visited at least once (stay mounted forever after)
  const [mounted,      setMounted]      = useState(() => new Set([localStorage.getItem("crm_current_page") || "managerDashboard"]));

  useEffect(() => {
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => { setSession(s); if (s?.user) loadProfile(s.user); else setProfile(null); }
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadCrmData(); }, [page, session]);

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
        setTimeout(async () => {
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

  function navigate(p, data) {
    setNavigateData(data || null);
    setPage(p);
    setTransitionKey((key) => key + 1);
    localStorage.setItem("crm_current_page", p);
    // Add to mounted set so the page stays alive after first visit
    setMounted(prev => {
      if (prev.has(p)) return prev;
      const next = new Set(prev);
      next.add(p);
      return next;
    });
  }

  function canOpenPage(pageId) {
    if (safeProfile.role === "super_admin") return true;
    if (["notifications","settings"].includes(pageId)) return true;
    if (pageId === "adminUsers") return false;
    if (pageId === "managerDashboard") return true;
    return (safeProfile.allowed_modules || []).includes(pageId);
  }

  const currentPage = canOpenPage(page) ? page : "managerDashboard";
  const pageProps   = { profile: safeProfile, onNavigate: navigate, pageKey: transitionKey };

  // A page should be in the DOM if it's the current page OR was previously visited
  const shouldMount = (id) => id === currentPage || mounted.has(id);

  return (
    <>
      {ALL_PAGES.map(({ id, Component }) => {
        if (!shouldMount(id)) return null;
        const isActive   = id === currentPage;
        const extraProps = id === "cotizador" ? { initialData: navigateData } : {};
        return (
          <div
            key={id}
            className={`page-keepalive${isActive ? " page-keepalive--active" : ""}`}
            aria-hidden={!isActive}
          >
            <Suspense fallback={isActive ? <FullPageLoader /> : <></>}>
              <Component {...pageProps} {...extraProps} />
            </Suspense>
          </div>
        );
      })}
      <CRMAssistant profile={safeProfile} currentPage={currentPage} crmData={crmData} />
      <DialogSystem />
    </>
  );
}

const st = {
  pending: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f6fb" },
  card:    { background: "#fff", padding: 30, borderRadius: 20, boxShadow: "0 10px 30px rgba(0,0,0,0.08)", textAlign: "center" },
  btn:     { marginTop: 12, padding: "12px 16px", borderRadius: 10, border: "none", background: "#1677ff", color: "white", fontWeight: 800, cursor: "pointer" },
};
