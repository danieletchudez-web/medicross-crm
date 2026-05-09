import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuth();

    const { data } = supabase.auth.onAuthStateChange(() => {
      loadAuth();
    });

    return () => data.subscription.unsubscribe();
  }, []);

  async function loadAuth() {
    setLoading(true);

    const { data } = await supabase.auth.getSession();
    const currentSession = data.session;

    setSession(currentSession);

    if (currentSession?.user) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentSession.user.id)
        .maybeSingle();

      setProfile(profileData || null);
    } else {
      setProfile(null);
    }

    setLoading(false);
  }

  return { session, profile, loading, reloadAuth: loadAuth };
}