import type { Metadata } from "next";
import { PolishdMonitor } from "@polishd/next/client";
import ScrollFX from "@/components/scroll-fx";
import Hero from "@/components/sections/hero";
import Loop from "@/components/sections/loop";
import Proof from "@/components/sections/proof";
import Actionables from "@/components/sections/actionables";
import Fix from "@/components/sections/fix";
import Design from "@/components/sections/design";
import Frontier from "@/components/sections/frontier";
import Install from "@/components/sections/install";
import Closing from "@/components/sections/closing";
import { STRUCTURED_DATA } from "@/lib/seo";

// Resolved against metadataBase, so every alias of the deployment points
// search engines at the one production URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escaped so nothing in the data can close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }}
      />

      {/* Jet black, with a hairline grid and film grain for texture. */}
      <div className="aura pointer-events-none fixed inset-0 z-0" />
      <div className="grain pointer-events-none fixed -inset-1/2 z-1 opacity-[0.16]" />

      {/* The whole page as one content region, for how far down it's read. */}
      <PolishdMonitor name="landing-page" content className="block">
        <main className="relative z-2">
          <Hero />
          <Design />
          <Proof />
          <Actionables />
          {/* The ask comes once the live half has been shown, not after the
              roadmap — most readers never reach the end of the page. */}
          <Install />
          <Fix />
          <Loop />
          <Frontier />
          <Closing />
        </main>
      </PolishdMonitor>

      <ScrollFX />
    </>
  );
}
