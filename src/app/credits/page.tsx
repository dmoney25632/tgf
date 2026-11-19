import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Credits · TGF" };

const ATTRIBUTED = [
  {
    title: "Infinite, 3D Head Scan (Lee Perry-Smith)",
    use: "Soldier faces in Iron Horizon",
    author: "Infinite-Realities",
    authorUrl: "http://www.ir-ltd.net/",
    license: "Creative Commons Attribution 3.0 Unported (CC BY 3.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    notes:
      "Based on a work at triplegangers.com, obtained via the three.js examples. Modified: trimmed to head and neck, re-tinted for skin tone and facial hair, painted eyes, specular map downscaled.",
  },
];

const CC0 = [
  { name: "Poly Haven", what: "textures, HDRI sky and props", url: "https://polyhaven.com/license" },
  { name: "ambientCG", what: "fabric texture", url: "https://docs.ambientcg.com/license/" },
];

export default function CreditsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[0.3em] text-amber-400/80 uppercase">Credits</p>
        <h1 className="text-2xl font-bold">Third-party assets</h1>
        <p className="text-sm text-muted-foreground">Everything not listed here (weapons, soldier gear, animation, sound) is original work.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Attribution (CC BY)</h2>
        {ATTRIBUTED.map((a) => (
          <Card key={a.title}>
            <CardHeader>
              <CardTitle>{a.title}</CardTitle>
              <CardDescription>{a.use}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                By{" "}
                <a href={a.authorUrl} className="underline underline-offset-4" rel="noreferrer" target="_blank">
                  {a.author}
                </a>
                , licensed under{" "}
                <a href={a.licenseUrl} className="underline underline-offset-4" rel="noreferrer" target="_blank">
                  {a.license}
                </a>
                .
              </p>
              <p className="text-muted-foreground">{a.notes}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Public domain (CC0)</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {CC0.map((c) => (
            <li key={c.name}>
              <a href={c.url} className="underline underline-offset-4" rel="noreferrer" target="_blank">
                {c.name}
              </a>
              <span className="text-muted-foreground">: {c.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
        Back to the dashboard
      </Link>
    </main>
  );
}
