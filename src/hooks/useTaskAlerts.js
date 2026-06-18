import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const SNOOZE_KEY = "crm_task_snooze";

export function getSnoozeMap() {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); }
  catch { return {}; }
}

export function snoozeTask(taskId, untilMs) {
  const map = getSnoozeMap();
  const now = Date.now();
  Object.keys(map).forEach(k => { if (map[k] < now) delete map[k]; });
  map[taskId] = untilMs;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event("crm:task-snooze-updated"));
}

export function dismissTask(taskId) {
  const eod = new Date(); eod.setHours(23, 59, 59, 999);
  snoozeTask(taskId, eod.getTime());
}

export function isSnoozed(taskId) {
  const map = getSnoozeMap();
  return Boolean(map[taskId] && map[taskId] > Date.now());
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date  = new Date(value); date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / 86400000);
}

export default function useTaskAlerts(profileId) {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (!profileId) return;
    let active = true;

    async function load() {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("tasks")
        .select("id, title, due_date, status, priority")
        .in("status", ["pendiente", "en_progreso"])
        .not("due_date", "is", null)
        .lte("due_date", today)
        .or(`created_by.eq.${profileId},assigned_to.eq.${profileId}`);

      if (!active) return;
      const filtered = (data || [])
        .filter(t => !isSnoozed(t.id))
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
      setAlerts(filtered);
    }

    function onSnooze() {
      setAlerts(prev => prev.filter(t => !isSnoozed(t.id)));
    }

    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    window.addEventListener("crm:task-snooze-updated", onSnooze);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("crm:task-snooze-updated", onSnooze);
    };
  }, [profileId]);

  return { alerts, count: alerts.length };
}
