import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

const description =
  "The taste loop for Next.js. Track, measure, analyse and surface the rough edges in your " +
  "app as actionable bugs — then fix, verify and ship. What gets measured gets improved.";

export const metadata: Metadata = {
  title: "Polishd — Taste starts with finishing",
  description,
  openGraph: {
    type: "website",
    title: "Polishd — Taste starts with finishing",
    description:
      "Build fast, refine relentlessly. The loop from signal to shipped fix, for Next.js.",
  },
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23000'/%3E%3Ccircle cx='16' cy='16' r='6' fill='none' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans">
        {/* Scroll reveal starts hidden — without JS it would never un-hide. */}
        <noscript>
          <style>{`.r{opacity:1!important;transform:none!important;filter:none!important}.fill{width:calc(var(--w,0)*1%)}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
