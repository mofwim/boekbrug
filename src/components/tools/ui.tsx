// src/components/tools/ui.tsx
// [PDF-TOOLS] The parts every tool is assembled from.
//
// A tool page should read as its own decisions and nothing else — which file it
// takes, what it does to it, what comes out. Dropping files, panels, notes,
// download buttons and result rows all behave identically everywhere, so they
// live here once.
//
// Everything is scoped under .tp in tools.css, so none of it can reach the rest
// of the app and Tailwind cannot reach in.
"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";

export { formatBytes } from "@/lib/tools/image";
export { Icon };

/** Hand a blob or string to the browser as a download. */
export function download(name: string, data: Blob | string, mime = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(value: string, fallback = "bestand"): string {
  const cleaned = String(value || "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

// ---------------------------------------------------------------------------

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="tp-panel">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function Note({
  kind = "ok",
  children,
}: {
  kind?: "ok" | "warn" | "error";
  children: ReactNode;
}) {
  const icon = kind === "ok" ? "check" : "alert";
  return (
    <p className={`tp-note tp-note-${kind}`} role={kind === "error" ? "alert" : undefined}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="tp-actions">{children}</div>;
}

/**
 * The way a file gets in: dropped on it, or picked through it. Also accepts a
 * paste straight from the clipboard, which is how a screenshot arrives.
 */
export function FileDrop({
  onFiles,
  accept,
  multiple = false,
  title = "Sleep een bestand hierheen",
  hint = "of klik om te kiezen",
  icon = "download",
  paste = false,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
  icon?: string;
  paste?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = useCallback(
    (list: FileList | File[] | null) => {
      const files = [...(list || [])].filter(Boolean);
      if (files.length) onFiles(multiple ? files : [files[0]]);
    },
    [onFiles, multiple]
  );

  useEffect(() => {
    if (!paste) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) take(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [paste, take]);

  return (
    <div
      className={`tp-drop${dragging ? " is-dragging" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files);
      }}
    >
      <Icon name={icon} size={26} />
      <strong>{title}</strong>
      <small>{hint}</small>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * A labelled control row.
 *
 * `htmlFor` is set only when the caller asked for an id — the render-prop form.
 * Without it the label falls back to naming its first labelable descendant,
 * which is what makes a slider or a switch announce itself to a screen reader.
 * A `for` pointing at an id that nothing carries is WORSE than no `for` at all:
 * it cancels that fallback and the control ends up with no name.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  const addressed = typeof children === "function";
  return (
    <label className="tp-field" htmlFor={addressed ? id : undefined}>
      <span className="tp-field-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {addressed ? (children as (id: string) => ReactNode)(id) : children}
    </label>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <span className="tp-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>
        {value}
        {suffix}
      </output>
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <span className="tp-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** A file that came out of a tool: preview, size, and a way to keep it. */
export function ResultFile({
  name,
  blob,
  previewUrl,
  meta,
  onDownload,
  saveLabel = "Opslaan",
}: {
  name: string;
  blob?: Blob;
  previewUrl?: string;
  meta?: string;
  onDownload?: () => void;
  saveLabel?: string;
}) {
  return (
    <li>
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="tp-thumb" src={previewUrl} alt="" />
      ) : (
        <Icon name="file" size={18} />
      )}
      <span className="tp-row-text">
        <strong>{name}</strong>
        <span>{meta}</span>
      </span>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        onClick={() => (onDownload ? onDownload() : blob && download(name, blob))}
      >
        <Icon name="download" size={15} /> {saveLabel}
      </button>
    </li>
  );
}
