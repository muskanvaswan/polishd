import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Overpass } from "next/font/google";
import localFont from "next/font/local";

// Open Sauce One — everything that isn't the wordmark or code.
import "@fontsource/open-sauce-one/400.css";
import "@fontsource/open-sauce-one/500.css";
import "@fontsource/open-sauce-one/600.css";
import "@fontsource/open-sauce-one/700.css";

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
  // The favicon is the bottle from the wordmark, as a solid: the halftone
  // dots don't survive 16px, the silhouette does. Generated from the dot
  // field in components/dot-bottle.tsx; see site/README.md.
  icons: {
    icon: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='8'%20fill='%230a0a0a'/%3E%3Cg%20fill='%23f5f5f5'%20transform='translate(6%202.9)%20scale(0.0803)'%3E%3Cpath%20fill-rule='evenodd'%20d='M82%2015L96%2015C96.3%2015.8%2096.2%2017.3%2098%2019.5C99.8%2021.8%20105.5%2027%20107%2028.5L107%2037.5C108.5%2039%20113%2043.5%20116%2046.5C119%2049.5%20123.5%2054%20125%2055.5L125%2064.5C126.5%2066%20131%2070.5%20134%2073.5C137%2076.5%20140%2079.5%20143%2082.5C146%2085.5%20149%2088.5%20152%2091.5C155%2094.5%20158%2097.5%20161%20100.5C164%20103.5%20167%20106.5%20170%20109.5C173%20112.5%20176%20115.5%20179%20118.5C182%20121.5%20186.5%20126%20188%20127.5L188%20136.5C189.5%20138%20195.5%20144%20197%20145.5L197%20154.5L197%20163.5C198.5%20165%20204.5%20171%20206%20172.5L206%20181.5L206%20190.5L206%20199.5L206%20208.5L206%20217.5L206%20226.5L206%20235.5L206%20244.5L206%20253.5L206%20262.5L206%20271.5L206%20280.5L206%20289.5L206%20298.5L206%20307.5C205.7%20308.3%20204.3%20311.3%20204%20312L82%20312C81.7%20311.3%2080.3%20308.3%2080%20307.5L80%20298.5L80%20289.5L80%20280.5L80%20271.5L80%20262.5L80%20253.5L80%20244.5L80%20235.5L80%20226.5L80%20217.5L80%20208.5L80%20199.5L80%20190.5L80%20181.5L80%20172.5L80%20163.5L80%20154.5L80%20145.5L80%20136.5L80%20127.5L80%20118.5L80%20109.5C78.5%20108%2072.5%20102%2071%20100.5L71%2091.5C69.5%2090%2063.5%2084%2062%2082.5L62%2073.5C60.5%2072%2054.5%2066%2053%2064.5L53%2055.5C51.5%2054%2045.5%2048%2044%2046.5L44%2037.5C47%2036%2056%2031.5%2062%2028.5C68%2025.5%2076.7%2021.8%2080%2019.5C83.3%2017.3%2081.7%2015.8%2082%2015ZM121.6%20250H155.8Q159.8%20250%20159.8%20254V314H117.6V254Q117.6%20250%20121.6%20250Z'/%3E%3C/g%3E%3C/svg%3E",
  },
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
