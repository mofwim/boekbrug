import type { NextConfig } from 'next'

const isPortal = process.env.PORTAL_EXPORT === 'true'

const config: NextConfig = {
  ...(isPortal && {
    assetPrefix: './',
    basePath: '',
  }),
  compress: true,
  productionBrowserSourceMaps: false,
}

export default config
