import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://probe.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "probe-key";
mock.module("next/navigation", { namedExports: {
  useRouter: () => ({ push(){}, replace(){}, refresh(){}, back(){}, forward(){}, prefetch(){} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
  useParams: () => ({ id: "inv-1" }),
  notFound: () => { throw new Error("notFound"); },
  redirect: () => { throw new Error("redirect"); },
}});

test("probe", async () => {
  const { ToastProvider } = await import("./src/components/ui/Toast");
  const { DialogProvider } = await import("./src/components/ui/Dialog");
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ["dagomzet",  "./src/app/dashboard/dagomzet/DagomzetImportClient", "default", {}],
    ["waarheid",  "./src/app/dashboard/waarheid/WaarheidClient", "default", {}],
    ["klaar",     "./src/app/dashboard/klaar/KlaarClient", "default", {}],
    ["quarterly", "./src/components/quarterly/QuarterlyOverview", "QuarterlyOverview", { isAccountant: false, role: "zzper" }],
    ["brug",      "./src/app/dashboard/brug/BrugClient", "default", { nodes: [], role: "zzper", docStatus: {}, readFailed: [] }],
    ["invoice",   "./src/app/dashboard/invoice/[id]/page", "default", {}],
  ];
  for (const [name, path, exp, props] of cases) {
    try {
      const mod: any = await import(path);
      const html = renderToStaticMarkup(
        React.createElement(DialogProvider, null,
          React.createElement(ToastProvider, null, React.createElement(mod[exp], props as any))));
      console.log(`  OK    ${name.padEnd(10)} ${html.length} chars`);
    } catch (e) {
      console.log(`  THREW ${name.padEnd(10)} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
});
