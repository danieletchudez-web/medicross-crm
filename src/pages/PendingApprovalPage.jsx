import { supabase } from "../lib/supabaseClient";

export default function PendingApprovalPage({ profile }) {
  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Acceso pendiente</h1>
        <p>
          Tu usuario fue creado correctamente, pero todavía no fue aprobado por el
          administrador.
        </p>

        <div className="pending-box">
          <strong>{profile?.email}</strong>
          <span>Estado: pendiente de aprobación</span>
        </div>

        <button onClick={logout}>Cerrar sesión</button>
      </div>
    </div>
  );
}