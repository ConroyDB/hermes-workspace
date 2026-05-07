import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Profile = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  discord_id?: string | null
  x_handle?: string | null
  is_founder: boolean
  founder_rank: number | null
  founder_claimed?: boolean | null
  claimed_rewards: Json
  created_at?: string
  updated_at?: string | null
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Partial<Omit<Profile, 'id'>> & { id: string }
        Update: Partial<Profile>
      }
    }
    Functions: {
      claim_founder_vault: {
        Args: Record<string, never>
        Returns: Profile | Profile[] | Json
      }
    }
  }
}

type HermesSupabaseClient = SupabaseClient<Database>

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}

export const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? ''
export const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

function createMockSupabaseClient(): HermesSupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    upsert: () => builder,
    update: () => builder,
  }

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { id: 'mock', callback: () => undefined, unsubscribe: () => undefined } } }),
      signInWithOAuth: async () => ({ data: { provider: 'google', url: '' }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => builder,
    rpc: async () => ({ data: null, error: null }),
  } as unknown as HermesSupabaseClient
}

export const supabase: HermesSupabaseClient = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (createMockSupabaseClient() as HermesSupabaseClient)
