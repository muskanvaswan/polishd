import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Overpass } from "next/font/google";
import localFont from "next/font/local";

// Open Sauce One — everything that isn't the wordmark or code.
import "@fontsource/open-sauce-one/400.css";
import "@fontsource/open-sauce-one/500.css";
import "@fontsource/open-sauce-one/600.css";
import "@fontsource/open-sauce-one/700.css";

import { SITE_URL } from "@/lib/links";
import { AUTHOR, DESCRIPTION, TITLE } from "@/lib/seo";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

// Headings. Nohemi — vendored in app/fonts, see the LICENSE there.
const nohemi = localFont({
  src: [
    { path: "./fonts/Nohemi-Medium.ttf", weight: "500" },
    { path: "./fonts/Nohemi-SemiBold.ttf", weight: "600" },
    { path: "./fonts/Nohemi-Bold.ttf", weight: "700" },
  ],
  variable: "--font-nohemi-face",
  display: "swap",
});

// The wordmark face. Overpass is the open-source digitisation of Highway
// Gothic — the US road-signage alphabet — which "Highway" fonts derive from.
const highway = Overpass({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-highway-face",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Polishd",
  authors: [AUTHOR],
  creator: AUTHOR.name,
  category: "technology",
  // The share image is app/opengraph-image.png (teaser/promo-poster.png,
  // cropped to 1200×630); Next adds it, and X falls back to it.
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Polishd",
    locale: "en_US",
    title: "Polishd — Build fast, refine relentlessly",
    description:
      "The taste loop for Next.js: product analytics and design review, from signal to shipped fix.",
  },
  twitter: { card: "summary_large_image" },
  // The favicon (app/icon.svg) is the bottle from the wordmark, as a solid:
  // the halftone dots don't survive 16px, the silhouette does. Generated from
  // the dot field in components/dot-bottle.tsx; see site/README.md.
  // app/apple-icon.png is the same mark, full-bleed for iOS to round.
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${highway.variable} ${nohemi.variable} ${mono.variable}`}>
      <body className="font-sans">
        {/* Scroll reveal starts hidden — without JS it would never un-hide. */}
        <noscript>
          <style>{`.r{opacity:1!important;transform:none!important;filter:none!important}.fill{transform:translateX(calc((var(--w,0) - 100)*1%))}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
