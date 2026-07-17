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
  themeColor: "#1a73e8",
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
        {/* [Design System] Material Symbols — icon font, CDN.
            PERFORMANCE: icon_names= subsets the font to ONLY the glyphs the app
            uses (88 icons), cutting the download from ~313 KB to ~9 KB (~97%).
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
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=account_balance,add,add_a_photo,arrow_back,arrow_downward,arrow_forward,arrow_upward,attach_file,auto_awesome,bar_chart,block,bolt,calculate,check,check_circle,checklist,chevron_left,chevron_right,close,content_copy,content_cut,create_new_folder,cut,delete,delete_forever,description,done_all,download,drive_file_move,drive_file_rename_outline,edit,error,error_outline,event,event_available,expand_less,expand_more,fact_check,folder,folder_open,folder_special,forward_to_inbox,grid_view,groups,help,home,hourglass_empty,inbox,info,insert_drive_file,inventory_2,link,link_off,mark_email_unread,more_vert,open_in_new,payments,pending,people,person,person_add,photo_camera,picture_as_pdf,point_of_sale,qr_code_2,radio_button_unchecked,receipt_long,refresh,restore,schedule,search,search_off,send,settings,share,shield,star,task_alt,undo,upload,upload_file,uppercase,verified,view_list,visibility,visibility_off,warning,work&display=block"
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