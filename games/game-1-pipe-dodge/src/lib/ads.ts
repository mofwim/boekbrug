// Ad provider abstraction for multiple platforms

interface AdProvider {
  showInterstitial: () => Promise<void>
  showRewarded: () => Promise<boolean>
}

let adProvider: AdProvider | null = null

export function registerAdProvider(provider: AdProvider) {
  adProvider = provider
}

export async function showInterstitialAd() {
  if (!adProvider) return
  try {
    await adProvider.showInterstitial()
  } catch {
    // Silently fail if ads unavailable
  }
}

export async function showRewardedAd(): Promise<boolean> {
  if (!adProvider) return false
  try {
    return await adProvider.showRewarded()
  } catch {
    return false
  }
}
