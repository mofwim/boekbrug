// [VOERTUIG] Pure node test — run: npx tsx src/lib/vehicle.test.ts
import {
  normalizeKenteken, displayKenteken, isKentekenShape,
  daysUntil, apkStatus, sortByApkUrgency, vehiclesNeedingApk,
} from "./vehicle";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— the plate, however he types it —");
// The same car typed five ways must reach the same record, or the garage ends up with five cars.
check("dashes, spaces and case all collapse to one form",
  normalizeKenteken("12-ab-3") === "12AB3"
  && normalizeKenteken("12 AB 3") === "12AB3"
  && normalizeKenteken("12ab3") === "12AB3");
check("empty input is an empty plate, not a crash",
  normalizeKenteken(null) === "" && normalizeKenteken(undefined) === "" && normalizeKenteken("") === "");

console.log("\n— printed the way it is on the car —");
// Derived from the sidecode SHAPE, so a plate issued next year formats right the day it exists.
check("sidecode 1  XX-99-99", displayKenteken("AB1234") === "AB-12-34");
check("sidecode 2  99-99-XX", displayKenteken("1234AB") === "12-34-AB");
check("sidecode 3  99-XX-99", displayKenteken("12AB34") === "12-AB-34");
check("sidecode 4  XX-99-XX", displayKenteken("AB12CD") === "AB-12-CD");
check("sidecode 5  XX-XX-99", displayKenteken("ABCD12") === "AB-CD-12");
check("sidecode 6  99-XX-XX", displayKenteken("12ABCD") === "12-AB-CD");
check("sidecode 7  99-XXX-9", displayKenteken("12ABC3") === "12-ABC-3");
check("sidecode 8  9-XXX-99", displayKenteken("1ABC23") === "1-ABC-23");
check("sidecode 9  XX-999-X", displayKenteken("AB123C") === "AB-123-C");
check("sidecode 10 X-999-XX", displayKenteken("A123BC") === "A-123-BC");
check("sidecode 11 XXX-99-X", displayKenteken("ABC12D") === "ABC-12-D");
check("sidecode 12 X-99-XXX", displayKenteken("A12BCD") === "A-12-BCD");
check("sidecode 13 9-XX-999", displayKenteken("1AB234") === "1-AB-234");
check("sidecode 14 999-XX-9", displayKenteken("123AB4") === "123-AB-4");
check("an already-formatted plate survives a round trip", displayKenteken("12-ABC-3") === "12-ABC-3");
// A typo grouped like a real plate would look official, and the owner is the one who must spot it.
check("something that is not a plate is NOT dressed up as one",
  displayKenteken("ABCDEF") === "ABCDEF" && displayKenteken("123456") === "123456");
check("a too-short plate is left alone", displayKenteken("AB12") === "AB12");
check("an empty plate renders empty", displayKenteken(null) === "");

console.log("\n— could this be a Dutch plate at all —");
check("real shapes pass", isKentekenShape("12-ABC-3") && isKentekenShape("AB12CD") && isKentekenShape("1abc23"));
check("six letters is not a shape any sidecode has", !isKentekenShape("ABCDEF"));
check("six digits is not either", !isKentekenShape("123456"));
check("wrong length is refused", !isKentekenShape("AB123") && !isKentekenShape("AB12CD7"));
check("nothing is refused", !isKentekenShape("") && !isKentekenShape(null));

console.log("\n— how long until the APK —");
check("a date in the future counts forward", daysUntil("2026-09-19", "2026-08-20") === 30);
check("today is zero", daysUntil("2026-08-20", "2026-08-20") === 0);
check("a passed date counts negative", daysUntil("2026-08-10", "2026-08-20") === -10);
// Crossing a month and a year must not drift — this is the arithmetic the reminders stand on.
check("it crosses a year boundary", daysUntil("2027-01-01", "2026-12-31") === 1);
check("it crosses a leap day", daysUntil("2028-03-01", "2028-02-28") === 2);
check("an absent or malformed date is null, never a number",
  daysUntil(null, "2026-08-20") === null
  && daysUntil("morgen", "2026-08-20") === null
  && daysUntil("2026-8-2", "2026-08-20") === null);

console.log("\n— where the APK stands —");
const today = "2026-08-20";
check("yesterday is expired", apkStatus("2026-08-19", today) === "expired");
check("today itself is still due, not expired", apkStatus(today, today) === "due");
check("inside thirty days is due", apkStatus("2026-09-15", today) === "due");
check("day thirty is still due", apkStatus("2026-09-19", today) === "due");
check("day thirty-one is soon", apkStatus("2026-09-20", today) === "soon");
check("day sixty is soon", apkStatus("2026-10-19", today) === "soon");
check("day sixty-one is ok", apkStatus("2026-10-20", today) === "ok");
// 'unknown' must never collapse into 'ok': the cars a reminder list forgets are invisible by
// construction, which is what would make the whole feature worthless.
check("a car with no known APK is 'unknown', NOT 'ok'", apkStatus(null, today) === "unknown");

console.log("\n— the order a garage reads its list in —");
{
  const fleet = [
    { kenteken: "AAA111", apk_expiry: "2026-12-01" }, // ok
    { kenteken: "BBB222", apk_expiry: null },          // unknown
    { kenteken: "CCC333", apk_expiry: "2026-08-10" },  // expired
    { kenteken: "DDD444", apk_expiry: "2026-09-01" },  // due
    { kenteken: "EEE555", apk_expiry: "2026-08-01" },  // expired, longer ago
    { kenteken: "FFF666", apk_expiry: "2026-10-01" },  // soon
  ];
  const sorted = sortByApkUrgency(fleet, today);
  check("the longest-overdue car is first", sorted[0].kenteken === "EEE555");
  check("…then the other overdue one", sorted[1].kenteken === "CCC333");
  check("…then what is due", sorted[2].kenteken === "DDD444");
  check("…then soon, then ok", sorted[3].kenteken === "FFF666" && sorted[4].kenteken === "AAA111");
  check("a car with no known APK sorts last but is never dropped",
    sorted[5].kenteken === "BBB222" && sorted.length === fleet.length);
  // A list that reshuffles between renders looks broken even when it is right.
  check("the sort is stable across repeated calls",
    JSON.stringify(sortByApkUrgency(fleet, today)) === JSON.stringify(sortByApkUrgency(fleet, today)));
  check("sorting does not mutate the caller's array", fleet[0].kenteken === "AAA111");

  // The home surface: what he should be calling people about today.
  const calling = vehiclesNeedingApk(fleet, today);
  check("only overdue and due reach the reminder list", calling.length === 3);
  check("…in the same urgency order",
    calling.map((v) => v.kenteken).join() === "EEE555,CCC333,DDD444");
  check("an unknown APK is not a reminder (there is no date to remind about)",
    !calling.some((v) => v.kenteken === "BBB222"));
  check("an empty fleet produces an empty list, not a crash",
    vehiclesNeedingApk([], today).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
