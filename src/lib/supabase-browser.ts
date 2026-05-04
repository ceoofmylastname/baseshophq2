/**
 * Browser Supabase client. Singleton.
 *
 * SECURITY:
 * This client uses the publishable / anon key only. The service role key NEVER
 * lives in browser code. RLS enforces all access control. Sensitive operations
 * (signup provisioning, engine recalc dispatch, etc.) live in Edge Functions
 * that hold service role internally via Supabase's auto-injected
 * SUPABASE_SERVICE_ROLE_KEY env var.
 */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local",
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const SUPABASE_FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? `${url}/functions/v1`;
