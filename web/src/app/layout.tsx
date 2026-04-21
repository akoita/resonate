import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
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
      <body className={`${inter.variable} ${geistSans.variable} ${geistMono.variable}`}>
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
