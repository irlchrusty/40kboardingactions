# Test Suite Guide

## Running the tests

```bash
node test.js
```

All tests must pass before committing changes. The suite currently covers file
structure, data integrity, game rule logic, and per-faction constraint behaviour.

---

## Adding tests for a new faction or detachment

### What section 3 already covers globally

**Do not write per-faction tests for any of the following.** Section 3
(`Data Integrity & Cross-References`) runs these checks automatically across
every faction every time the suite runs:

| Already covered globally | Example of what NOT to write |
|---|---|
| Unit IDs are unique within a faction | `"All X unit IDs are unique"` |
| Unit IDs don't collide across factions | `"No duplicate unit IDs across X and other factions"` |
| Detachment unit references resolve to real units | `"All X detachment unit IDs resolve to real units"` |
| Enhancement IDs are unique across detachments | `"Enhancement IDs are unique across X detachments"` |
| Required fields present (id, name, type, keywords, sizes) | `"X faction file exists and is valid JSON"` |
| `armyRule` has name and desc | `"X has required fields"` |
| `rulesAdaptations` is a non-empty string when present | `"Units with rulesAdaptations have a non-empty string"` |
| `maxFromGroup` unit IDs resolve to real units | `"maxFromGroup unit IDs all resolve to real X units"` |

Writing these tests in faction sections creates duplication that will
silently pass even if the global check catches the real bug first.

---

### What to write per-faction tests for

Focus exclusively on behaviour that section 3 cannot verify generically:

- **Points values** — exact `pts` for each size option
- **Keywords** — specific keywords a unit must or must not have (e.g. EPIC HERO, TERMINATOR)
- **Rules adaptations content** — that `rulesAdaptations` mentions the right ability name
- **Constraint logic** — character caps, exclusive groups, maxFromGroup limits, allowedSizeIndices, keyword ratios
- **Enhancement descriptions** — that desc text references the right keywords, distances, or ability names
- **Army/detachment rule descriptions** — that desc mentions the right ability names or conditions
- **Smoke tests** — legal list combinations that verify the interaction of multiple constraints

---

### Template for a new faction section

```js
// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("N. My Faction Faction");

const myFaction   = index.factions.find(f => f.id === "my_faction");
const myData      = factionData["my_faction"];
const myUnits     = myData ? myData.units : [];
const myDets      = myData ? myData.detachments : [];
const myUnit      = id => myUnits.find(u => u.id === id);

// ── Army rule ────────────────────────────────────────────────────────────────

test("My Faction has My Army Rule army rule", () => {
  assertEqual(myFaction.armyRule.name, "My Army Rule");
});

test("My Army Rule desc references key ability", () => {
  assert(myFaction.armyRule.desc.includes("Key Ability"),
    "army rule desc must mention 'Key Ability'");
});

// ── Detachment ───────────────────────────────────────────────────────────────

section("N+1. My Faction — My Detachment");

const myDet = myDets ? myDets.find(d => d.id === "my_detachment") : null;

test("My Detachment has maxCharacters set to 2", () => {
  assertEqual(myDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("My Detachment unit roster — correct IDs and maxes", () => {
  const find = id => myDet.units.find(u => u.id === id);
  assert(find("my_unit_a")?.max === 1, "my_unit_a max must be 1");
  assert(find("my_unit_b")?.max === 2, "my_unit_b max must be 2");
});

// ── Unit definitions ─────────────────────────────────────────────────────────

test("My Unit has correct fields", () => {
  const u = myUnit("my_unit_a");
  assert(!!u, "my_unit_a not found");
  assertEqual(u.name, "My Unit");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("MY FACTION"),  "must have MY FACTION keyword");
  assert(u.keywords.includes("EPIC HERO"),   "must have EPIC HERO keyword");
  assertEqual(u.sizes[0].pts, 95,            "must cost 95pts");
  assert(u.rulesAdaptations?.includes("Lost Ability"),
    "rulesAdaptations must reference 'Lost Ability'");
});

// ── Constraint logic ─────────────────────────────────────────────────────────

section("N+2. My Faction — Game Rule Logic");

const my = makeDetHelpers(myDet, id => myUnit(id));

test("Character cap — first CHARACTER can be added to an empty list", () => {
  assert(my.canAdd([], "my_unit_a"), "first CHARACTER must be addable");
});

test("Character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [{ unitId: "my_unit_a" }, { unitId: "my_unit_a" }];
  assert(!my.canAdd(list, "my_unit_b"),
    "third CHARACTER must be blocked when cap is reached");
});
```

---

### Stale count assertions

Avoid writing "now has N units" or "now has N detachments" assertions mid-build
if the final count is already pinned by a prior test. These become stale the
next time the faction is extended. Prefer a single count assertion at the
point where the faction is considered complete, and update it in place when
new units are added rather than adding a new assertion alongside the old one.

---

### Inline game-logic helpers

Use the `makeDetHelpers(det, unitLookup)` factory defined at the top of the
file to create constraint helpers for each detachment. Use Option B (namespace
object) so the helpers are clearly scoped:

```js
const ss  = makeDetHelpers(ssDet,  id => ecUnit(id));
const gk  = makeDetHelpers(bsDet,  id => gkUnit(id));
const vpf = makeDetHelpers(vpfDet, id => gkUnit(id));

// In tests:
assert(ss.canAdd([], "ec_lord_kakophonist"), "...");
assert(gk.canAdd(list, "gk_grand_master"),   "...");
```

`makeDetHelpers` returns `{ charCount, unitCount, unitMax, canAdd }` all
pre-bound to the given detachment and unit-lookup. Do not write the four
helper functions by hand — they are structurally identical across all
detachments and the factory eliminates the duplication.

For exclusive unit groups, use `makeExcGroupChecker(det.exclusiveUnitGroups)`:

```js
const isBlocked = makeExcGroupChecker(myDet.exclusiveUnitGroups);
assert(isBlocked("my_unit_a", list), "my_unit_a must be blocked");
```
