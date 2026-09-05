import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Space_Grotesk, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// Loaded after globals.css so the Obsidian Frequency identity refresh
// reliably wins ties over the base chrome / aid / vault rules defined
// inline in globals.css and the aid-*.css imports.
import "../styles/identity-refresh.css";
// Player console surface (queue rows, icon buttons, gain, split buttons).
// Last so it wins over the base `.ui-btn` / `.queue-item` rules it refines.
import "../styles/player-console.css";
import AppShell from "../components/layout/AppShell";
import AuthProvider from "../components/auth/AuthProvider";
import ZeroDevProviderClient from "../components/auth/ZeroDevProviderClient";
import { ToastProvider } from "../components/ui/Toast";
import { AppStateGuard } from "../components/system/AppStateGuard";
import UpdateAvailablePrompt from "../components/system/UpdateAvailablePrompt";
import {
  DEFAULT_SOCIAL_IMAGE,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL_OBJECT,
  canonicalUrl,
  publicMetadata,
  socialImageUrl,
} from "../lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Stitch design system fonts. Scoped via the `--ds-font-*` tokens in
// tokens.css so they only apply where the new design system is used
// (home page + future migrated surfaces).
const spaceGrotesk = Space_Grotesk({
  variable: "--font-ds-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-ds-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  ...publicMetadata({
    title: SITE_NAME,
    description: SITE_TAGLINE,
    path: "/",
    image: DEFAULT_SOCIAL_IMAGE,
  }),
  // Absolute base for resolving relative Open Graph / Twitter image URLs (e.g.
  // the per-moment `opengraph-image` route, #1477). Defaults to local dev.
  metadataBase: SITE_URL_OBJECT,
  // `template` lets per-route pages set their own title via
  // `export const metadata = { title: "Library" }` and get
  // "Library · Resonate" automatically.
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    url: canonicalUrl("/"),
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_TAGLINE,
    images: [{ url: socialImageUrl(DEFAULT_SOCIAL_IMAGE), alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_TAGLINE,
    images: [socialImageUrl(DEFAULT_SOCIAL_IMAGE)],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Material Symbols icon font — used by the Stitch-designed home.
         * Lives in the root layout so it applies app-wide; the lint rule
         * flags page-scoped font links, not root-layout ones.
         *
         * SUBSETTED (#1491): `&icon_names=` restricts the download to the
         * glyphs we actually render. The unsubsetted variable font is
         * ~3.96 MB (51% of a cold Home page); this subset is ~25 KB.
         *
         * IMPORTANT: if you add `<span className="ms-icon">some_icon</span>` to any
         * component, you MUST add `some_icon` to the sorted list below.
         * Material Symbols icons are ligatures, so a missing glyph does not
         * fall back gracefully — the literal text ("some_icon") renders in
         * the UI instead of an icon. The guard test at
         * web/src/lib/iconFontSubset.test.ts scans src/ for `.ms-icon`
         * ligature names and fails when one is missing from this URL. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=album,arrow_forward,close,error,graphic_eq,hourglass_top,library_add,library_music,lock,person_add,person_search,play_arrow,play_circle,playlist_add,progress_activity,public,queue_music,rocket_launch,search,search_off,table_rows,upload_file&display=swap"
        />
      </head>
      <body className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${beVietnamPro.variable} ${jetbrainsMono.variable}`}>
        <ToastProvider>
          <ZeroDevProviderClient projectId={process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID}>
            <AuthProvider>
              <AppStateGuard />
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ZeroDevProviderClient>
          <UpdateAvailablePrompt />
        </ToastProvider>
      </body>
    </html>
  );
}
