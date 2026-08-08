// src/app/pdf-eigenschappen/PdfEigenschappen.tsx
// [PDF-TOOLS] The interactive half of /pdf-eigenschappen.
"use client";

import { useCallback, useState } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { readMetadata, save, writeMetadata, type PdfMetadata } from "@/lib/tools/pdf";

const FIELDS = ["title", "author", "subject", "keywords", "creator", "producer"] as const;
type FieldKey = (typeof FIELDS)[number];

const LABEL: Record<FieldKey, string> = {
  title: "Titel",
  author: "Auteur",
  subject: "Onderwerp",
  keywords: "Trefwoorden",
  creator: "Gemaakt met",
  producer: "Opgeslagen door",
};

export default function PdfEigenschappen() {
  const [file, setFile] = useState<File | null>(null);
  const [original, setOriginal] = useState<PdfMetadata | null>(null);
  const [fields, setFields] = useState<Record<FieldKey, string> | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setResult(null);
    try {
      const read = await readMetadata(picked[0]);
      setFile(picked[0]);
      setOriginal(read);
      setFields(
        Object.fromEntries(FIELDS.map((key) => [key, read[key] || ""])) as Record<FieldKey, string>
      );
    } catch (err) {
      setFile(null);
      setOriginal(null);
      setFields(null);
      setError(describeError(err));
    }
  }, []);

  const run = useCallback(async () => {
    if (!file || !fields) return;
    setBusy(true);
    setError("");
    try {
      const doc = await writeMetadata(file, fields);
      setResult(await save(doc, { name: file.name }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [file, fields]);

  const stripAll = () => {
    setFields(Object.fromEntries(FIELDS.map((key) => [key, ""])) as Record<FieldKey, string>);
    setResult(null);
  };

  const formatDate = (date: Date | null) =>
    date
      ? new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeStyle: "short" }).format(date)
      : "—";

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="pencil"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {error && <Note kind="error">{error}</Note>}

      {fields && file && original && (
        <>
          <Panel
            title={`${file.name} · ${original.pages} pagina${original.pages === 1 ? "" : "'s"}`}
          >
            {FIELDS.map((key) => (
              <Field
                key={key}
                label={LABEL[key]}
                hint={key === "keywords" ? "Gescheiden door komma's." : undefined}
              >
                {(id) => (
                  <input
                    id={id}
                    type="text"
                    value={fields[key]}
                    onChange={(event) => {
                      setFields((current) =>
                        current ? { ...current, [key]: event.target.value } : current
                      );
                      setResult(null);
                    }}
                    placeholder="leeg"
                  />
                )}
              </Field>
            ))}

            <dl className="tp-stat tp-stat-wide">
              <div>
                <dt>Gemaakt op</dt>
                <dd className="tp-plain">{formatDate(original.created)}</dd>
              </div>
              <div>
                <dt>Gewijzigd op</dt>
                <dd className="tp-plain">{formatDate(original.modified)}</dd>
              </div>
            </dl>

            <Actions>
              <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
                {busy ? "Bezig…" : "Toepassen"}
              </button>
              <button type="button" className="btn btn-quiet" onClick={stripAll}>
                Alles leegmaken
              </button>
            </Actions>
          </Panel>

          {/* The reason most people are here, said out loud. */}
          <p className="tp-hint">
            Een leeg veld wist de eigenschap echt — er wordt geen lege tekst ingezet. Zo haal je
            bijvoorbeeld je eigen naam of die van je vorige werkgever uit een offerte die je
            doorstuurt.
          </p>
        </>
      )}

      {result && (
        <Panel title="Klaar">
          <Note kind="ok">
            De eigenschappen staan in het bestand — {formatBytes(result.blob.size)}.
          </Note>
          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => download(result.name, result.blob)}
            >
              <Icon name="download" size={16} /> Opslaan
            </button>
          </Actions>
        </Panel>
      )}
    </>
  );
}
