import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function useNotificationCount(profileId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profileId) return;
    let active = true;

    async function loadCount() {
      const { count: unread, error } = await supabase
        .from("crm_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", profileId)
        .is("read_at", null);
      if (active && !error) setCount(unread || 0);
    }

    function onUpdate(e) {
      // NotificationsPage broadcasts legacyCount when DB table is unavailable
      if (e.detail?.legacyCount !== undefined) {
        if (active) setCount(e.detail.legacyCount);
      } else {
        loadCount();
      }
    }

    loadCount();
    const timer = window.setInterval(loadCount, 60000);
    window.addEventListener("crm:notifications-updated", onUpdate);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("crm:notifications-updated", onUpdate);
    };
  }, [profileId]);

  return count;
}
