import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const ALL_VIEWS = [
  "dashboard",
  "campaigns",
  "clients",
  "contacts",
  "opportunities",
  "tasks",
  "visits",
  "forecasts",
  "admin",
];

export function useAccess() {
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [currentSeller, setCurrentSeller] = useState(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    loadAccess();
  }, []);

  async function loadAccess() {
    setLoadingAccess(true);

    const { data: authData } = await supabase.auth.getUser();
    const email = authData?.user?.email || "";

    setUserEmail(email);

    if (!email) {
      setCurrentSeller(null);
      setLoadingAccess(false);
      return;
    }

    const { data, error } = await supabase
      .from("sellers")
      .select("*")
      .ilike("email", email)
      .maybeSingle();

    if (error) {
      console.error("Error cargando acceso:", error.message);
    }

    setCurrentSeller(data || null);
    setLoadingAccess(false);
  }

  const access = useMemo(() => {
    if (!currentSeller) {
      return {
        role: "admin",
        active: true,
        allowedViews: ALL_VIEWS,
        isAdmin: true,
        isReadOnly: false,
      };
    }

    const role = currentSeller.role || "vendedor";
    const isAdmin = role === "admin";
    const isReadOnly = role === "lectura";

    let allowedViews = currentSeller.allowed_views || ["dashboard"];

    if (isAdmin) {
      allowedViews = ALL_VIEWS;
    }

    return {
      role,
      active: currentSeller.active !== false,
      allowedViews,
      isAdmin,
      isReadOnly,
    };
  }, [currentSeller]);

  function canAccess(view) {
    if (loadingAccess) return true;
    if (!access.active) return false;
    if (access.isAdmin) return true;
    return access.allowedViews.includes(view);
  }

  return {
    loadingAccess,
    userEmail,
    currentSeller,
    allowedViews: access.allowedViews,
    role: access.role,
    isAdmin: access.isAdmin,
    isReadOnly: access.isReadOnly,
    active: access.active,
    canAccess,
  };
}