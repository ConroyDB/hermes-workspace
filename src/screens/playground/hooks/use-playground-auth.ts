import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase, type Json, type Profile } from '@/lib/supabase'
import type { PlaygroundItemId, PlayerProfile } from '../lib/playground-rpg'

export const FOUNDER_REWARD_IDS: PlaygroundItemId[] = [
  'founder-cape',
  'founder-banner',
  'aether-50',
  'coins-1000',
  'trader-trial',
  'founder-title',
  'founder-pet',
]

type AuthStatus = 'guest' | 'loading' | 'signed-in' | 'error'

export type PlaygroundAuthState = {
  configured: boolean
  status: AuthStatus
  session: Session | null
  profile: Profile | null
  error: string | null
}

function asRewardIds(value: Json | undefined): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (typeof value === 'object') {
    const rewards = (value as { founder_vault?: unknown; rewards?: unknown }).founder_vault
      ?? (value as { rewards?: unknown }).rewards
    if (Array.isArray(rewards)) return rewards.filter((entry): entry is string => typeof entry === 'string')
    return Object.entries(value)
      .filter(([, claimed]) => Boolean(claimed))
      .map(([id]) => id)
  }
  return []
}

export function profileToPlayerPatch(profile: Profile): Partial<PlayerProfile> {
  const username = profile.username?.trim() || profile.display_name?.trim() || ''
  const claimedRewards = asRewardIds(profile.claimed_rewards)
  const founderClaimed = Boolean(profile.founder_claimed) || FOUNDER_REWARD_IDS.every((id) => claimedRewards.includes(id))
  return {
    userId: profile.id,
    username: username || null,
    displayName: username,
    avatarUrl: profile.avatar_url,
    founderRank: profile.founder_rank,
    isFounder: Boolean(profile.is_founder),
    founderClaimed,
    claimedRewards,
    inventory: claimedRewards.filter((id): id is PlaygroundItemId => FOUNDER_REWARD_IDS.includes(id as PlaygroundItemId)),
  }
}

export function usePlaygroundAuth(onProfile?: (patch: Partial<PlayerProfile>, profile: Profile) => void) {
  const [state, setState] = useState<PlaygroundAuthState>({
    configured: isSupabaseConfigured,
    status: isSupabaseConfigured ? 'loading' : 'guest',
    session: null,
    profile: null,
    error: null,
  })

  const loadProfile = useCallback(async (session: Session | null) => {
    if (!isSupabaseConfigured || !session?.user?.id) {
      setState((prev) => ({ ...prev, status: 'guest', session: null, profile: null, error: null }))
      return null
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()

      if (error) throw error

      const fallbackProfile: Profile = {
        id: session.user.id,
        username: null,
        display_name: session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? null,
        avatar_url: session.user.user_metadata?.avatar_url ?? null,
        is_founder: false,
        founder_rank: null,
        founder_claimed: false,
        claimed_rewards: [],
      }
      const profile = data ?? fallbackProfile
      setState({ configured: true, status: 'signed-in', session, profile, error: null })
      onProfile?.(profileToPlayerPatch(profile), profile)
      return profile
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Supabase profile unavailable'
      setState((prev) => ({ ...prev, status: 'error', session, error: message }))
      return null
    }
  }, [onProfile])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!isSupabaseConfigured) return
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!cancelled) void loadProfile(data.session)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Auth unavailable'
          setState((prev) => ({ ...prev, status: 'error', error: message }))
        }
      }
    }
    void boot()
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!isSupabaseConfigured) {
      window.location.href = '/auth/signin'
      return
    }
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    }).catch(() => {
      window.location.href = '/auth/signin'
    })
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Guest fallback: local save remains intact.
    }
    setState((prev) => ({ ...prev, status: 'guest', session: null, profile: null, error: null }))
  }, [])

  const syncUsername = useCallback(async (username: string) => {
    const clean = username.trim()
    if (!clean) return { ok: false, error: 'Choose a builder name first.' }
    if (!isSupabaseConfigured || !state.session?.user?.id) return { ok: true as const }

    try {
      const { data: existing, error: lookupError } = await (supabase.from('profiles') as any)
        .select('id, username')
        .eq('username', clean)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (existing && existing.id !== state.session.user.id) {
        return { ok: false, error: 'That builder name is already claimed.' }
      }

      const { data, error } = await (supabase.from('profiles') as any)
        .upsert({ id: state.session.user.id, username: clean, display_name: clean }, { onConflict: 'id' })
        .select('*')
        .single()
      if (error) throw error
      if (data) {
        setState((prev) => ({ ...prev, profile: data }))
        onProfile?.(profileToPlayerPatch(data), data)
      }
      return { ok: true as const }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sync username. Guest save kept locally.'
      return { ok: false, error: message }
    }
  }, [onProfile, state.session])

  const claimFounderVault = useCallback(async () => {
    if (!isSupabaseConfigured || !state.session?.user?.id) {
      return { ok: false, error: 'Sign in to claim the Founder Vault.' }
    }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_founder_vault')
      if (error) throw error
      const profile = Array.isArray(data) ? data[0] : data && typeof data === 'object' && 'id' in data ? data as Profile : null
      const claimedRewards = profile ? asRewardIds(profile.claimed_rewards) : FOUNDER_REWARD_IDS
      if (profile) {
        setState((prev) => ({ ...prev, profile }))
        onProfile?.(profileToPlayerPatch(profile), profile)
      }
      return { ok: true as const, rewardIds: claimedRewards.length ? claimedRewards : FOUNDER_REWARD_IDS }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Founder Vault claim failed.'
      return { ok: false, error: message }
    }
  }, [onProfile, state.session])

  return useMemo(() => ({
    ...state,
    signIn,
    signOut,
    syncUsername,
    claimFounderVault,
  }), [claimFounderVault, signIn, signOut, state, syncUsername])
}
