import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

/* ─── Colores corporativos ─────────────────────────────────────────────── */
const COLORS = ['#0e5fa8','#2596d4','#16a34a','#d97706','#7c3aed','#db2777','#0891b2','#65a30d'];
const MESES  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/* ─── Helpers ──────────────────────────────────────────────────────────── */
const parseN = (s) => parseFloat(String(s || '').replace(',', '.')) || 0;

function calcGMfromDoc(doc) {
  const tc   = parseN(doc.tc) || 1425;
  const rens = doc.renglones || [];
  if (!rens.length) return 0;
  let totalPV = 0, totalC = 0;
  rens.forEach(r => {
    const cr = parseN(r.costo); if (!cr) return;
    const mult = parseN(r.markup) || 2;
    const mon  = r.moneda || 'USD';
    const cARS = mon === 'ARS' ? cr : cr * tc;
    const cant = parseInt(r.cant) || 1;
    totalPV += cARS * mult * cant;
    totalC  += cARS * cant;
  });
  return totalPV > 0 ? (totalPV - totalC) / totalPV * 100 : 0;
}

function formatARS(n) {
  if (n >= 1e9) return '$ ' + (n / 1e9).toFixed(1) + 'MM';
  if (n >= 1e6) return '$ ' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$ ' + (n / 1e3).toFixed(0) + 'K';
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0 });
}
function formatARSFull(n) {
  return '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
}
function avgGM(docs) {
  const valid = docs.filter(d => d._gm > 0);
  return valid.length ? valid.reduce((s, d) => s + d._gm, 0) / valid.length : 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
══════════════════════════════════════════════════════════════════════════ */
export default function DashboardComercial() {
  const [rawData,    setRawData]    = useState([]);
  const [filtered,   setFiltered]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [collapsed,  setCollapsed]  = useState(false);
  const [status,     setStatus]     = useState('');

  /* Filtros */
  const [fYear,    setFYear]    = useState('');
  const [fMonth,   setFMonth]   = useState('');
  const [fVendedor,setFVendedor]= useState('');
  const [years,    setYears]    = useState([]);
  const [vendedores, setVendedores] = useState([]);

  /* Tabla */
  const [sortCol, setSortCol] = useState(-1);
  const [sortAsc, setSortAsc] = useState(true);

  /* Chart refs */
  const refDonut   = useRef(null);
  const refBars    = useRef(null);
  const refVBar    = useRef(null);
  const refLine    = useRef(null);
  const charts     = useRef({});

  /* ── Cargar datos ── */
  useEffect(() => {
    loadData();
    return () => destroyAllCharts();
  }, []);

  async function loadData() {
    setLoading(true);
    setStatus('Cargando...');
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) { setStatus('Error: ' + error.message); setLoading(false); return; }

    const docs = (data || []).map(d => ({
      ...d,
      _date:  d.created_at ? new Date(d.created_at) : null,
      _gm:    calcGMfromDoc(d),
      _total: parseN(d.total_general),
    }));

    setRawData(docs);
    setStatus(docs.length + ' cotizaciones cargadas');

    /* opciones de filtro */
    const ys = [...new Set(docs.filter(d => d._date).map(d => d._date.getFullYear()))].sort((a,b)=>b-a);
    const vs = [...new Set(docs.filter(d => d.vendedor).map(d => d.vendedor))].sort();
    setYears(ys);
    setVendedores(vs);
    setLoading(false);
  }

  /* ── Aplicar filtros ── */
  useEffect(() => {
    let f = rawData;
    if (fYear)    f = f.filter(d => d._date && String(d._date.getFullYear()) === fYear);
    if (fMonth !== '') f = f.filter(d => d._date && String(d._date.getMonth()) === fMonth);
    if (fVendedor)f = f.filter(d => d.vendedor === fVendedor);
    setFiltered(f);
  }, [rawData, fYear, fMonth, fVendedor]);

  /* ── Dibujar charts cuando filtered cambia ── */
  useEffect(() => {
    if (!loading) {
      // pequeño delay para asegurar que el DOM esté listo
      const t = setTimeout(() => renderCharts(), 80);
      return () => clearTimeout(t);
    }
  }, [filtered, loading]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!loading) setTimeout(() => renderCharts(), 80);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [filtered, loading]);

  /* ── KPIs ── */
  const now       = new Date();
  const thisYear  = now.getFullYear();
  const thisMonth = now.getMonth();
  const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const prevYear  = thisMonth === 0 ? thisYear - 1 : thisYear;

  const filterBy = useCallback((yr, mo) => rawData.filter(d => {
    if (!d._date) return false;
    if (String(d._date.getFullYear()) !== String(yr)) return false;
    if (mo !== null && d._date.getMonth() !== mo) return false;
    return true;
  }), [rawData]);

  const thisYearDocs  = filterBy(thisYear, null);
  const prevYearDocs  = filterBy(thisYear - 1, null);
  const thisMonthDocs = filterBy(thisYear, thisMonth);
  const prevMonthDocs = filterBy(prevYear, prevMonth);

  const gmThisYear = avgGM(thisYearDocs);
  const gmPrevYear = avgGM(prevYearDocs);
  const gmThisMon  = avgGM(thisMonthDocs);
  const gmPrevMon  = avgGM(prevMonthDocs);
  const totalMes   = thisMonthDocs.reduce((s, d) => s + d._total, 0);

  /* ── Charts ── */
  function destroyAllCharts() {
    Object.values(charts.current).forEach(c => { try { c.destroy(); } catch { /* ignore chart cleanup */ } });
    charts.current = {};
  }
  function destroyChart(key) {
    if (charts.current[key]) { try { charts.current[key].destroy(); } catch { /* ignore chart cleanup */ } delete charts.current[key]; }
  }

  async function renderCharts() {
    if (typeof window === 'undefined') return;
    // Cargar Chart.js si no está
    if (!window.Chart) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const Chart = window.Chart;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textC  = isDark ? '#8a9bb0' : '#6b6b6b';
    const gridC  = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';

    /* A) Donut — por vendedor */
    if (refDonut.current) {
      destroyChart('donut');
      const counts = {};
      filtered.forEach(d => { const v = d.vendedor || 'Sin asignar'; counts[v] = (counts[v] || 0) + 1; });
      const labels = Object.keys(counts);
      const data   = labels.map(l => counts[l]);
      if (labels.length) {
        charts.current.donut = new Chart(refDonut.current, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: isDark ? '#222830' : '#fff', hoverOffset: 6 }] },
          options: { responsive: true, maintainAspectRatio: false, cutout: '62%', animation: { duration: 600 },
            plugins: { legend: { position: 'bottom', labels: { color: textC, font: { size: 11 }, padding: 12, boxWidth: 10 } },
              tooltip: { callbacks: { label: c => { const tot = c.dataset.data.reduce((a,b)=>a+b,0); return ' '+c.label+': '+c.parsed+' ('+Math.round(c.parsed/tot*100)+'%)'; } } }
            }
          }
        });
      }
    }

    /* B) Barras — por mes */
    if (refBars.current) {
      destroyChart('bars');
      const counts = new Array(12).fill(0);
      filtered.forEach(d => { if (d._date) counts[d._date.getMonth()]++; });
      charts.current.bars = new Chart(refBars.current, {
        type: 'bar',
        data: { labels: MESES, datasets: [{ label: 'Cotizaciones', data: counts, backgroundColor: 'rgba(14,95,168,.75)', borderColor: '#0e5fa8', borderWidth: 0, borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
          plugins: { legend: { display: false } },
          scales: { x: { grid: { color: gridC }, ticks: { color: textC, font: { size: 10 } } }, y: { grid: { color: gridC }, ticks: { color: textC, font: { size: 10 }, precision: 0 }, beginAtZero: true } }
        }
      });
    }

    /* C) Barras horizontales — facturación por vendedor */
    if (refVBar.current) {
      destroyChart('vbar');
      const totals = {};
      filtered.forEach(d => { const v = d.vendedor || 'Sin asignar'; totals[v] = (totals[v] || 0) + d._total; });
      const labels = Object.keys(totals);
      const data   = labels.map(l => totals[l]);
      if (labels.length) {
        charts.current.vbar = new Chart(refVBar.current, {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Total ARS', data, backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'cc'), borderColor: COLORS.slice(0, labels.length), borderWidth: 1, borderRadius: 5 }] },
          options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', animation: { duration: 600 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + formatARSFull(c.parsed.x) } } },
            scales: { x: { grid: { color: gridC }, ticks: { color: textC, font: { size: 10 }, callback: v => formatARS(v) } }, y: { grid: { display: false }, ticks: { color: textC, font: { size: 11 } } } }
          }
        });
      }
    }

    /* D) Línea — GM mensual */
    if (refLine.current) {
      destroyChart('line');
      const byMonth = Array.from({ length: 12 }, () => []);
      filtered.forEach(d => { if (d._date && d._gm > 0) byMonth[d._date.getMonth()].push(d._gm); });
      const data = byMonth.map(arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null);
      charts.current.line = new Chart(refLine.current, {
        type: 'line',
        data: { labels: MESES, datasets: [{ label: 'GM %', data, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.08)', borderWidth: 2.5, pointBackgroundColor: '#16a34a', pointRadius: 4, pointHoverRadius: 6, tension: .4, fill: true, spanGaps: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' GM: ' + c.parsed.y + '%' } } },
          scales: { x: { grid: { color: gridC }, ticks: { color: textC, font: { size: 10 } } }, y: { grid: { color: gridC }, ticks: { color: textC, font: { size: 10 }, callback: v => v + '%' }, beginAtZero: false } }
        }
      });
    }
  }

  /* ── Tabla resumen por vendedor ── */
  const tableData = (() => {
    const byVend = {};
    filtered.forEach(d => {
      const v = d.vendedor || 'Sin asignar';
      if (!byVend[v]) byVend[v] = { vendedor: v, count: 0, total: 0, gms: [] };
      byVend[v].count++;
      byVend[v].total += d._total;
      if (d._gm > 0) byVend[v].gms.push(d._gm);
    });
    return Object.values(byVend).map(r => ({
      ...r,
      gmAvg:  r.gms.length ? r.gms.reduce((a,b)=>a+b,0)/r.gms.length : 0,
      ticket: r.count > 0 ? r.total / r.count : 0,
    }));
  })();

  const sortedTable = [...tableData].sort((a, b) => {
    if (sortCol < 0) return 0;
    const keys = ['vendedor', 'count', 'total', 'gmAvg', 'ticket'];
    const va = a[keys[sortCol]], vb = b[keys[sortCol]];
    return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });

  const handleSort = (col) => {
    setSortAsc(sortCol === col ? !sortAsc : true);
    setSortCol(col);
  };

  const gmClass = (gm) => gm >= 40 ? '#16a34a' : gm >= 25 ? '#d97706' : '#dc2626';

  /* ── KPI helper ── */
  const KPICard = ({ label, value, dir, trend, accent }) => (
    <div style={{
      background: 'var(--bg, #fff)', border: '.5px solid var(--bd, rgba(0,0,0,.11))',
      borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden', flex: '1 1 180px', minWidth: 0,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '12px 12px 0 0',
        background: accent || (dir === 'up' ? 'linear-gradient(90deg,#16a34a,#22c55e)' : dir === 'down' ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#0e5fa8,#2596d4)') }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9a9a9a', letterSpacing: '.02em', textTransform: 'uppercase', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.1, wordBreak: 'break-word' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: dir === 'up' ? '#16a34a' : dir === 'down' ? '#dc2626' : '#9a9a9a', display: 'flex', alignItems: 'center', gap: 3 }}>
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→'} {trend}
      </div>
    </div>
  );

  /* ── Render ── */
  return (
    <div style={{ background: 'var(--bg2, #f7f7f6)', border: '.5px solid var(--bd, rgba(0,0,0,.11))', borderRadius: 16, padding: 20, marginBottom: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Análisis Comercial</div>
          <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 2 }}>Indicadores y rendimiento de cotizaciones</div>
        </div>
        <button onClick={() => setCollapsed(c => !c)} style={{
          display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px',
          borderRadius: 99, background: 'var(--bg,#fff)', border: '.5px solid var(--bd2,rgba(0,0,0,.2))',
          color: 'var(--text2,#6b6b6b)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}>
          <span style={{ transform: collapsed ? 'rotate(-90deg)' : '', display: 'inline-block', transition: 'transform .2s' }}>▼</span>
          {collapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Filtros */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10,
            padding: '14px 16px', background: 'var(--bg,#fff)',
            borderRadius: 10, border: '.5px solid var(--bd,rgba(0,0,0,.11))', marginBottom: 18,
          }}>
            {[
              { label: 'Año', val: fYear, setter: setFYear, opts: years.map(y => ({ v: String(y), l: String(y) })) },
              { label: 'Mes', val: fMonth, setter: setFMonth, opts: MESES_FULL.map((m, i) => ({ v: String(i), l: m })) },
              { label: 'Vendedor', val: fVendedor, setter: setFVendedor, opts: vendedores.map(v => ({ v, l: v })) },
            ].map(({ label, val, setter, opts }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9a9a9a' }}>{label}</label>
                <select value={val} onChange={e => setter(e.target.value)} style={{
                  height: 34, padding: '0 28px 0 10px', borderRadius: 6, border: '.5px solid var(--bd2,rgba(0,0,0,.2))',
                  background: 'var(--bg2,#f7f7f6)', color: 'var(--text,#1a1a1a)', fontSize: 13, fontFamily: 'inherit',
                  outline: 'none', cursor: 'pointer', minWidth: 110, appearance: 'none',
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23999' d='M5 6L0 0h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
                }}>
                  <option value="">Todos</option>
                  {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            ))}
            <button onClick={() => { setFYear(''); setFMonth(''); setFVendedor(''); }} style={{
              height: 34, padding: '0 14px', borderRadius: 6, background: 'transparent',
              border: '.5px solid var(--bd2,rgba(0,0,0,.2))', color: '#6b6b6b', fontSize: 12,
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            }}>✕ Limpiar</button>
            <div style={{ fontSize: 11, color: '#9a9a9a', marginLeft: 'auto', alignSelf: 'center' }}>{loading ? 'Cargando...' : status}</div>
          </div>

          {/* KPIs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <KPICard
              label="GM Promedio — Año actual"
              value={gmThisYear.toFixed(1) + '%'}
              dir={gmPrevYear > 0 ? (gmThisYear >= gmPrevYear ? 'up' : 'down') : 'neutral'}
              trend={gmPrevYear > 0 ? 'vs ' + (thisYear - 1) + ': ' + gmPrevYear.toFixed(1) + '%' : 'Sin datos año anterior'}
            />
            <KPICard
              label="GM Promedio — Mes actual"
              value={gmThisMon.toFixed(1) + '%'}
              dir={gmPrevMon > 0 ? (gmThisMon >= gmPrevMon ? 'up' : 'down') : 'neutral'}
              trend={gmPrevMon > 0 ? 'vs ' + MESES[prevMonth] + ': ' + gmPrevMon.toFixed(1) + '%' : 'Sin datos mes anterior'}
            />
            <KPICard
              label="Cotizaciones este mes"
              value={String(thisMonthDocs.length)}
              dir="neutral"
              trend={thisMonthDocs.length + ' cotizaci' + (thisMonthDocs.length === 1 ? 'ón' : 'ones')}
              accent="linear-gradient(90deg,#0e5fa8,#2596d4)"
            />
            <KPICard
              label="Monto cotizado este mes"
              value={formatARS(totalMes)}
              dir="neutral"
              trend="Total bruto c/IVA"
              accent="linear-gradient(90deg,#0e5fa8,#2596d4)"
            />
          </div>

          {/* Charts fila 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginBottom: 12 }}>
            <ChartCard title="Presupuestos por vendedor" sub="Distribución del período">
              <canvas ref={refDonut} />
            </ChartCard>
            <ChartCard title="Cotizaciones por mes" sub="Cantidad mensual">
              <canvas ref={refBars} />
            </ChartCard>
          </div>

          {/* Charts fila 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginBottom: 12 }}>
            <ChartCard title="Facturación cotizada por vendedor" sub="Total ARS">
              <canvas ref={refVBar} />
            </ChartCard>
            <ChartCard title="Evolución del Gross Margin" sub="Promedio mensual %">
              <canvas ref={refLine} />
            </ChartCard>
          </div>

          {/* Tabla resumen */}
          <div style={{ background: 'var(--bg,#fff)', border: '.5px solid var(--bd,rgba(0,0,0,.11))', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Resumen por vendedor</div>
            <div style={{ fontSize: 11, color: '#9a9a9a', marginBottom: 14 }}>Período filtrado</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
                <thead>
                  <tr>
                    {['Vendedor','Presupuestos','Total cotizado','GM Prom.','Ticket prom.'].map((h, i) => (
                      <th key={i} onClick={() => handleSort(i)} style={{
                        background: 'var(--bg3,#eef2f7)', color: '#6b6b6b', padding: '8px 12px',
                        textAlign: i === 0 ? 'left' : 'right', fontWeight: 700, fontSize: 11,
                        letterSpacing: '.04em', textTransform: 'uppercase', cursor: 'pointer',
                        userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))',
                      }}>
                        {h} <span style={{ opacity: .4, fontSize: 10 }}>{sortCol === i ? (sortAsc ? '↑' : '↓') : '↕'}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTable.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9a9a9a', padding: 24, fontStyle: 'italic' }}>Sin datos para el período</td></tr>
                  ) : sortedTable.map((r, i) => (
                    <tr key={r.vendedor} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg3,#eef2f7)' }}>
                      <td style={{ padding: '9px 12px', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))' }}>{r.vendedor}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))', textAlign: 'right' }}>{r.count}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))', textAlign: 'right' }}>{formatARSFull(r.total)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))', textAlign: 'right', fontWeight: 700, color: gmClass(r.gmAvg) }}>{r.gmAvg.toFixed(1)}%</td>
                      <td style={{ padding: '9px 12px', borderBottom: '.5px solid var(--bd,rgba(0,0,0,.11))', textAlign: 'right' }}>{formatARSFull(r.ticket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── ChartCard ────────────────────────────────────────────────────────── */
function ChartCard({ title, sub, children }) {
  return (
    <div style={{ background: 'var(--bg,#fff)', border: '.5px solid var(--bd,rgba(0,0,0,.11))', borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: '#9a9a9a', marginBottom: 14 }}>{sub}</div>
      <div style={{ position: 'relative', height: 200 }}>{children}</div>
    </div>
  );
}
