// [SEC-STORAGE-PATH] Pure node test — run: npx tsx src/lib/storage-path.test.ts
import { toStoragePath, storagePathOwner, pathBelongsToOwner, ownedStoragePath } from "./storage-path";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const ME = "11111111-2222-3333-4444-555555555555";
const VICTIM = "99999999-8888-7777-6666-555555555555";

console.log("\n— normalising what a row actually stores —");
{
  check("a raw key is already a path", toStoragePath(`${ME}/incoming/1700-bon.pdf`) === `${ME}/incoming/1700-bon.pdf`);
  check("a legacy SIGNED url yields its key",
    toStoragePath(`https://x.supabase.co/storage/v1/object/sign/documents/${ME}/facturen/001-2026.pdf?token=abc`)
      === `${ME}/facturen/001-2026.pdf`);
  check("a legacy PUBLIC url yields its key",
    toStoragePath(`https://x.supabase.co/storage/v1/object/public/documents/${ME}/incoming/a%20b.pdf`)
      === `${ME}/incoming/a b.pdf`);
  check("an unknown url shape is returned untouched, to be refused later",
    toStoragePath("https://evil.example/whatever.pdf") === "https://evil.example/whatever.pdf");
  check("null is the empty string, never the text 'null'", toStoragePath(null) === "");
  check("a malformed %-escape does not throw inside an auth check",
    typeof toStoragePath(`https://x/storage/v1/object/sign/documents/${ME}/a%ZZ.pdf`) === "string");
}

console.log("\n— whose bytes are these? —");
{
  check("the first segment is the owner", storagePathOwner(`${ME}/incoming/x.pdf`) === ME);
  check("…case-insensitively, normalised down", storagePathOwner(`${ME.toUpperCase()}/incoming/x.pdf`) === ME);
  check("a key with no uuid prefix has no owner", storagePathOwner("incoming/x.pdf") === null);
  check("a bare filename has no owner", storagePathOwner("factuur.pdf") === null);
  check("an empty value has no owner", storagePathOwner("") === null && storagePathOwner(null) === null);
  check("a full URL is not a key", storagePathOwner("https://x/y.pdf") === null);
  check("an absolute key is refused", storagePathOwner("/etc/passwd") === null);
  check("traversal is refused outright", storagePathOwner(`${ME}/../${VICTIM}/facturen/001.pdf`) === null);
  check("…anywhere in the key", storagePathOwner(`${ME}/incoming/../../x.pdf`) === null);
  check("backslash tricks are refused", storagePathOwner(`${ME}\\..\\${VICTIM}\\x.pdf`) === null);
}

console.log("\n— THE GUARD: a path the caller wrote may only be signed for its own owner —");
{
  check("my own file, for me → allowed", pathBelongsToOwner(`${ME}/incoming/bon.pdf`, ME));
  check("my own sent invoice, for me → allowed", pathBelongsToOwner(`${ME}/facturen/001-2026.pdf`, ME));

  // The actual attack: put someone else's key on a row you are allowed to write.
  check("THE ATTACK: another tenant's key on my own invoice → refused",
    pathBelongsToOwner(`${VICTIM}/facturen/001-2026.pdf`, ME) === false);
  check("…and enumerating their incoming folder is refused too",
    pathBelongsToOwner(`${VICTIM}/incoming/1700-bon.pdf`, ME) === false);
  check("…and so is a legacy signed URL pointing at them",
    pathBelongsToOwner(toStoragePath(`https://x/storage/v1/object/sign/documents/${VICTIM}/facturen/002-2026.pdf?token=t`), ME) === false);

  // Everything unprovable fails CLOSED.
  check("a key with no owner segment is refused, not assumed mine",
    pathBelongsToOwner("incoming/bon.pdf", ME) === false);
  check("an unrecognised URL shape is refused", pathBelongsToOwner("https://evil.example/x.pdf", ME) === false);
  check("a null owner never matches", pathBelongsToOwner(`${ME}/incoming/x.pdf`, null) === false);
  check("a non-uuid owner never matches", pathBelongsToOwner(`${ME}/incoming/x.pdf`, "admin") === false);
  check("an empty path never matches", pathBelongsToOwner("", ME) === false);
  check("a uuid PREFIX is not a uuid match",
    pathBelongsToOwner(`${ME}extra/incoming/x.pdf`, ME) === false);
  check("a folder that merely CONTAINS the uuid deeper down is not ownership",
    pathBelongsToOwner(`${VICTIM}/${ME}/x.pdf`, ME) === false);
}

console.log("\n— THE CHOKE POINT: normalise and attribute in one call —");
{
  // The two-step form is two expressions, and the bug this replaces was always the SECOND one
  // missing: four service_role callers normalised (or did not) and then downloaded anyway.
  check("my own key comes back as a key", ownedStoragePath(`${ME}/incoming/bon.pdf`, ME) === `${ME}/incoming/bon.pdf`);
  check("a legacy signed URL of mine is normalised on the way through",
    ownedStoragePath(`https://x/storage/v1/object/sign/documents/${ME}/facturen/001.pdf?token=t`, ME)
      === `${ME}/facturen/001.pdf`);

  // THE ATTACK, end to end: documents_update_own and invoices_zzp_update are whole-row policies,
  // so the owner may point their own row at anyone's key. Only this call stands between that and
  // a service_role download.
  check("another tenant's key on my own row → null, not a path",
    ownedStoragePath(`${VICTIM}/facturen/001.pdf`, ME) === null);
  check("…including when it arrives as a legacy URL",
    ownedStoragePath(`https://x/storage/v1/object/public/documents/${VICTIM}/incoming/bon.pdf`, ME) === null);
  check("traversal out of my own folder → null",
    ownedStoragePath(`${ME}/../${VICTIM}/facturen/001.pdf`, ME) === null);

  // Everything unprovable fails CLOSED — the caller skips the file rather than guessing.
  check("a legacy key with no owner segment → null", ownedStoragePath("incoming/bon.pdf", ME) === null);
  check("an empty stored value → null", ownedStoragePath("", ME) === null && ownedStoragePath(null, ME) === null);
  check("a missing owner never matches", ownedStoragePath(`${ME}/incoming/bon.pdf`, null) === null);
  check("it agrees with the two-step form it replaces", [
    `${ME}/incoming/bon.pdf`, `${VICTIM}/incoming/bon.pdf`, "incoming/bon.pdf", "",
    `https://x/storage/v1/object/sign/documents/${ME}/a.pdf?t=1`,
  ].every((v) => {
    const pad = toStoragePath(v);
    return ownedStoragePath(v, ME) === (pathBelongsToOwner(pad, ME) ? pad : null);
  }));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
