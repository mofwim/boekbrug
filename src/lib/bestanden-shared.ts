// src/lib/bestanden-shared.ts
// [BOEK-033] The folder names both sides of the server wall compare against.
// lib/bestanden.ts is server-only (it builds Supabase clients), but the screens need these
// NAMES too — to badge the shared folder, to sort it first — so they live here, importable
// from a Client Component without dragging the server client along.
// The values are Dutch by design: they are folder names STORED in the database, and renaming
// a stored value is a migration, not a translation (see AGENTS.md).

export const SHARED_FOLDER_NAME = "Gedeeld met boekhouder";

// [BOEK-033 Phase 1] Fallback folder for files that cannot be classified
// (no date, invalid date, low confidence). BOEK-011 imports land here when
// a path cannot be resolved — never in the root, never folder_id null.
export const IMPORTED_FOLDER_NAME = "Geïmporteerde bestanden";
