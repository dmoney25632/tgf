import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <Link href="/" className="font-mono text-2xl font-bold tracking-[0.3em]">
        TGF
      </Link>
      {children}
    </main>
  );
}
