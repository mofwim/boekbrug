'use client'

import { registerAdProvider } from './ads'

interface GdSdk {
  showAd: (type?: string) => Promise<void>
  preloadAd?: (type?: string) => Promise<void>
}

declare global {
  interface Window {
    GD_OPTIONS?: unknown
    gdsdk?: GdSdk
  }
}

let rewardEarned = false

export function initGameDistribution(gameId: string) {
  if (typeof window === 'undefined' || !gameId) return

  window.GD_OPTIONS = {
    gameId,
    onEvent: (event: { name: string }) => {
      if (event.name === 'SDK_REWARDED_WATCH_COMPLETE') {
        rewardEarned = true
      }
    },
  }

  // Inject SDK
  ;((d: Document, s: string, id: string) => {
    if (d.getElementById(id)) return
    const fjs = d.getElementsByTagName(s)[0]
    const js = d.createElement(s) as HTMLScriptElement
    js.id = id
    js.src = 'https://html5.api.gamedistribution.com/main.min.js'
    fjs.parentNode?.insertBefore(js, fjs)
  })(document, 'script', 'gamedistribution-jssdk')

  registerAdProvider({
    showInterstitial: async () => {
      try {
        await window.gdsdk?.showAd()
      } catch {
        /* no fill */
      }
    },
    showRewarded: async () => {
      rewardEarned = false
      try {
        await window.gdsdk?.preloadAd?.('rewarded')
        await window.gdsdk?.showAd('rewarded')
      } catch {
        /* skipped */
      }
      return rewardEarned
    },
  })
}
