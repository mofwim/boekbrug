// src/app/favicon-maken/FaviconMaken.tsx
// [PDF-TOOLS] The interactive half of /favicon-maken.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Actions,
  CopyButton,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  ResultFile,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { FAVICON_SIZES, MIME, buildIco, encode, loadImage, render, type LoadedImage } from "@/lib/tools/image";
import { makeZip, uniqueNames } from "@/lib/tools/zip";

/** The sizes that actually end up in an .ico; the rest ship as separate PNGs. */
const ICO_SIZES = [16, 32, 48];

const SNIPPET = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png">`;

interface IconFile {
  size: number;
  name: string;
  blob: Blob;
  url: string;
}

export default function FaviconMaken() {
  const [set, setSet] = useState<{ files: IconFile[]; ico: Blob; name: string } | null>(null);
  const [background, setBackground] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<{ image: LoadedImage; name: string } | null>(null);

  useEffect(() => () => set?.files.forEach((file) => URL.revokeObjectURL(file.url)), [set]);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    try {
      const image = await loadImage(picked[0]);
      setSource({ image, name: picked[0].name });
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  /**
   * Build the whole set whenever the source or the background changes.
   *
   * A transparent icon can vanish on a dark tab strip, so the colour is a real
   * choice — and changing it has to rebuild every size, not just recolour the
   * preview.
   */
  useEffect(() => {
    if (!source) return undefined;
    let cancelled = false;

    (async () => {
      setBusy(true);
      setError("");
      try {
        const files: IconFile[] = [];
        for (const size of FAVICON_SIZES) {
          const canvas = render(source.image, {
            width: size,
            height: size,
            fit: "contain",
            background,
          });
          const blob = await encode(canvas, MIME.png);
          files.push({ size, name: `favicon-${size}.png`, blob, url: URL.createObjectURL(blob) });
        }

        const ico = buildIco(
          await Promise.all(
            ICO_SIZES.map(async (size) => {
              const match = files.find((file) => file.size === size)!;
              return { size, bytes: new Uint8Array(await match.blob.arrayBuffer()) };
            })
          )
        );

        if (cancelled) {
          files.forEach((file) => URL.revokeObjectURL(file.url));
          return;
        }
        setSet((previous) => {
          previous?.files.forEach((file) => URL.revokeObjectURL(file.url));
          return { files, ico, name: source.name };
        });
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, background]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="image/*"
        icon="sparkle"
        paste
        title="Sleep je logo hierheen"
        hint="vierkant werkt het best — of plak er een"
      />

      {error && <Note kind="error">{error}</Note>}
      {busy && <Note kind="ok">Bezig met maken…</Note>}

      {set && (
        <>
          <Panel title="Achtergrond">
            <Field
              label="Vulkleur"
              hint="Een doorzichtig logo kan wegvallen op een donkere tabbladbalk."
            >
              <span className="tp-check">
                <input
                  type="checkbox"
                  checked={Boolean(background)}
                  onChange={(event) => setBackground(event.target.checked ? "#ffffff" : "")}
                />
                {background && (
                  <input
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                    aria-label="Vulkleur kiezen"
                  />
                )}
              </span>
            </Field>
          </Panel>

          <Panel title={`${set.files.length + 1} bestanden`}>
            <ul className="tp-rows">
              <ResultFile
                name="favicon.ico"
                blob={set.ico}
                meta={`${ICO_SIZES.join(", ")} px · ${formatBytes(set.ico.size)}`}
                onDownload={() => download("favicon.ico", set.ico)}
              />
              {set.files.map((file) => (
                <ResultFile
                  key={file.size}
                  name={file.name}
                  blob={file.blob}
                  previewUrl={file.url}
                  meta={`${file.size}×${file.size} · ${formatBytes(file.blob.size)}`}
                />
              ))}
            </ul>

            <Actions>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const entries = [
                    { name: "favicon.ico", data: set.ico },
                    ...set.files.map((file) => ({ name: file.name, data: file.blob })),
                  ];
                  const names = uniqueNames(entries.map((entry) => entry.name));
                  const zip = await makeZip(
                    entries.map((entry, at) => ({ name: names[at], data: entry.data }))
                  );
                  download("favicons.zip", zip);
                }}
              >
                <Icon name="download" size={16} /> Alles als zip
              </button>
            </Actions>
          </Panel>

          <Panel title="In je HTML">
            <pre className="tp-out">{SNIPPET}</pre>
            <Actions>
              <CopyButton text={SNIPPET} />
            </Actions>
          </Panel>
        </>
      )}
    </>
  );
}
