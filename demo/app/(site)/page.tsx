import Features from "@/components/site/features";
import { CallToAction } from "@/components/site/footer";
import Hero from "@/components/site/hero";
import Pricing from "@/components/site/pricing";
import Showcase from "@/components/site/showcase";

export default function Home() {
  return (
    <>
      <Hero />
      <Showcase />
      <Features />
      <Pricing />
      <CallToAction />
    </>
  );
}
