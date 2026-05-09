import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import { calculateClientScore } from "../services/clientScoring";

export default function ClientInsightsPage({ profile, onNavigate }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: clients } = await supabase.from("clients").select("*");
    const { data: visits } = await supabase.from("visits").select("*");
    const { data: opps } = await supabase.from("opportunities").select("*");

    const enriched = clients.map(client => {
      const scoreData = calculateClientScore(client, visits, opps);

      return {
        ...client,
        ...scoreData,
      };
    });

    setData(enriched.sort((a, b) => b.score - a.score));
  }

  return (
    <Layout profile={profile} onNavigate={onNavigate}>
      <h1>Prioridad de Clientes</h1>

      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Score</th>
            <th>Estado</th>
            <th>Días sin visita</th>
            <th>Prioridad</th>
          </tr>
        </thead>

        <tbody>
          {data.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.score}</td>
              <td>
                <span className={`status ${c.status}`}>
                  {c.status}
                </span>
              </td>
              <td>{c.daysWithoutVisit}</td>
              <td>{c.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}