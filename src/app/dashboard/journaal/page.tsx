// src/app/dashboard/journaal/page.tsx
// [GROOTBOEK-KAART] The word an accountant types, landing on the screen that holds it.
//
// The journaal is a TAB of the grootboek screen, not a second year-scale fetch of the same data.
// This route exists because "journaalposten" is one of the words a boekhouder looks for by name,
// and a package that has the page but not the word is a package they conclude does not have it.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function JournaalPage() {
  redirect("/dashboard/grootboek");
}
