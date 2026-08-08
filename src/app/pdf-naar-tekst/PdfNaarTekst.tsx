// src/app/pdf-naar-tekst/PdfNaarTekst.tsx
// [PDF-TOOLS] The interactive half of /pdf-naar-tekst.
"use client";

import { useCallback, useState } from "react";
import {
  Actions,
  CopyButton,
  Field,
  FileDrop,
  Note,
  Panel,
  Segmented,
  download,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { openDocument, pageText } from "@/lib/tools/pdfjs";

export default function PdfNaarTekst() {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<{ number: number; text: string }[]>([]);
  const [layout, setLayout] = useState<"marked" | "plain">("marked");
  const [error, setError] = useState("");

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setPages([]);
    setFile(picked[0]);

    let reader = null;
    try {
      reader = await openDocument(picked[0]);
      const found: { number: number; text: string }[] = [];
      for (let number = 1; number <= reader.numPages; number++) {
        setBusy({ done: number - 1, total: reader.numPages });
        found.push({ number, text: await pageText(reader, number) });
      }
      setPages(found);
    } catch (err) {
      setFile(null);
      setError(describeError(err));
    } finally {
      await reader?.loadingTask.destroy();
      setBusy(null);
    }
  }, []);

  const full = pages
    .map((page) =>
      layout === "marked" ? `--- pagina ${page.number} ---\n${page.text}` : page.text
    )
    .join("\n\n");

  // A scan has pages but no text in them. Saying so beats handing back an empty
  // box, because the next question is always "wat doe ik dan wel".
  const empty = pages.length > 0 && pages.every((page) => !page.text);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="file"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {busy && (
        <Note kind="ok">
          Bezig met lezen — {busy.done} van {busy.total}
        </Note>
      )}
      {error && <Note kind="error">{error}</Note>}
      {empty && (
        <Note kind="warn">
          Er staat wel iets op deze pagina&apos;s, maar geen tekst — dit is een scan of een
          fotokopie. De letters zijn plaatjes, dus er valt niets te kopiëren. Daar heb je OCR voor
          nodig; in BoekBrug leest &lsquo;factuur scannen&rsquo; zulke documenten wel uit.
        </Note>
      )}

      {pages.length > 0 && !empty && file && (
        <Panel title={`${file.name} · ${pages.length} pagina${pages.length === 1 ? "" : "'s"}`}>
          <Field label="Paginascheidingen">
            <Segmented
              label="Paginascheidingen"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "marked", label: "Met" },
                { value: "plain", label: "Zonder" },
              ]}
            />
          </Field>

          <pre className="tp-out tp-clip-tall">{full}</pre>

          <Actions>
            <CopyButton text={full} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                download(
                  `${file.name.replace(/\.pdf$/i, "")}.txt`,
                  full,
                  "text/plain;charset=utf-8"
                )
              }
            >
              Opslaan als .txt
            </button>
          </Actions>
        </Panel>
      )}
    </>
  );
}
