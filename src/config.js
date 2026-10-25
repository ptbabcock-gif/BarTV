// Cloud configuration for shared groups. Fill these in from your Supabase project:
// Project Settings -> API -> "Project URL" and the "anon public" key.
// The anon key is designed to be public; row-level security in supabase/schema.sql
// is what protects the data. Leave both empty to run the app in solo (device-only) mode.
export const CLOUD = globalThis.__CHEERS_CLOUD__ || {
  url: '',
  anonKey: '',
};
// `globalThis.__CHEERS_CLOUD__` is an override hook used by the browser tests.
