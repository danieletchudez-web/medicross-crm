import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

import ManagerDashboard    from "./pages/ManagerDashboard";
import SellerDashboard     from "./pages/SellerDashboard";
import AccountsPage        from "./pages/AccountsPage";
import ProductsPage        from "./pages/ProductsPage";
import OpportunitiesPage   from "./pages/OpportunitiesPage";
import CampaignsPage       from "./pages/CampaignsPage";
import TodayActionsPage    from "./pages/TodayActionsPage";
import VisitsPage          from "./pages/VisitsPage";
import CalendarPage        from "./pages/CalendarPage";
import AdminUsersPage      from "./pages/adminUsersPages";
import SalesAnalyticsPage  from "./pages/SalesAnalyticsPage";
import ImporterPage        from "./pages/ImporterPage";
import LoginPage           from "./pages/LoginPage";
import CRMAssistant        from "./components/CRMAssistant";

const FALLBACK_PROFILE = {
  id: null, full_name: "Usuario", email: "", role: "super_admin", approved: true,
  allowed_modules: [
    "managerDashboard","sellerDashboard","accounts","products",
    "opportunities","campaigns","todayActions","visits",
    "calendar","adminUsers","salesAnalytics","importer",
  ],
};

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage]       = useState("managerDashboard");
  const [loading, setLoading] = useState(true);
  const [crmData, setCrmData] = useState(null);

  useEffect(() => {
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => { setSession(s); if (s?.user) loadProfile(s.user); else setProfile(null); }
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadCrmData(); }, [page, session]);

  async function init() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) { setSession(null); setProfile(null); return; }
      const s = data?.session || null;
      setSession(s);
      if (s?.user) loadProfile(s.user);
    } catch { setSession(null); setProfile(null); }
    finally { setLoading(false); }
  }

  async function loadProfile(user) {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile(error || !data
        ? { ...FALLBACK_PROFILE, id: user.id, email: user.email, full_name: user.email }
        : data);
    } catch {
      setProfile({ ...FALLBACK_PROFILE, id: user.id, email: user.email, full_name: user.email });
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

  if (loading) return <div style={{ padding: 30 }}>Cargando CRM...</div>;
  if (!session) return <LoginPage />;

  if (profile?.approved === false) {
    return (
      <div style={st.pending}>
        <div style={st.card}>
          <h2>Usuario pendiente de aprobación</h2>
          <p>Tu acceso debe ser aprobado por un administrador.</p>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} style={st.btn}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  const safeProfile = profile || FALLBACK_PROFILE;
  const pageProps   = { profile: safeProfile, onNavigate: setPage };

  let CurrentPage;
  switch (page) {
    case "managerDashboard": CurrentPage = <ManagerDashboard   {...pageProps} />; break;
    case "sellerDashboard":  CurrentPage = <SellerDashboard    {...pageProps} />; break;
    case "accounts":         CurrentPage = <AccountsPage       {...pageProps} />; break;
    case "products":         CurrentPage = <ProductsPage       {...pageProps} />; break;
    case "opportunities":    CurrentPage = <OpportunitiesPage  {...pageProps} />; break;
    case "campaigns":        CurrentPage = <CampaignsPage      {...pageProps} />; break;
    case "todayActions":     CurrentPage = <TodayActionsPage   {...pageProps} />; break;
    case "visits":           CurrentPage = <VisitsPage         {...pageProps} />; break;
    case "calendar":         CurrentPage = <CalendarPage       {...pageProps} />; break;
    case "adminUsers":       CurrentPage = <AdminUsersPage     {...pageProps} />; break;
    case "salesAnalytics":   CurrentPage = <SalesAnalyticsPage {...pageProps} />; break;
    case "importer":         CurrentPage = <ImporterPage       {...pageProps} />; break;
    default:                 CurrentPage = <ManagerDashboard   {...pageProps} />;
  }

  return (
    <>
      {CurrentPage}
      <CRMAssistant profile={safeProfile} currentPage={page} crmData={crmData} />
    </>
  );
}

const st = {
  pending: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f6fb" },
  card:    { background: "#fff", padding: 30, borderRadius: 20, boxShadow: "0 10px 30px rgba(0,0,0,0.08)", textAlign: "center" },
  btn:     { marginTop: 12, padding: "12px 16px", borderRadius: 10, border: "none", background: "#1677ff", color: "white", fontWeight: 800, cursor: "pointer" },
};