import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

// Queuebird is set in Geist, like most launch pages an AI tool writes today.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-face", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Queuebird — a Polishd demo", template: "%s · Queuebird — a Polishd demo" },
  description:
    "A sample dev-tool launch page, generated fast and rough at the edges, with @polishd/next installed. Click around, then open its real Polishd dashboard.",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#09090b", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="bg-[#09090b] font-sans text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
