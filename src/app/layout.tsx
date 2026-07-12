// [Design System] Roboto via next/font/google + Material Symbols CDN
import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BoekBrug — Financieel Command Center",
  description: "Eén plek voor al je facturen, documenten en klanten. Voor ZZP'ers en boekhouders.",
  icons: {
    icon: "/favicon.ico",
  },
  // [SEO] Twitter/X card — makes shared links render a large image card on
  // X, Slack, WhatsApp, etc. Image comes from the site-wide opengraph-image.
  twitter: {
    card: "summary_large_image",
    title: "BoekBrug — Financieel Command Center",
    description: "Al je facturen, documenten en klanten op één plek. Voor ZZP'ers en boekhouders.",
    images: ["/opengraph-image"],
  },
};

// [Design System] theme-color drives the browser UI tint (mobile address bar,
// PWA chrome). Uses the BoekBrug blue accent.
export const viewport: Viewport = {
  themeColor: "#007aff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${roboto.variable} h-full antialiased`}
    >
      <head>
        {/* [Design System] Material Symbols — icon font only, CDN is acceptable */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        {/* [ANALYTICS] Vercel Web Analytics — cookieless & privacy-friendly, so
            no consent banner is required. Only reports on Vercel deploys. */}
        <Analytics />
      </body>
    </html>
  );
}