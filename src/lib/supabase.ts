import { createClient } from '@supabase/supabase-js';

// Placeholders match `.github/workflows/ci.yml` so `next build` can collect routes
// without a local `.env.local`. Set real values for production and local dev.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder';

// Use service role key for server-side operations (bypasses RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey);
