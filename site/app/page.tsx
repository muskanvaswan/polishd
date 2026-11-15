import type { Metadata } from "next";
import { PolishdMonitor } from "@polishd/next/client";

import ScrollFX from "@/components/scroll-fx";
import Hero from "@/components/sections/hero";
import InYourApp from "@/components/sections/in-your-app";
import Fingerprints from "@/components/sections/fingerprints";
import HowItWorks from "@/components/sections/how-it-works";
import WhereItRuns from "@/components/sections/where-it-runs";
import Demo from "@/components/sections/demo";
import Install from "@/components/sections/install";
import StatusSection from "@/components/sections/status";
import Faq from "@/components/sections/faq";
import Closing from "@/components/sections/closing";
import { STRUCTURED_DATA } from "@/lib/seo";

// Resolved against metadataBase, so every alias of the deployment points
// search engines at the one production URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The page answers a developer's questions in the order they ask them. The
 * hero says what it is (a package that runs in your app); then why you'd want
 * it (the fingerprints a fast build leaves), how it works (the walkthrough),
 * what it sends where, and what it physically is in your repo (the files
 * `init` writes), can I try it (the demo), how do I install it, what's real
 * today, and the rest (FAQ).
 */
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
      <div className="grain pointer-events-none fixed -inset-1/2 z-1 opacity-[0.14]" />

      {/* The whole page as one content region, for how far down it's read. */}
      <PolishdMonitor name="landing-page" content className="block">
        <main className="relative z-2">
          <Hero />
          <Fingerprints />
          <HowItWorks />
          <WhereItRuns />
          <InYourApp />
          <Demo />
          <Install />
          <StatusSection />
          <Faq />
          <Closing />
        </main>
      </PolishdMonitor>

      <ScrollFX />
    </>
  );
}
