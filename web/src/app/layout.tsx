import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Space_Grotesk, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// Loaded after globals.css so the Obsidian Frequency identity refresh
// reliably wins ties over the base chrome / aid / vault rules defined
// inline in globals.css and the aid-*.css imports.
import "../styles/identity-refresh.css";
import AppShell from "../components/layout/AppShell";
import AuthProvider from "../components/auth/AuthProvider";
import ZeroDevProviderClient from "../components/auth/ZeroDevProviderClient";
import { ToastProvider } from "../components/ui/Toast";

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

const SITE_NAME = "Resonate";
const SITE_TAGLINE =
  "Discover, remix, and own music on-chain. Stems, royalties, and an AI DJ — all in one studio.";

export const metadata: Metadata = {
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
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_TAGLINE,
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
         * flags page-scoped font links, not root-layout ones. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${beVietnamPro.variable} ${jetbrainsMono.variable}`}>
        <ToastProvider>
          <ZeroDevProviderClient projectId={process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID}>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ZeroDevProviderClient>
        </ToastProvider>
      </body>
    </html>
  );
}
