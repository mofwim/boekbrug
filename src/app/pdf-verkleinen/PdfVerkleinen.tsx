// src/app/pdf-verkleinen/PdfVerkleinen.tsx
// [PDF-TOOLS] The interactive half of /pdf-verkleinen. Client component: it
// reads a file the visitor picked and never sends it anywhere.
"use client";

import { useCallback, useState } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  Segmented,
  Slider,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { rasterise, restructure } from "@/lib/tools/pdf";
import { compressImages } from "@/lib/tools/pdfcompress";

/**
 * Three rungs of a ladder, from "nothing changes" to "everything does".
 *
 * The middle one is the default because it is the one that is nearly always
 * right: the pictures come down and the text is not touched at all. Every one
 * of them is named honestly — the heavy option says out loud that it turns text
 * into pixels, because for a bonnetje going to a boekhouder that is the whole
 * value gone and nobody should discover it afterwards.
 */
const WAYS = ["clean", "images", "rasterise"] as const;
type Way = (typeof WAYS)[number];

const LABEL: Record<Way, string> = {
  clean: "Opschonen",
  images: "Afbeeldingen",
  rasterise: "Alles",
};

const EXPLAIN: Record<Way, string> = {
  clean:
    "Het bestand wordt netjes opnieuw opgeslagen. Aan de pagina's verandert niets — dit helpt vooral bij documenten uit een tekstverwerker.",
  images:
    "Alleen de afbeeldingen in het document worden verkleind en opnieuw opgeslagen. De tekst en de lijnen worden niet aangeraakt: die blijven tekst, dus doorzoekbaar en scherp op elk zoomniveau. Dit is bijna altijd wat je wilt.",
  rasterise:
    "Elke pagina wordt als één afbeelding overgetekend. Veel kleiner bij een scan — maar de tekst is dan geen tekst meer: niet meer te selecteren, te doorzoeken of te kopiëren. Ook je boekhouder kan er dan niets meer uit halen.",
};

interface Result {
  blob: Blob;
  pages: number;
  images?: number;
  changed?: number;
  skipped?: number;
  name: string;
  saved: number;
}

export default function PdfVerkleinen() {
  const [file, setFile] = useState<File | null>(null);
  const [how, setHow] = useState<Way>("images");
  const [dpi, setDpi] = useState<"96" | "150" | "200">("150");
  const [quality, setQuality] = useState(72);
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const take = useCallback((picked: File[]) => {
    setError("");
    setResult(null);
    setFile(picked[0]);
  }, []);

  const run = useCallback(async () => {
    if (!file) return;
    setError("");
    setResult(null);
    setProgress({ done: 0, total: 0 });

    try {
      const track = (done: number, total: number) => setProgress({ done, total });
      const options = { dpi: Number(dpi), quality: quality / 100, onProgress: track };
      const made =
        how === "clean"
          ? await restructure(file)
          : how === "images"
            ? await compressImages(file, options)
            : await rasterise(file, options);

      setResult({
        ...made,
        name: `${file.name.replace(/\.pdf$/i, "")}-kleiner.pdf`,
        saved: 1 - made.blob.size / file.size,
      });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setProgress(null);
    }
  }, [file, how, dpi, quality]);

  const won = Boolean(result && result.saved > 0.02);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="file"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {error && <Note kind="error">{error}</Note>}

      {file && (
        <Panel title={`${file.name} · ${formatBytes(file.size)}`}>
          <Field label="Hoe">
            <Segmented
              label="Hoe"
              value={how}
              onChange={setHow}
              options={WAYS.map((value) => ({ value, label: LABEL[value] }))}
            />
          </Field>

          <Note kind={how === "rasterise" ? "warn" : "ok"}>{EXPLAIN[how]}</Note>

          {how !== "clean" && (
            <>
              <Field
                label="Resolutie"
                hint={
                  how === "images"
                    ? "De bovengrens voor afbeeldingen. Een klein logo blijft klein; alleen wat te groot is gaat omlaag."
                    : "Hoe fijn de pagina's opnieuw getekend worden."
                }
              >
                <Segmented
                  label="Resolutie"
                  value={dpi}
                  onChange={setDpi}
                  options={[
                    { value: "96", label: "Scherm" },
                    { value: "150", label: "Normaal" },
                    { value: "200", label: "Drukwerk" },
                  ]}
                />
              </Field>
              <Field label="Kwaliteit">
                <Slider value={quality} onChange={setQuality} min={40} max={95} suffix="%" />
              </Field>
            </>
          )}

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(progress)}
            >
              {progress
                ? progress.total
                  ? `Bezig — ${progress.done} van ${progress.total}`
                  : "Bezig…"
                : "Verkleinen"}
            </button>
          </Actions>
        </Panel>
      )}

      {result && file && (
        <Panel title="Resultaat">
          {won ? (
            <Note kind="ok">
              {Math.round(result.saved * 100)}% kleiner — van {formatBytes(file.size)} naar{" "}
              {formatBytes(result.blob.size)}.
            </Note>
          ) : (
            <Note kind="warn">
              Dit bestand was al zo klein als het kon. Het blijft {formatBytes(result.blob.size)}
              {how === "images"
                ? " — probeer 'Alles' als het een scan is, maar lees eerst wat daar staat."
                : "."}
            </Note>
          )}

          <dl className="tp-stat tp-stat-wide">
            <div>
              <dt>Was</dt>
              <dd>{formatBytes(file.size)}</dd>
            </div>
            <div>
              <dt>Wordt</dt>
              <dd className={won ? "tp-win" : ""}>{formatBytes(result.blob.size)}</dd>
            </div>
            <div>
              <dt>Pagina&apos;s</dt>
              <dd>{result.pages}</dd>
            </div>
            {how === "images" && (
              <div>
                <dt>Afbeeldingen</dt>
                <dd>
                  {result.changed} / {result.images}
                </dd>
              </div>
            )}
          </dl>

          {/* What was left alone, and why — a skipped image is a decision, not
              a silence. */}
          {how === "images" && (result.skipped ?? 0) > 0 && (
            <p className="tp-hint">
              {result.skipped} afbeelding{result.skipped === 1 ? "" : "en"} bleef zoals hij was:
              doorzichtig, of al klein genoeg, of in een vorm die niet veilig te herschrijven is.
            </p>
          )}
          {how === "images" && result.images === 0 && (
            <p className="tp-hint">
              Er zitten geen afbeeldingen in dit document — dan valt er hier ook niets te
              verkleinen. Probeer &lsquo;Opschonen&rsquo;.
            </p>
          )}

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
