import { useCallback, useEffect, useState } from 'react'
import { EMPTY_SESSION, type EstimateSession, clearSession, loadSession, saveSession } from '@/lib/estimate-session'

/**
 * React state for the estimator, mirrored to sessionStorage on every change (MOVERS-12).
 * `init` lets a page seed the state (for example the sample move) instead of reading the saved one.
 */
export function useEstimateSession(init: () => EstimateSession = loadSession) {
  const [session, setSession] = useState<EstimateSession>(init)

  useEffect(() => {
    saveSession(session)
  }, [session])

  const update = useCallback(
    (change: Partial<EstimateSession> | ((current: EstimateSession) => Partial<EstimateSession>)) => {
      setSession((current) => ({ ...current, ...(typeof change === 'function' ? change(current) : change) }))
    },
    [],
  )

  const reset = useCallback((next: EstimateSession = EMPTY_SESSION) => {
    clearSession()
    setSession(next)
  }, [])

  return { session, update, reset }
}
