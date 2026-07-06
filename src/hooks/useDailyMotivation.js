import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const isDev = import.meta.env.DEV;

function log(...args) {
  if (isDev) console.warn("[useDailyMotivation]", ...args);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useDailyMotivation(userId) {
  const [showPopup, setShowPopup]   = useState(false);
  const [message,   setMessage]     = useState(null);
  const [loading,   setLoading]     = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    async function check() {
      setLoading(true);
      try {
        const today = todayISO();

        // 1. Already viewed today?
        const { data: existing, error: viewErr } = await supabase
          .from("user_daily_message_views")
          .select("id")
          .eq("user_id", userId)
          .eq("view_date", today)
          .maybeSingle();

        if (viewErr) { log("view check error:", viewErr.message); return; }
        if (existing) return;

        // 2. Scheduled message for today?
        const { data: scheduled } = await supabase
          .from("daily_motivational_messages")
          .select("id, message, subtitle, category")
          .eq("is_active", true)
          .eq("scheduled_date", today)
          .limit(1)
          .maybeSingle();

        let picked = scheduled ?? null;

        // 3. Random from unscheduled pool
        if (!picked) {
          const { data: pool } = await supabase
            .from("daily_motivational_messages")
            .select("id, message, subtitle, category")
            .eq("is_active", true)
            .is("scheduled_date", null);

          if (pool && pool.length > 0) {
            picked = pool[Math.floor(Math.random() * pool.length)];
          }
        }

        if (!cancelled && picked) {
          setMessage(picked);
          setShowPopup(true);
        }
      } catch (err) {
        log("unexpected error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [userId]);

  const closePopup = useCallback(async () => {
    setShowPopup(false);

    if (!userId || !message || savedRef.current) return;
    savedRef.current = true;

    try {
      const today = todayISO();
      const { error } = await supabase
        .from("user_daily_message_views")
        .insert({ user_id: userId, message_id: message.id, view_date: today });

      if (error) log("could not save view:", error.message);
    } catch (err) {
      log("save view error:", err);
    }
  }, [userId, message]);

  return { showPopup, message, loading, closePopup };
}
