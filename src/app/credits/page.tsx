import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
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
  {
    title: "M4A1",
    use: "First-person M4A1 carbine in Iron Horizon",
    author: "TORI106",
    authorUrl: "https://sketchfab.com/3d-models/m4a1-33107f38b23c45cc8103768c0e961cdf",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the FirstWave project (github.com/moyzyy/FirstWave). Modified: textures re-encoded at 1024 px; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "Ak47",
    use: "First-person AKM rifle in Iron Horizon",
    author: "wburton",
    authorUrl: "https://sketchfab.com/3d-models/ak47-831519a097d84e079fd8bc4b15e5b57d",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the FirstWave project (github.com/moyzyy/FirstWave). Modified: textures re-encoded at 1024 px, loose spare magazine removed, rig baked to a static pose; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "MP5 | PBR | High Poly",
    use: "First-person MP5 submachine gun in Iron Horizon",
    author: "Stein Games",
    authorUrl: "https://sketchfab.com/3d-models/mp5-pbr-high-poly-60ec470e41ff47368c792dd6caa74529",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the FirstWave project (github.com/moyzyy/FirstWave). Modified: textures re-encoded at 1024 px; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "M1911 Handgun",
    use: "First-person M1911 pistol in Iron Horizon",
    author: "SINNIK",
    authorUrl: "https://sketchfab.com/3d-models/m1911-handgun-1f2209650c1d47cfb8d686ab99258409",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the FirstWave project (github.com/moyzyy/FirstWave). Modified: textures re-encoded at 1024 px, effect meshes removed; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "Microsoft Rocketbox avatars (Military_Male_01, 03, 04)",
    use: "Motion-captured enemy and squadmate soldiers in Iron Horizon",
    author: "Microsoft",
    authorUrl: "https://github.com/microsoft/Microsoft-Rocketbox",
    license: "MIT License (Copyright (c) 2020 Microsoft)",
    licenseUrl: "https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md",
    notes:
      "Modified: converted to glTF, facial bones folded into the head, knife removed, textures packed into one atlas per avatar and downscaled, team-tint mask and simplified LOD added. Camouflage is re-tinted per team at runtime.",
  },
  {
    title: "Microsoft Rocketbox avatar Military_Male_01 (first-person arms)",
    use: "The player's first-person arms, sleeves and gloves in Iron Horizon",
    author: "Microsoft",
    authorUrl: "https://github.com/microsoft/Microsoft-Rocketbox",
    license: "MIT License (Copyright (c) 2020 Microsoft)",
    licenseUrl: "https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md",
    notes:
      "Modified: arms and gloved hands cut from the body, smoothed and re-simplified, re-rigged onto a first-person arm skeleton with forearm twist bones, textures cropped to the arms with a glove mask added. Sleeve and glove colours are re-tinted from the player's look at runtime.",
  },
  {
    title: "M24 Bounty Hunter Sniper Rifle",
    use: "First-person M24 sniper rifle in Iron Horizon",
    author: "Naudaff3D",
    authorUrl: "https://sketchfab.com/3d-models/m24-bounty-hunter-sniper-rifle-d40e74e2259549f5b025807163f1028c",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the HYPERLUNATIC project (github.com/317gw/HYPERLUNATIC). Modified: textures re-encoded at 1024 px; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "Dragunov SVD",
    use: "First-person SVD marksman rifle in Iron Horizon",
    author: "Vintar",
    authorUrl: "https://sketchfab.com/3d-models/dragunov-svd-e3520e52a0d547b6b7c7ff2726161702",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the StalkerCV project (github.com/ZHe-testName/StalkerCV). Modified: textures re-encoded as 512 px JPG; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "Remington870 Shotgun",
    use: "First-person Remington 870 shotgun in Iron Horizon",
    author: "Trip (Triptonic)",
    authorUrl: "https://sketchfab.com/3d-models/remington870-shotgun-a4852997660a43839c30e36dfca5a3e7",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the RevenantOps project (github.com/Noureddine-Hci/RevenantOps). Modified: textures re-encoded at 1024 px; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "M249 Machine Gun",
    use: "First-person M249 light machine gun in Iron Horizon",
    author: "Kendrick Russell (Buce)",
    authorUrl: "https://sketchfab.com/3d-models/m249-machine-gun-bf0105376a2d4c37926f3ce95316460d",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the scp-continued-path project (github.com/Yni-Viar/scp-continued-path), whose copy has merged meshes. Modified: textures re-encoded at 1024 px; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "357 Python Revolver (Rigged)",
    use: "First-person revolver in Iron Horizon",
    author: "Erai (Khosro3D)",
    authorUrl: "https://sketchfab.com/3d-models/357-python-revolver-rigged-3b81c991e9c84236a5c03895f9ca0aa3",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the Rock-sugar project (github.com/Haruluya/Rock-sugar). Modified: textures re-encoded at 1024 px, speedloader and loose cases removed, rig baked to a static pose; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "HK 416 A7 (free download)",
    use: "First-person HK416 in Iron Horizon",
    author: "r4m",
    authorUrl: "https://sketchfab.com/3d-models/hk-416-a7-free-download-a16768f0ffa24737a4fe324a411cfbd9",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the CosmicFPSLibgdx project (github.com/Patriqu/CosmicFPSLibgdx). Modified: textures re-encoded at 1024 px, spare magazine and loose rounds removed; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "G18",
    use: "First-person Glock 17 in Iron Horizon",
    author: "IVA (dxmhl)",
    authorUrl: "https://sketchfab.com/3d-models/g18-fdd5cdd7b31c49f2b16a868ebdf4a75f",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained via the OpenSCCT project (github.com/OpenSCCT/OpenSCCT). Modified: textures re-encoded at 1024 px, loose round removed, rig baked to a static pose; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "G36 with attachments",
    use: "First-person G36 in Iron Horizon",
    author: "Kelisei Ventura (frankestudios71)",
    authorUrl: "https://sketchfab.com/3d-models/g36-with-attachments-de744d8804ce4231ba3c76f791980832",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained as the processed copy in the zugriff project (github.com/birkmann/zugriff: decimated, magazine split off, textures at 512 px). Modified further: the rail red dot removed; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "PKP_pecheneg",
    use: "First-person PKM in Iron Horizon",
    author: "chipmunkman",
    authorUrl: "https://sketchfab.com/3d-models/pkp-pecheneg-ee7b308b1a7d45479776aa1ca57faf0f",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained as the processed copy in the zugriff project (github.com/birkmann/zugriff: decimated, optic removed, ammunition box split off, textures at 512 px). Modified further: the leftover optic side mount removed; re-oriented and scaled at runtime to fit the in-game hands.",
  },
  {
    title: "Shotgun BENELLI M4 Super 90 14\"",
    use: "First-person M1014 in Iron Horizon",
    author: "drcrazzie",
    authorUrl: "https://sketchfab.com/3d-models/shotgun-benelli-m4-super-90-14-a4cb85ebf36c40f9af47dd3e38d340a2",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Obtained as the processed copy in the zugriff project (github.com/birkmann/zugriff: decimated, textures at 512 px). Re-oriented and scaled at runtime to fit the in-game hands.",
  },
];

const CC0 = [
  { name: "Poly Haven", what: "textures, HDRI sky, props and the Service Pistol (M9) model", url: "https://polyhaven.com/license" },
  { name: "ambientCG", what: "fabric texture", url: "https://docs.ambientcg.com/license/" },
  { name: "Quaternius", what: "Universal Animation Library soldier animations (retargeted)", url: "https://quaternius.com/packs/universalanimationlibrary.html" },
];

export default function CreditsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[0.3em] text-white/80 uppercase">Credits</p>
        <h1 className="text-2xl font-bold">Third-party assets</h1>
        <p className="text-sm text-muted-foreground">Everything not listed here (other weapons, soldier gear, animation, sound) is original work.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Attribution (CC BY, MIT)</h2>
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

      <Link href="/play/iron-horizon" className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
        Back to the lobby
      </Link>
    </main>
  );
}
