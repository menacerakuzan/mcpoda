import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Pipeline } from "./components/Pipeline";
import { BuildOn } from "./components/BuildOn";
import { Roadmap } from "./components/Roadmap";
import { Asks, Footer, Gap, Limits, Setup, Stats } from "./components/Sections";

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Pipeline />
        <Gap />
        <Setup />
        <Asks />
        <Stats />
        <BuildOn />
        <Roadmap />
        <Limits />
      </main>
      <Footer />
    </>
  );
}
