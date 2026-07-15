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

function getTodaySeenKey(userId, today = todayISO()) {
  return `crm_daily_message_seen:${userId}:${today}`;
}

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function useDailyMotivation(userId) {
  const [showPopup, setShowPopup]   = useState(false);
  const [message,   setMessage]     = useState(null);
  const [loading,   setLoading]     = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let midnightTimer = null;

    async function check() {
      savedRef.current = false; // resetear para el nuevo día
      setLoading(true);
      try {
        const today = todayISO();
        const seenKey = getTodaySeenKey(userId, today);

        if (typeof window !== "undefined" && localStorage.getItem(seenKey)) {
          if (!cancelled) {
            setShowPopup(false);
            setMessage(null);
          }
          return;
        }

        // 1. Already viewed today?
        let existing = null;
        const { data: existingData, error: viewErr } = await supabase
          .from("user_daily_message_views")
          .select("id")
          .eq("user_id", userId)
          .eq("view_date", today)
          .maybeSingle();

        if (viewErr) {
          log("view check warning:", viewErr.message);
        } else if (existingData) {
          existing = existingData;
        }

        if (existing) return;

        // 2. Scheduled message for today?
        const { data: scheduled, error: scheduledErr } = await supabase
          .from("daily_motivational_messages")
          .select("id, message, subtitle, category")
          .eq("is_active", true)
          .eq("scheduled_date", today)
          .limit(1)
          .maybeSingle();

        let picked = scheduled ?? null;

        if (scheduledErr) {
          log("scheduled message warning:", scheduledErr.message);
        }

        // 3. Random from unscheduled pool
        if (!picked) {
          const { data: pool, error: poolErr } = await supabase
            .from("daily_motivational_messages")
            .select("id, message, subtitle, category")
            .eq("is_active", true)
            .is("scheduled_date", null);

          if (poolErr) {
            log("pool message warning:", poolErr.message);
          }

          if (pool && pool.length > 0) {
            picked = pool[Math.floor(Math.random() * pool.length)];
          }
        }

        if (!picked) {
          picked = {
            id: "fallback",
            message: "Hoy es un buen día para dar un paso más.",
            subtitle: "Seguimos adelante con calma y foco.",
            category: "general",
          };
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

    function scheduleNextMidnight() {
      const ms = msUntilMidnight();
      midnightTimer = setTimeout(() => {
        if (!cancelled) {
          check();
          scheduleNextMidnight(); // reprogramar para la siguiente medianoche
        }
      }, ms);
    }

    check();
    scheduleNextMidnight();

    return () => {
      cancelled = true;
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, [userId]);

  const closePopup = useCallback(async () => {
    setShowPopup(false);

    if (!userId || !message || savedRef.current) return;
    savedRef.current = true;

    try {
      const today = todayISO();
      const seenKey = getTodaySeenKey(userId, today);
      if (typeof window !== "undefined") localStorage.setItem(seenKey, "1");

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
