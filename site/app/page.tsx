import ScrollFX from "@/components/scroll-fx";
import Hero from "@/components/sections/hero";
import Loop from "@/components/sections/loop";
import Proof from "@/components/sections/proof";
import Actionables from "@/components/sections/actionables";
import Design from "@/components/sections/design";
import Frontier from "@/components/sections/frontier";
import Install from "@/components/sections/install";
import Closing from "@/components/sections/closing";

export default function Page() {
  return (
    <>
      {/* Jet black, with a hairline grid and film grain for texture. */}
      <div className="aura pointer-events-none fixed inset-0 z-0" />
      <div className="grain pointer-events-none fixed -inset-1/2 z-1 opacity-[0.16]" />

      <main className="relative z-2">
        <Hero />
        <Design />
        <Proof />
        <Actionables />
        <Loop />
        <Frontier />
        <Install />
        <Closing />
      </main>

      <ScrollFX />
    </>
  );
}
