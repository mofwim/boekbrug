// src/app/dashboard/jaar/page.tsx — [IB-JAAR] thin server shell; the client fetches per year.
import JaarClient from "./JaarClient";

export const dynamic = "force-dynamic";

export default function JaarPage() {
  return <JaarClient />;
}
