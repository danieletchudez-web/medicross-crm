import { createClient } from "@supabase/supabase-js";

const cookieStorage = {
  getItem(key) {
    const prefix = `${encodeURIComponent(key)}=`;
    const found = document.cookie.split("; ").find(entry => entry.startsWith(prefix));
    if (found) return decodeURIComponent(found.slice(prefix.length));
    const legacy = window.localStorage.getItem(key);
    if (legacy) this.setItem(key, legacy);
    return legacy;
  },
  setItem(key, value) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.localStorage.setItem(key, value);
  },
  removeItem(key) {
    document.cookie = `${encodeURIComponent(key)}=; Path=/; Max-Age=0; SameSite=Lax`;
    window.localStorage.removeItem(key);
  },
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: cookieStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
