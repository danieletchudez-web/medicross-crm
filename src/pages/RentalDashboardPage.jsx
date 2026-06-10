import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./rentalDashboard.css";

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}

function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)} K`;
  return money(n);
}

function fDate(v) {
  if (!v) return "—";
  const [y, m, d] = String(v).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function rankBy(items, keyFn, valueFn) {
  const map = {};
  items.forEach(item => {
    const key = keyFn(item);
    if (!key) return;
    map[key] = (map[key] || 0) + Number(valueFn(item) || 0);
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));
}

export default function RentalDashboardPage({ profile, onNavigate, pageKey }) {
  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0);
  const [rentals, setRentals]         = useState([]);
  const [equipment, setEquipment]     = useState([]);
  const [loading, setLoading]         = useState(false);

  const periodYear  = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1).getFullYear();
  const periodMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1).getMonth();
  const periodLabel = `${MONTHS[periodMonth]} ${periodYear}`;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [renRes, eqRes] = await Promise.all([
      supabase.from("equipment_rentals")
        .select("*, equipment(name, brand, category)")
        .not("status", "in", "(cancelado)")
        .order("procedure_date", { ascending: false }),
      supabase.from("equipment").select("*").order("name"),
    ]);
    setRentals(renRes.data || []);
    setEquipment(eqRes.data || []);
    setLoading(false);
  }

  // Rentals del período seleccionado
  const periodRentals = useMemo(() => {
    return rentals.filter(r => {
      const d = r.procedure_date || r.delivery_date;
      if (!d) return false;
      const dt = new Date(d);
      return dt.getFullYear() === periodYear && dt.getMonth() === periodMonth;
    });
  }, [rentals, periodYear, periodMonth]);

  // KPIs del período
  const kpis = useMemo(() => {
    const billed = periodRentals.filter(r => ["facturado","cerrado"].includes(r.status));
    const active = rentals.filter(r => !["cerrado","cancelado","facturado"].includes(r.status));
    const totalRevenue = periodRentals.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const totalCost = periodRentals.reduce((s, r) => s + Number(r.cost_amount || 0), 0);
    const avgMargin = periodRentals.length
      ? Math.round(periodRentals.reduce((s, r) => s + Number(r.profit_margin || 0), 0) / periodRentals.length)
      : 0;
    const daysInMonth = new Date(periodYear, periodMonth + 1, 0).getDate();
    const maintSoon = equipment.filter(e => {
      const d = daysDiff(e.next_maintenance_date);
      return d !== null && d >= 0 && d <= 30;
    });
    return {
      procedures: periodRentals.length,
      totalRevenue,
      totalCost,
      profit: totalRevenue - totalCost,
      avgMargin,
      active: active.length,
      maintSoon: maintSoon.length,
      daysInMonth,
    };
  }, [periodRentals, rentals, equipment, periodYear, periodMonth]);

  // Agenda del día actual
  const todayStr = today.toISOString().slice(0, 10);
  const todayAgenda = useMemo(() => {
    const items = [];
    rentals.forEach(r => {
      if (r.delivery_date === todayStr) items.push({ rental: r, type: "entrega", icon: "📦", color: "#d1fae5" });
      if (r.procedure_date === todayStr) items.push({ rental: r, type: "procedimiento", icon: "🏥", color: "#ffedd5" });
      if (r.retrieval_date === todayStr) items.push({ rental: r, type: "retiro", icon: "📤", color: "#ede9fe" });
    });
    return items.sort((a, b) => a.type.localeCompare(b.type));
  }, [rentals, todayStr]);

  // Rankings
  const byDoctor      = useMemo(() => rankBy(periodRentals, r => r.doctor_name, r => r.total_amount), [periodRentals]);
  const byInstitution = useMemo(() => rankBy(periodRentals, r => r.institution, r => r.total_amount), [periodRentals]);
  const bySeller      = useMemo(() => {
    return rankBy(periodRentals, r => r.seller_name || r.seller_id, r => r.total_amount);
  }, [periodRentals]);

  // Utilización por equipo (% días del mes con alquiler activo)
  const utilization = useMemo(() => {
    const startOfMonth = new Date(periodYear, periodMonth, 1);
    const endOfMonth = new Date(periodYear, periodMonth + 1, 0);
    const daysInMonth = endOfMonth.getDate();

    return equipment.map(eq => {
      const eqRentals = rentals.filter(r => r.equipment_id === eq.id);
      let occupiedDays = 0;
      eqRentals.forEach(r => {
        const from = new Date(r.delivery_date || r.procedure_date);
        const to   = new Date(r.retrieval_date || r.procedure_date);
        if (!from || !to) return;
        const effectiveFrom = from < startOfMonth ? startOfMonth : from;
        const effectiveTo   = to > endOfMonth ? endOfMonth : to;
        if (effectiveFrom <= effectiveTo) {
          occupiedDays += Math.ceil((effectiveTo - effectiveFrom) / 86400000) + 1;
        }
      });
      const pct = Math.min(Math.round((occupiedDays / daysInMonth) * 100), 100);
      return { ...eq, pct, occupiedDays };
    }).sort((a, b) => b.pct - a.pct);
  }, [equipment, rentals, periodYear, periodMonth]);

  // Equipos disponibles hoy
  const availToday = useMemo(() => {
    return equipment.map(eq => {
      const busyToday = rentals.some(r =>
        r.equipment_id === eq.id &&
        !["cerrado","cancelado"].includes(r.status) &&
        (r.procedure_date === todayStr || r.delivery_date === todayStr)
      );
      return { ...eq, busyToday };
    });
  }, [equipment, rentals, todayStr]);

  // Rentabilidad por procedimiento (últimos del período)
  const profitTable = useMemo(() => {
    return [...periodRentals]
      .filter(r => r.total_amount > 0 && r.cost_amount > 0)
      .sort((a, b) => Number(b.profit_margin) - Number(a.profit_margin))
      .slice(0, 8);
  }, [periodRentals]);

  // Próximos mantenimientos
  const maintAlerts = useMemo(() => {
    return equipment
      .filter(e => daysDiff(e.next_maintenance_date) !== null && daysDiff(e.next_maintenance_date) >= 0 && daysDiff(e.next_maintenance_date) <= 60)
      .sort((a, b) => new Date(a.next_maintenance_date) - new Date(b.next_maintenance_date));
  }, [equipment]);

  const maxRankValue = (list) => list[0]?.value || 1;

  return (
    <Layout title="Dashboard de Alquileres" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="rdash-page">

        {/* Header período */}
        <div className="rdash-header">
          <div>
            <h2>Dashboard de Alquileres</h2>
            <p>Análisis de equipamientos médicos — {periodLabel}</p>
          </div>
          <div className="rdash-period">
            <button onClick={() => setMonthOffset(o => o - 1)}>← Anterior</button>
            <span>{periodLabel}</span>
            <button onClick={() => setMonthOffset(o => Math.min(o + 1, 0))}>Siguiente →</button>
          </div>
        </div>

        {/* KPIs principales */}
        <div className="rdash-kpis">
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Procedimientos</span>
            <span className="rdash-kpi__value rdash-kpi__value--blue">{kpis.procedures}</span>
            <span className="rdash-kpi__sub">{periodLabel}</span>
          </div>
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Facturación</span>
            <span className="rdash-kpi__value">{compactMoney(kpis.totalRevenue)}</span>
            <span className="rdash-kpi__sub">ingresos del período</span>
          </div>
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Rentabilidad</span>
            <span className="rdash-kpi__value rdash-kpi__value--green">{compactMoney(kpis.profit)}</span>
            <span className="rdash-kpi__sub">ingresos − costos</span>
          </div>
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Margen promedio</span>
            <span className="rdash-kpi__value rdash-kpi__value--green">{kpis.avgMargin}%</span>
            <span className="rdash-kpi__sub">del período</span>
          </div>
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Activos ahora</span>
            <span className="rdash-kpi__value rdash-kpi__value--orange">{kpis.active}</span>
            <span className="rdash-kpi__sub">alquileres en curso</span>
          </div>
          <div className="rdash-kpi">
            <span className="rdash-kpi__label">Próx. manten.</span>
            <span className="rdash-kpi__value rdash-kpi__value--purple">{kpis.maintSoon}</span>
            <span className="rdash-kpi__sub">en los próx. 30 días</span>
          </div>
        </div>

        {/* Grid principal */}
        <div className="rdash-grid">

          {/* Utilización por equipo */}
          <div className="rdash-card">
            <h3>Utilización por equipo — {periodLabel}</h3>
            {utilization.length === 0 ? (
              <div className="rdash-empty">Sin datos</div>
            ) : (
              <div className="rdash-util-list">
                {utilization.map(eq => {
                  const fillClass = eq.pct >= 70 ? "rdash-util-item__fill--high"
                    : eq.pct >= 40 ? "rdash-util-item__fill--medium"
                    : "rdash-util-item__fill--low";
                  return (
                    <div key={eq.id} className="rdash-util-item">
                      <div className="rdash-util-item__head">
                        <span className="rdash-util-item__name">{eq.name}</span>
                        <span className="rdash-util-item__pct" style={{ color: eq.pct >= 70 ? "#10b981" : eq.pct >= 40 ? "#f59e0b" : "#ef4444" }}>
                          {eq.pct}%
                        </span>
                      </div>
                      <div className="rdash-util-item__track">
                        <div className={`rdash-util-item__fill ${fillClass}`} style={{ width: `${eq.pct}%` }} />
                      </div>
                      <span className="rdash-util-item__sub">{eq.occupiedDays} días ocupados · {eq.brand}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agenda hoy */}
          <div className="rdash-card">
            <h3>Agenda de hoy — {fDate(todayStr)}</h3>
            {todayAgenda.length === 0 ? (
              <div className="rdash-empty">Sin eventos para hoy</div>
            ) : (
              <div className="rdash-agenda">
                {todayAgenda.map((item, i) => (
                  <div key={i} className="rdash-agenda-item" style={{ cursor: "pointer" }} onClick={() => onNavigate("rentals")}>
                    <div className="rdash-agenda-item__type" style={{ background: item.color }}>
                      {item.icon}
                    </div>
                    <div className="rdash-agenda-item__body">
                      <div className="rdash-agenda-item__title">
                        {item.type.charAt(0).toUpperCase() + item.type.slice(1)} — {item.rental.equipment?.name}
                      </div>
                      <div className="rdash-agenda-item__sub">
                        {item.rental.doctor_name || "—"} · {item.rental.institution || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Equipos disponibles hoy */}
            <h3 style={{ marginTop: 8 }}>Disponibilidad hoy</h3>
            <div className="rdash-avail-grid">
              {availToday.map(eq => (
                <div key={eq.id} className={`rdash-avail-item ${eq.busyToday ? "rdash-avail-item--busy" : ""}`}>
                  <div className="rdash-avail-item__dot" />
                  <div className="rdash-avail-item__name">{eq.name}</div>
                  <div className="rdash-avail-item__status">{eq.busyToday ? "En uso" : "Disponible"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rankings */}
        <div className="rdash-grid rdash-grid--3">
          {/* Por médico */}
          <div className="rdash-card">
            <h3>Facturación por médico</h3>
            {byDoctor.length === 0 ? <div className="rdash-empty">Sin datos</div> : (
              <div className="rdash-rank-list">
                {byDoctor.map((item, i) => (
                  <div key={item.name} className="rdash-rank-item">
                    <div className="rdash-rank-item__pos">{i + 1}</div>
                    <div className="rdash-rank-item__name">{item.name}</div>
                    <div className="rdash-rank-item__bar-track">
                      <div className="rdash-rank-item__bar-fill" style={{ width: `${(item.value / maxRankValue(byDoctor)) * 100}%` }} />
                    </div>
                    <div className="rdash-rank-item__value">{compactMoney(item.value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Por institución */}
          <div className="rdash-card">
            <h3>Facturación por institución</h3>
            {byInstitution.length === 0 ? <div className="rdash-empty">Sin datos</div> : (
              <div className="rdash-rank-list">
                {byInstitution.map((item, i) => (
                  <div key={item.name} className="rdash-rank-item">
                    <div className="rdash-rank-item__pos">{i + 1}</div>
                    <div className="rdash-rank-item__name">{item.name}</div>
                    <div className="rdash-rank-item__bar-track">
                      <div className="rdash-rank-item__bar-fill" style={{ width: `${(item.value / maxRankValue(byInstitution)) * 100}%`, background: "#8b5cf6" }} />
                    </div>
                    <div className="rdash-rank-item__value">{compactMoney(item.value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Por vendedor */}
          <div className="rdash-card">
            <h3>Facturación por vendedor</h3>
            {bySeller.length === 0 ? <div className="rdash-empty">Sin datos</div> : (
              <div className="rdash-rank-list">
                {bySeller.map((item, i) => (
                  <div key={item.name} className="rdash-rank-item">
                    <div className="rdash-rank-item__pos">{i + 1}</div>
                    <div className="rdash-rank-item__name">{item.name}</div>
                    <div className="rdash-rank-item__bar-track">
                      <div className="rdash-rank-item__bar-fill" style={{ width: `${(item.value / maxRankValue(bySeller)) * 100}%`, background: "#10b981" }} />
                    </div>
                    <div className="rdash-rank-item__value">{compactMoney(item.value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rentabilidad + Mantenimientos */}
        <div className="rdash-grid">
          {/* Tabla rentabilidad por procedimiento */}
          <div className="rdash-card">
            <h3>Rentabilidad por procedimiento — {periodLabel}</h3>
            {profitTable.length === 0 ? <div className="rdash-empty">Sin datos con costo registrado</div> : (
              <div style={{ overflowX: "auto" }}>
                <table className="rdash-profit-table">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Equipo</th>
                      <th>Médico</th>
                      <th>Total</th>
                      <th>Costo</th>
                      <th>Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitTable.map(r => {
                      const m = Number(r.profit_margin || 0);
                      return (
                        <tr key={r.id}>
                          <td style={{ fontFamily: "monospace", fontSize: 11, color: "#5b7cfa", fontWeight: 700 }}>{r.rental_number}</td>
                          <td style={{ fontWeight: 600 }}>{r.equipment?.name || "—"}</td>
                          <td style={{ color: "#64748b" }}>{r.doctor_name || "—"}</td>
                          <td style={{ fontWeight: 700 }}>{compactMoney(r.total_amount)}</td>
                          <td style={{ color: "#64748b" }}>{compactMoney(r.cost_amount)}</td>
                          <td>
                            <span style={{ fontWeight: 800, color: m >= 45 ? "#10b981" : m >= 30 ? "#f97316" : "#ef4444" }}>
                              {m}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Próximos mantenimientos */}
          <div className="rdash-card">
            <h3>Equipos con mantenimiento próximo</h3>
            {maintAlerts.length === 0 ? (
              <div className="rdash-empty">Sin mantenimientos pendientes en los próximos 60 días ✓</div>
            ) : (
              <div className="rdash-rank-list">
                {maintAlerts.map(eq => {
                  const d = daysDiff(eq.next_maintenance_date);
                  const urgent = d <= 7;
                  return (
                    <div key={eq.id} className="rdash-rank-item" style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <div className="rdash-rank-item__pos" style={{ background: urgent ? "#fef2f2" : "#fff7ed", color: urgent ? "#dc2626" : "#d97706" }}>
                        {d}d
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="rdash-rank-item__name">{eq.name}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{eq.brand} · {eq.location || "—"}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: urgent ? "#dc2626" : "#d97706" }}>
                        {fDate(eq.next_maintenance_date)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e8ecf2" }}>
              <button
                style={{ width: "100%", padding: "10px", background: "#f8fafc", border: "1px solid #e8ecf2", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#334155" }}
                onClick={() => onNavigate("equipment")}
              >
                Ver todos los equipos →
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
