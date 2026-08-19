// [Design System] Roboto via next/font/google + Material Symbols CDN
import type { Metadata, Viewport } from "next";
// [TAAL] Zie de kop van locale-boot.ts: de taal wordt met een script in <head> gezet en NIET met
// cookies() uit next/headers, want dat maakt élke route in de app dynamisch — inclusief de 53
// statisch gebouwde Arabische blogartikelen die de Arabische ondernemer hier brengen.
import { LOCALE_BOOT_SCRIPT } from "@/lib/i18n/locale-boot";
import { Roboto, Noto_Sans_Arabic } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";
import { ToastProvider } from "@/components/ui/Toast";
import { DialogProvider } from "@/components/ui/Dialog";
import "./globals.css";

// [Design System] "latin-ext" is added so Turkish glyphs (ş ğ ı İ) render in
// Roboto instead of falling back to a mismatched system font.
const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// [Design System] Arabic reads in Noto Sans Arabic — Google's Arabic companion
// to Roboto — so the RTL blog matches the Latin look instead of an inconsistent
// per-device system font. Exposed as --font-arabic; applied on Arabic pages.
const notoArabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BoekBrug — Financieel Command Center",
  // [BELOFTE] Zie src/lib/belofte.ts — hier letterlijk, want Next verlangt in de
  // metadata-export een statische waarde en geen import-expressie.
  description:
    "Je hoeft geen boekhouding te doen — alleen niets kwijt te raken. Fotografeer je bonnen of laat ze binnenkomen via je mail; aan het eind van het kwartaal staat alles klaar voor je boekhouder.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    // [ANDROID/iOS] Home-screen icon when BoekBrug is added to the home screen.
    apple: "/icons/apple-touch-icon.png",
  },
  // [SEO] Twitter/X card — makes shared links render a large image card on
  // X, Slack, WhatsApp, etc. Image comes from the site-wide opengraph-image.
  twitter: {
    card: "summary_large_image",
    title: "BoekBrug — Financieel Command Center",
    description:
      "Je hoeft geen boekhouding te doen — alleen niets kwijt te raken. Aan het eind van het kwartaal staat alles klaar voor je boekhouder.",
    images: ["/opengraph-image"],
  },
};

// [Design System] theme-color drives the browser UI tint (mobile address bar,
// PWA chrome). Uses the BoekBrug blue accent.
//
// [SAFE-AREA] viewportFit: "cover" is what makes env(safe-area-inset-*) resolve
// to a real value. Without it the browser letterboxes the page inside the safe
// area and every inset reports 0 — which is what used to happen here: the app
// already wrote `env(safe-area-inset-top)` into SubPageHeader, the invoice
// action bars and several FABs, and every one of those calculations silently
// evaluated to `+ 0px`. Turning it on activates the padding that was already
// written, so on a notched phone in standalone PWA mode the sticky headers
// clear the status bar and the bottom bars clear the home indicator.
// NB: the home bar (app/dashboard/_shared DashboardHeader) had no inset padding
// at all and was fixed in the same change — with cover enabled it would
// otherwise be the one bar that slides under the notch.
export const viewport: Viewport = {
  themeColor: "#1a73e8",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // The MARKUP says Dutch and stays that way: it is what gets built statically, for every
      // route at once, and reading a cookie or a header here would trade the SSG of 212 blog
      // articles for two attributes (see locale-boot.ts). The script below corrects lang/dir
      // before the first paint, from the URL prefix on /ar, /tr and /en, and otherwise from the
      // owner's chosen language.
      lang="nl"
      dir="ltr"
      /* [SCROLL] No `h-full` here: height:100% on the root is half of what
         broke scroll restoration — see the note on html/body in globals.css. */
      className={`${roboto.variable} ${notoArabic.variable} antialiased`}
    >
      <head>
        {/* [TAAL] Before anything else: the document's language on <html>, synchronously, before
            the first paint. A client effect would flip the whole layout AFTER painting — on an
            Arabic screen that is not a flicker but the page jumping sides. This is the pattern
            Next documents for exactly this ("preventing flash before hydration"). */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />

        {/* [Design System] Material Symbols — icon font, CDN.
            PERFORMANCE: icon_names= subsets the font to ONLY the glyphs the app
            uses (96 icons), cutting the download from ~313 KB to ~9 KB (~97%).
            display=block keeps the font invisible while loading then swaps in,
            so users never see the raw ligature text ("arrow_back") flash.

            ⚠ MAINTENANCE: this is an explicit subset. If you add a NEW
            material-symbols icon anywhere in the app, ADD its name to the
            icon_names list below — otherwise it renders as its raw text name.
            The list is validated: an unknown name makes Google return HTTP 400
            (all icons break), so keep names exact and alphabetical. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=account_balance,account_tree,add,add_a_photo,arrow_back,arrow_downward,arrow_forward,arrow_upward,attach_file,auto_awesome,autorenew,bar_chart,block,bolt,calculate,call_split,check,check_circle,checklist,chevron_left,chevron_right,close,content_copy,content_cut,create_new_folder,cut,date_range,delete,delete_forever,description,done_all,download,drive_file_move,drive_file_rename_outline,edit,error,error_outline,event,event_available,expand_less,expand_more,fact_check,flag,folder,folder_open,folder_special,forum,forward_to_inbox,grid_view,group,groups,help,history,home,hourglass_empty,image,inbox,info,insert_drive_file,inventory_2,label,label_important,link,link_off,lock,mark_email_unread,monitoring,more_vert,notifications,open_in_new,payments,pending,people,person,person_add,photo_camera,picture_as_pdf,point_of_sale,price_check,qr_code_2,radio_button_unchecked,receipt_long,refresh,request_quote,restart_alt,restore,rule,schedule,search,search_off,send,settings,share,shield,star,swap_horiz,swap_vert,sync_alt,sync_problem,task_alt,toggle_off,toggle_on,undo,upload,upload_file,uppercase,verified,view_list,visibility,visibility_off,warning,work&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {/* [MOTION] The app's snackbar and its alert/confirm/prompt replacements.
            Mounted at the root, not in the dashboard layout, so the public
            pages (calculators, /pay, invite acceptance) can use them too, and
            so a toast survives a navigation between dashboard sections.
            Both are client components taking {children} as a prop, which keeps
            everything below them server-rendered. */}
        <ToastProvider>
          <DialogProvider>{children}</DialogProvider>
        </ToastProvider>
        {/* [ANALYTICS] Vercel Web Analytics — cookieless & privacy-friendly, so
            no consent banner is required. Only reports on Vercel deploys. */}
        <Analytics />
      </body>
    </html>
  );
}