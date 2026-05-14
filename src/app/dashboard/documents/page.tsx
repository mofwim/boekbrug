// app/dashboard/documents/page.tsx
export const dynamic = 'force-dynamic';

import { Metadata } from "next";
import { DocumentsClient } from "./DocumentsClient";

export const metadata: Metadata = {
  title: "Documenten | BoekBrug",
};

export default function DocumentsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Documenten</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload en beheer je facturen, bonnen en contracten
        </p>
      </div>
      <DocumentsClient />
    </div>
  );
}