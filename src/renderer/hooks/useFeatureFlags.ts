import { useEffect, useMemo, useState } from 'react'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import {
  FEATURE_FLAG_DEFAULTS,
  parseFeatureFlagValue,
  type FeatureFlagKey
} from '../../shared/constants/feature-flags'

export function useFeatureFlag(flag: FeatureFlagKey): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState<boolean>(FEATURE_FLAG_DEFAULTS[flag])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    window.api
      .invoke<string | null>(IPC_CHANNELS.SETTINGS_GET, flag)
      .then((value) => {
        if (cancelled) return
        setEnabled(parseFeatureFlagValue(value, FEATURE_FLAG_DEFAULTS[flag]))
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled(FEATURE_FLAG_DEFAULTS[flag])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [flag])

  return { enabled, loading }
}

export function useFeatureFlags(flags: FeatureFlagKey[]): {
  values: Record<FeatureFlagKey, boolean>
  loading: boolean
} {
  const [values, setValues] = useState<Record<FeatureFlagKey, boolean>>({
    ...FEATURE_FLAG_DEFAULTS
  })
  const [loading, setLoading] = useState<boolean>(true)

  const flagsKey = useMemo(
    () => [...new Set(flags)].sort().join('|'),
    [flags.join('|')]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const stableFlags = flagsKey
      ? (flagsKey.split('|') as FeatureFlagKey[])
      : []

    Promise.all(
      stableFlags.map((flag) =>
        window.api
          .invoke<string | null>(IPC_CHANNELS.SETTINGS_GET, flag)
          .then((value) => [flag, parseFeatureFlagValue(value, FEATURE_FLAG_DEFAULTS[flag])] as const)
          .catch(() => [flag, FEATURE_FLAG_DEFAULTS[flag]] as const)
      )
    )
      .then((entries) => {
        if (cancelled) return
        const next = {} as Record<FeatureFlagKey, boolean>
        for (const [flag, value] of entries) {
          next[flag] = value
        }
        setValues(next)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [flagsKey])

  return { values, loading }
}
