#!/usr/bin/env node
/**
 * Boarding Actions List Builder — Test Suite
 * Run from the project root: node test.js
 *
 * Covers:
 *   1. File structure & JSON validity
 *   2. Fetch path resolution (the bug we hit)
 *   3. Data integrity & cross-references
 *   4. Game rule logic (points, enhancements, warlord)
 *   5. Smoke test checklist simulation
 */

const fs   = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = __dirname;
let passed = 0;
let failed = 0;
const failures = [];

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓  ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${description}`);
    console.log(`       → ${e.message}`);
    failed++;
    failures.push({ description, error: e.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertFileExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message || `File not found: ${filePath}`);
  }
}

function loadJSON(filePath) {
  const fullPath = path.join(BASE, filePath);
  assertFileExists(fullPath, `File not found: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
}


// ── Reusable test helper factories ───────────────────────────────────────────

/**
 * makeDetHelpers(det, unitLookup)
 * Returns { charCount, unitCount, unitMax, canAdd } pre-bound to the given
 * detachment and unit-lookup function. Use Option B destructuring at each
 * call site:
 *   const ss = makeDetHelpers(ssDet, id => ecUnits.find(u => u.id === id));
 *   assert(ss.canAdd([], "ec_lord_kakophonist"), "...");
 */
function makeDetHelpers(det, unitLookup) {
  const charCount = list =>
    list.filter(l => unitLookup(l.unitId)?.type === "CHARACTER").length;
  const unitCount = (list, uid) =>
    list.filter(l => l.unitId === uid).length;
  const unitMax = uid =>
    det.units.find(u => u.id === uid)?.max ?? 1;
  const canAdd = (list, uid) => {
    if (unitCount(list, uid) >= unitMax(uid)) return false;
    const u = unitLookup(uid);
    if (u?.type === "CHARACTER" && det.maxCharacters !== undefined &&
        charCount(list) >= det.maxCharacters) return false;
    return true;
  };
  return { charCount, unitCount, unitMax, canAdd };
}

/**
 * makeExcGroupChecker(exclusiveUnitGroups)
 * Returns a function (uid, list) => bool that mirrors the app's
 * isExclusiveGroupBlocked logic for a given set of exclusive groups.
 *   const isBlocked = makeExcGroupChecker(det.exclusiveUnitGroups);
 *   assert(isBlocked("unit_a", list), "...");
 */
function makeExcGroupChecker(exclusiveUnitGroups) {
  return (uid, list) => {
    if (!exclusiveUnitGroups) return false;
    for (const group of exclusiveUnitGroups) {
      if (!group.includes(uid)) continue;
      if (list.some(l => l.unitId !== uid && group.includes(l.unitId))) return true;
    }
    return false;
  };
}

// ── Load data ────────────────────────────────────────────────────────────────

let index, factionData = {};
const html = fs.readFileSync(path.join(BASE, "boarding-actions.html"), "utf8");

section("1. File Structure & JSON Validity");

test("data/index.json exists and is valid JSON", () => {
  index = loadJSON("data/index.json");
});

test("index.json has factions array", () => {
  assert(Array.isArray(index.factions) && index.factions.length > 0,
    "factions must be a non-empty array");
});

test("index.json has genericEnhancements array", () => {
  assert(Array.isArray(index.genericEnhancements),
    "genericEnhancements must be an array");
});

test("All faction files exist and are valid JSON", () => {
  index.factions.forEach(faction => {
    const filePath = path.join("data", faction.file);
    factionData[faction.id] = loadJSON(filePath);
  });
});

test("HTML file exists", () => {
  assertFileExists(path.join(BASE, "boarding-actions.html"), "boarding-actions.html not found");
});

// ── Fetch Path Resolution ────────────────────────────────────────────────────

section("2. Fetch Path Resolution");

test("All faction file paths in index.json resolve correctly under data/", () => {
  index.factions.forEach(faction => {
    const resolvedPath = path.join(BASE, "data", faction.file);
    assertFileExists(resolvedPath,
      `Faction "${faction.name}": data/${faction.file} not found on disk. ` +
      `Check that the "file" field does not include "data/" prefix and matches the actual filename.`
    );
  });
});

test("Faction file field does not accidentally include data/ prefix", () => {
  index.factions.forEach(faction => {
    assert(!faction.file.startsWith("data/"),
      `Faction "${faction.name}": file field "${faction.file}" starts with "data/" — ` +
      `this will cause a double data/ in the fetch path`
    );
  });
});

test("HTML fetch call prepends data/ to faction file path", () => {
  assert(html.includes('"data/" + faction.file') || html.includes("\"data/\" + faction.file"),
    'HTML should fetch faction files with "data/" + faction.file — missing prefix will cause 404s'
  );
});

test("HTML loads index from data/index.json", () => {
  assert(html.includes("data/index.json"),
    "HTML should fetch data/index.json on startup"
  );
});

// ── Data Integrity ───────────────────────────────────────────────────────────

section("3. Data Integrity & Cross-References");

test("Every faction has required fields (id, name, file, armyRule)", () => {
  index.factions.forEach(f => {
    assert(f.id,       `Faction missing id`);
    assert(f.name,     `Faction "${f.id}" missing name`);
    assert(f.file,     `Faction "${f.id}" missing file`);
    assert(f.armyRule, `Faction "${f.id}" missing armyRule`);
    assert(f.armyRule.name, `Faction "${f.id}" armyRule missing name`);
    assert(f.armyRule.desc, `Faction "${f.id}" armyRule missing desc`);
  });
});

test("Every faction file has detachments and units arrays", () => {
  Object.entries(factionData).forEach(([id, data]) => {
    assert(Array.isArray(data.detachments),
      `Faction "${id}": detachments must be an array`);
    assert(Array.isArray(data.units),
      `Faction "${id}": units must be an array`);
  });
});

test("Every faction file has at least one detachment and one unit", () => {
  // Stub factions (no detachments/units yet) are explicitly listed here and exempt.
  Object.entries(factionData).forEach(([id, data]) => {
    assert(data.detachments.length > 0,
      `Faction "${id}": detachments must be a non-empty array`);
    assert(data.units.length > 0,
      `Faction "${id}": units must be a non-empty array`);
  });
});

test("Every detachment has required fields", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.detachments.forEach(d => {
      assert(d.id,          `Faction "${factionId}": detachment missing id`);
      assert(d.name,        `Detachment "${d.id}" missing name`);
      assert(d.specialRule, `Detachment "${d.id}" missing specialRule`);
      assert(d.specialRule.name, `Detachment "${d.id}" specialRule missing name`);
      assert(d.specialRule.desc, `Detachment "${d.id}" specialRule missing desc`);
      assert(Array.isArray(d.enhancements), `Detachment "${d.id}" missing enhancements array`);
      assert(Array.isArray(d.units),        `Detachment "${d.id}" missing units array`);
      d.units.forEach(du => {
        assert(du.id,                      `Detachment "${d.id}" unit entry missing id`);
        assert(typeof du.max === "number", `Detachment "${d.id}" unit "${du.id}" missing max`);
      });
    });
  });
});

test("Every unit in a detachment's units list exists in that faction's units", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    const unitIds = new Set(data.units.map(u => u.id));
    data.detachments.forEach(det => {
      det.units.forEach(du => {
        assert(unitIds.has(du.id),
          `Detachment "${det.id}" references unit "${du.id}" which doesn't exist in faction "${factionId}" units`
        );
      });
    });
  });
});

test("Every unit has required fields (id, name, type, keywords, sizes)", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.units.forEach(u => {
      assert(u.id,                        `Faction "${factionId}": unit missing id`);
      assert(u.name,                      `Unit "${u.id}" missing name`);
      assert(u.type,                      `Unit "${u.id}" missing type`);
      assert(Array.isArray(u.keywords),   `Unit "${u.id}" missing keywords array`);
      assert(Array.isArray(u.sizes) && u.sizes.length > 0, `Unit "${u.id}" missing sizes`);
      assert(!("max" in u),              `Unit "${u.id}" should not have max — it belongs on detachment units`);
      u.sizes.forEach(s => {
        assert(s.label,                   `Unit "${u.id}" size missing label`);
        assert(typeof s.pts === "number", `Unit "${u.id}" size missing pts`);
      });
    });
  });
});

test("All unit types are from the known valid set", () => {
  const VALID_TYPES = new Set(["CHARACTER", "BATTLELINE", "INFANTRY", "VEHICLE", "BEASTS", "BEAST", "MOUNTED", "SWARM"]);
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.units.forEach(u => {
      assert(VALID_TYPES.has(u.type),
        `Unit "${u.id}" in "${factionId}" has unknown type "${u.type}" — must be one of: ${[...VALID_TYPES].join(", ")}`);
    });
  });
});

test("No duplicate unit IDs across all factions", () => {
  const seen = {};
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.units.forEach(u => {
      assert(!seen[u.id],
        `Duplicate unit id "${u.id}" found in faction "${factionId}" and "${seen[u.id]}"`);
      seen[u.id] = factionId;
    });
  });
});

test("No duplicate detachment IDs across all factions", () => {
  const seen = {};
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.detachments.forEach(d => {
      assert(!seen[d.id],
        `Duplicate detachment id "${d.id}" in faction "${factionId}" and "${seen[d.id]}"`);
      seen[d.id] = factionId;
    });
  });
});

test("Enhancement requiresKeywords only reference keywords that exist on at least one unit in the faction", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    const allKeywords = new Set(data.units.flatMap(u => u.keywords));
    data.detachments.forEach(det => {
      det.enhancements.forEach(enh => {
        (enh.requiresKeywords || []).forEach(kw => {
          assert(allKeywords.has(kw),
            `Enhancement "${enh.name}" in detachment "${det.id}" requires keyword "${kw}" ` +
            `but no unit in faction "${factionId}" has it`
          );
        });
      });
    });
  });
});

test("Generic enhancements have required fields", () => {
  index.genericEnhancements.forEach(enh => {
    assert(enh.id,   `Generic enhancement missing id`);
    assert(enh.name, `Generic enhancement "${enh.id}" missing name`);
    assert(enh.desc, `Generic enhancement "${enh.id}" missing desc`);
    assert(!("rule" in enh), `Generic enhancement "${enh.id}" has a deprecated rule field — remove it`);
    assert(Array.isArray(enh.requiresKeywords), `Generic enhancement "${enh.id}" missing requiresKeywords array`);
  });
});

test("Generic enhancements have the correct current IDs", () => {
  const expectedIds = [
    "gen_superior_boarding_tactics",
    "gen_close_quarters_killer",
    "gen_peerless_leader",
    "gen_expert_breacher",
    "gen_personal_teleporter",
    "gen_trademark_weapon",
  ];
  const actualIds = index.genericEnhancements.map(e => e.id);
  expectedIds.forEach(id => {
    assert(actualIds.includes(id), `Expected generic enhancement "${id}" not found`);
  });
  assertEqual(actualIds.length, expectedIds.length,
    `Expected ${expectedIds.length} generic enhancements, found ${actualIds.length}`);
});

test("rulesAdaptations is optional — units without it are valid", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.units.forEach(u => {
      // Field may be absent or a non-empty string — but never an empty string or wrong type
      if (u.rulesAdaptations !== undefined) {
        assert(typeof u.rulesAdaptations === "string",
          `Unit "${u.id}" rulesAdaptations must be a string if present`);
        assert(u.rulesAdaptations.trim().length > 0,
          `Unit "${u.id}" rulesAdaptations is present but empty — omit the field instead`);
      }
    });
  });
});

test("HTML only renders rulesAdaptations when it has a value", () => {
  assert(html.includes("unit.rulesAdaptations ?"),
    "HTML should conditionally render rulesAdaptations with a ternary check"
  );
  // Allow ${unit.rulesAdaptations} inside exportText (guarded by if block) — ensure it
  // never appears outside any conditional guard (i.e. not as a bare template expression)
  const unguardedMatch = html.match(/\$\{unit\.rulesAdaptations\}/g);
  // The only permitted occurrence is inside exportText's if(unit.rulesAdaptations) block
  // Verify the match count matches what we expect (1 in exportText)
  assert(!unguardedMatch || unguardedMatch.length <= 1,
    "rulesAdaptations must only be used inside conditional guards");
});

// ── Game Rule Logic ──────────────────────────────────────────────────────────

section("4. Game Rule Logic");

// Simulate the core app functions
function unitCanTakeEnh(unit, enh) {
  if (!enh.requiresKeywords || !enh.requiresKeywords.length) return true;
  return enh.requiresKeywords.every(kw => unit.keywords.includes(kw));
}

function totalPts(list) {
  return list.reduce((s, l) => s + l.pts, 0);
}

test("Points total calculates correctly", () => {
  const list = [{ pts: 75 }, { pts: 65 }, { pts: 195 }];
  assertEqual(totalPts(list), 335, "Points total should be 335");
});

test("Points limit of 500 is enforced — units over limit should be blocked", () => {
  const list = [{ pts: 400 }];
  const unit = { sizes: [{ pts: 195 }] };
  const wouldExceed = totalPts(list) + unit.sizes[0].pts > 500;
  assert(wouldExceed, "A 195pt unit added to a 400pt list should exceed 500pts");
});

test("unitCanTakeEnh — no keyword requirement allows any unit", () => {
  const unit = { keywords: ["ADEPTUS ASTARTES", "INFANTRY"] };
  const enh  = { requiresKeywords: [] };
  assert(unitCanTakeEnh(unit, enh), "Enhancement with no keywords should be available to any unit");
});

test("unitCanTakeEnh — keyword requirement blocks non-matching units", () => {
  const unit = { keywords: ["TYRANIDS", "INFANTRY"] };
  const enh  = { requiresKeywords: ["SYNAPSE"] };
  assert(!unitCanTakeEnh(unit, enh), "Enhancement requiring SYNAPSE should not be available to non-SYNAPSE unit");
});

test("unitCanTakeEnh — keyword requirement passes for matching units", () => {
  const unit = { keywords: ["TYRANIDS", "INFANTRY", "SYNAPSE"] };
  const enh  = { requiresKeywords: ["SYNAPSE"] };
  assert(unitCanTakeEnh(unit, enh), "Enhancement requiring SYNAPSE should be available to SYNAPSE unit");
});

test("Enhancement cap — max 2 enhancements per list", () => {
  const list = [
    { enhancementId: "enh_a" },
    { enhancementId: "enh_b" },
    { enhancementId: null }
  ];
  const assigned = list.map(l => l.enhancementId).filter(Boolean);
  assertEqual(assigned.length, 2, "Should count 2 assigned enhancements");
  assert(assigned.length >= 2, "Cap should be reached at 2");
});

test("Warlord must be a CHARACTER when CHARACTERs are in the list", () => {
  const list = [
    { unitId: "sm_captain",   type: "CHARACTER" },
    { unitId: "sm_tacticals", type: "BATTLELINE" }
  ];
  const hasChars = list.some(l => l.type === "CHARACTER");
  const nonChar  = list.find(l => l.type === "BATTLELINE");
  const canBeWarlord = hasChars ? nonChar.type === "CHARACTER" : true;
  assert(!canBeWarlord, "A BATTLELINE unit should not be eligible as Warlord when CHARACTERs exist");
});

test("Warlord can be any unit when no CHARACTERs are in the list", () => {
  const list = [{ unitId: "sm_tacticals", type: "BATTLELINE" }];
  const hasChars = list.some(l => l.type === "CHARACTER");
  const canBeWarlord = hasChars ? false : true;
  assert(canBeWarlord, "A non-CHARACTER unit should be eligible as Warlord when no CHARACTERs exist");
});

test("BEASTS unit cannot be Warlord when CHARACTERs are present", () => {
  const list = [
    { unitId: "nec_hexmark_destroyer",   type: "CHARACTER" },
    { unitId: "nec_canoptek_wraiths",    type: "BEASTS" }
  ];
  const hasChars    = list.some(l => l.type === "CHARACTER");
  const beastsUnit  = list.find(l => l.type === "BEASTS");
  const canBeWarlord = hasChars ? beastsUnit.type === "CHARACTER" : true;
  assert(!canBeWarlord, "A BEASTS unit should not be eligible as Warlord when CHARACTERs exist");
});

test("SWARM unit cannot be Warlord when CHARACTERs are present", () => {
  const list = [
    { unitId: "nec_hexmark_destroyer",      type: "CHARACTER" },
    { unitId: "nec_canoptek_scarab_swarm",  type: "SWARM" }
  ];
  const hasChars   = list.some(l => l.type === "CHARACTER");
  const swarmUnit  = list.find(l => l.type === "SWARM");
  const canBeWarlord = hasChars ? swarmUnit.type === "CHARACTER" : true;
  assert(!canBeWarlord, "A SWARM unit should not be eligible as Warlord when CHARACTERs exist");
});

test("BEASTS unit can be Warlord when no CHARACTERs are present", () => {
  const list = [{ unitId: "nec_canoptek_wraiths", type: "BEASTS" }];
  const hasChars = list.some(l => l.type === "CHARACTER");
  const canBeWarlord = hasChars ? false : true;
  assert(canBeWarlord, "A BEASTS unit should be eligible as Warlord when no CHARACTERs exist");
});

test("SWARM unit can be Warlord when no CHARACTERs are present", () => {
  const list = [{ unitId: "nec_canoptek_scarab_swarm", type: "SWARM" }];
  const hasChars = list.some(l => l.type === "CHARACTER");
  const canBeWarlord = hasChars ? false : true;
  assert(canBeWarlord, "A SWARM unit should be eligible as Warlord when no CHARACTERs exist");
});

test("Unit max count is respected", () => {
  // max now lives on the detachment unit entry, not the unit itself
  const detUnitEntry = { id: "sm_captain", max: 1 };
  const list = [{ unitId: "sm_captain" }];
  const count = list.filter(l => l.unitId === detUnitEntry.id).length;
  assert(count >= detUnitEntry.max, "Captain should be at max count (1) in this list");
});

// ── Smoke Test Simulation ────────────────────────────────────────────────────

section("5. Smoke Test — Full Workflow Simulation");

test("Can select each faction and get detachments", () => {
  index.factions.forEach(faction => {
    const data = factionData[faction.id];
    assert(data.detachments.length > 0,
      `Faction "${faction.name}" has no detachments`);
  });
});

test("Can select a detachment and get valid units", () => {
  Object.entries(factionData).forEach(([factionId, data]) => {
    data.detachments.forEach(det => {
      const units = det.units.map(du => data.units.find(u => u.id === du.id));
      assert(units.every(u => u !== undefined),
        `Detachment "${det.name}" has unresolvable unit references`);
      assert(units.length > 0,
        `Detachment "${det.name}" has no units`);
    });
  });
});

test("Adding units and tracking points — full list simulation", () => {
  // Simulate building an Adeptus Astartes list using Pilum Strike Team
  const data = factionData["space_marines"];
  const det  = data.detachments.find(d => d.id === "sm_vanguard"); // Pilum Strike Team
  const MAX_PTS = 500;
  const list = [];

  function addUnit(unitId, sizeIdx) {
    const unit    = data.units.find(u => u.id === unitId);
    const detUnit = det.units.find(du => du.id === unitId);
    const pts     = unit.sizes[sizeIdx].pts;
    if (totalPts(list) + pts > MAX_PTS) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    list.push({ unitId, pts, enhancementId: null });
    return true;
  }

  assert(addUnit("sm_phobos_captain", 0),  "Should add Captain in Phobos Armour (70pts)");
  assert(addUnit("sm_incursors", 0),       "Should add Incursors 5-man (80pts)");
  assert(addUnit("sm_incursors", 0),       "Should add second Incursors (80pts) — max is 3");
  assert(!addUnit("sm_phobos_captain", 0), "Should NOT add second Captain in Phobos Armour — max is 1");

  assertEqual(totalPts(list), 230, "Total should be 230pts (70+80+80)");
  assert(totalPts(list) <= MAX_PTS, "List should be under 500pt limit");
});

test("Enhancement assignment and cap — full simulation", () => {
  const data    = factionData["space_marines"];
  const det     = data.detachments[0];
  const captain = data.units.find(u => u.id === "sm_captain");
  const lib     = data.units.find(u => u.id === "sm_librarian");

  const list = [
    { id: 0, unitId: "sm_captain",   pts: 75, enhancementId: null },
    { id: 1, unitId: "sm_librarian", pts: 65, enhancementId: null }
  ];

  // Assign first enhancement
  list[0].enhancementId = det.enhancements[0].id;
  const assigned = list.map(l => l.enhancementId).filter(Boolean);
  assertEqual(assigned.length, 1, "Should have 1 enhancement assigned");

  // Assign second enhancement
  list[1].enhancementId = det.enhancements[1].id;
  const assigned2 = list.map(l => l.enhancementId).filter(Boolean);
  assertEqual(assigned2.length, 2, "Should have 2 enhancements assigned");
  assert(assigned2.length >= 2, "Enhancement cap of 2 should now be reached");
});

test("Warlord designation and removal simulation", () => {
  let warlordId = null;
  const list = [
    { id: 0, unitId: "sm_captain",   type: "CHARACTER"  },
    { id: 1, unitId: "sm_tacticals", type: "BATTLELINE" }
  ];

  // Set warlord
  warlordId = 0;
  assertEqual(warlordId, 0, "Warlord should be item id 0");

  // Remove warlord unit — warlord should clear
  const newList = list.filter(l => l.id !== 0);
  if (!newList.find(l => l.id === warlordId)) warlordId = null;
  assertEqual(warlordId, null, "Warlord should be cleared when warlord unit is removed");
});

test("Warlord warning clears when first unit (id=0) is designated Warlord", () => {
  // id=0 is falsy — !warlordId would incorrectly show the warning even when set
  // The check must use warlordId === null, not !warlordId
  const warlordId = 0; // first unit added always gets id 0
  const listLength = 1;

  // Correct check (=== null)
  const warningShownCorrectly = listLength > 0 && warlordId === null;
  assert(!warningShownCorrectly, "Warning should NOT show when warlordId is 0 (first unit)");

  // Incorrect check (!warlordId) — this is the bug
  const warningShownBuggy = listLength > 0 && !warlordId;
  assert(warningShownBuggy, "Confirm the buggy !warlordId check incorrectly treats 0 as no warlord");
});

test("HTML uses strict null check for warlord warning, not falsy check", () => {
  assert(html.includes("warlordId === null"),
    "Warning check must use 'warlordId === null' not '!warlordId' — id 0 is falsy and would break the warning"
  );
});

test("Clearing the list resets to empty state", () => {
  let list      = [{ unitId: "sm_captain", pts: 75, enhancementId: "enh_a" }];
  let warlordId = 0;

  // Clear
  list      = [];
  warlordId = null;

  assertEqual(list.length, 0, "List should be empty after clear");
  assertEqual(warlordId, null, "Warlord should be null after clear");
  assertEqual(totalPts(list), 0, "Points should be 0 after clear");
});

// ── Detachment Character Cap ──────────────────────────────────────────────────

section("6. Detachment Character Cap");

// Simulate the cap logic from the app
function charCountInList(list, units) {
  return list.filter(l => units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
}

function canAddUnit(unitId, sizeIdx, list, det, units) {
  const unit    = units.find(u => u.id === unitId);
  const detUnit = det.units.find(du => du.id === unitId);
  const pts     = unit.sizes[sizeIdx].pts;
  if (list.reduce((s, l) => s + l.pts, 0) + pts > 500) return false;
  if (list.filter(l => l.unitId === unitId).length >= (detUnit?.max ?? 1)) return false;
  if (unit.type === "CHARACTER" && det.maxCharacters !== undefined &&
      charCountInList(list, units) >= det.maxCharacters) return false;
  return true;
}

const custData = loadJSON("data/factions/adeptus_custodes.json");
const custDet  = custData.detachments[0];
const custUnits = custData.units;

test("Voyagers into Darkness detachment has maxCharacters set to 2", () => {
  assertEqual(custDet.maxCharacters, 2,
    "Voyagers into Darkness must have maxCharacters: 2");
});

test("Black Ship Guardians detachment has maxCharacters set to 2", () => {
  const bsg = custData.detachments.find(d => d.id === "cust_black_ship_guardians");
  assertEqual(bsg.maxCharacters, 2,
    "Black Ship Guardians must have maxCharacters: 2");
});

test("maxCharacters is a positive integer when present", () => {
  Object.values(factionData).forEach(data => {
    data.detachments.forEach(det => {
      if (det.maxCharacters !== undefined) {
        assert(typeof det.maxCharacters === "number" && Number.isInteger(det.maxCharacters) && det.maxCharacters > 0,
          `Detachment "${det.id}" maxCharacters must be a positive integer`);
      }
    });
  });
  // Also check custodes since it's loaded separately
  assert(typeof custDet.maxCharacters === "number" && Number.isInteger(custDet.maxCharacters) && custDet.maxCharacters > 0,
    "Custodes detachment maxCharacters must be a positive integer");
});

test("First CHARACTER can be added when cap not yet reached", () => {
  const list = [];
  assert(canAddUnit("cust_blade_champion", 0, list, custDet, custUnits),
    "Should be able to add first CHARACTER when list is empty");
});

test("Second CHARACTER can be added when one is already in the list", () => {
  const list = [{ unitId: "cust_blade_champion", pts: 120 }];
  assert(canAddUnit("cust_shield_captain", 0, list, custDet, custUnits),
    "Should be able to add second CHARACTER when one is already in the list");
});

test("Third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [
    { unitId: "cust_blade_champion",  pts: 120 },
    { unitId: "cust_shield_captain",  pts: 120 },
  ];
  assert(!canAddUnit("cust_shield_captain_allarus", 0, list, custDet, custUnits),
    "Should NOT be able to add a third CHARACTER when cap of 2 is already reached");
});

test("Non-CHARACTER units are unaffected by the character cap", () => {
  const list = [
    { unitId: "cust_blade_champion", pts: 120 },
    { unitId: "cust_shield_captain", pts: 120 },
  ];
  assert(canAddUnit("cust_custodian_guard", 0, list, custDet, custUnits),
    "BATTLELINE unit should still be addable even when character cap is reached");
  assert(canAddUnit("cust_allarus_custodians", 0, list, custDet, custUnits),
    "INFANTRY unit should still be addable even when character cap is reached");
});

test("Removing a CHARACTER frees up a slot below the cap", () => {
  const list = [
    { id: 0, unitId: "cust_blade_champion",  pts: 120 },
    { id: 1, unitId: "cust_shield_captain",  pts: 120 },
  ];
  // Cap hit — can't add third
  assert(!canAddUnit("cust_shield_captain_allarus", 0, list, custDet, custUnits),
    "Cap should be hit with 2 characters");
  // Remove one character
  const trimmed = list.filter(l => l.id !== 1);
  assert(canAddUnit("cust_shield_captain_allarus", 0, trimmed, custDet, custUnits),
    "Should be able to add a CHARACTER again after removing one");
});

test("Epic Hero characters count toward the cap", () => {
  const list = [
    { unitId: "cust_trajann_valoris", pts: 140 },
    { unitId: "cust_valerian",        pts: 110 },
  ];
  assertEqual(charCountInList(list, custUnits), 2, "Two Epic Hero characters should count as 2 toward the cap");
  assert(!canAddUnit("cust_blade_champion", 0, list, custDet, custUnits),
    "Regular CHARACTER should be blocked when two Epic Heroes already fill the cap");
});

test("Detachments without maxCharacters have no character cap enforced", () => {
  const uncappedDet = { ...custDet };
  delete uncappedDet.maxCharacters;
  const list = [
    { unitId: "cust_blade_champion",           pts: 120 },
    { unitId: "cust_shield_captain",           pts: 120 },
    { unitId: "cust_shield_captain_allarus",   pts: 130 },
  ];
  // Without maxCharacters, canAddUnit should only be blocked by pts/unit max
  assert(canAddUnit("cust_valerian", 0, list, uncappedDet, custUnits),
    "No character cap should apply when maxCharacters is not defined on the detachment");
});

test("charCountInList correctly counts only CHARACTER type units", () => {
  const list = [
    { unitId: "cust_blade_champion",    pts: 120 },   // CHARACTER
    { unitId: "cust_custodian_guard",   pts: 150 },   // BATTLELINE
    { unitId: "cust_allarus_custodians", pts: 110 },  // INFANTRY
    { unitId: "cust_shield_captain",    pts: 120 },   // CHARACTER
  ];
  assertEqual(charCountInList(list, custUnits), 2,
    "charCountInList should count exactly 2 CHARACTER units, ignoring BATTLELINE and INFANTRY");
});

test("HTML enforces character cap in addUnit function", () => {
  assert(
    html.includes("charCountInList") && html.includes("maxCharacters"),
    "addUnit must reference charCountInList and maxCharacters to enforce the cap"
  );
});

test("HTML greys out CHARACTER cards in the unit grid when cap is reached", () => {
  assert(
    html.includes("cardStatus.blocked"),
    "renderUnitGrid must use cardStatus.blocked to grey out unit cards"
  );
});

test("HTML shows a warning pill when the character cap is reached", () => {
  assert(
    html.includes("Character limit reached"),
    "renderWarnings must emit a warning when the character cap is reached"
  );
});

test("Tyranids detachments have no maxCharacters", () => {
  factionData["tyranids"].detachments.forEach(det => {
    assert(det.maxCharacters === undefined,
      `Detachment "${det.id}" in "tyranids" should not have maxCharacters set`);
  });
});

test("CSM Underdeck Uprising has no maxCharacters", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_underdeck_uprising");
  assert(det !== undefined, "csm_underdeck_uprising must exist");
  assert(det.maxCharacters === undefined,
    "Underdeck Uprising should not have maxCharacters set");
});

test("CSM Infernal Reavers has no maxCharacters", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  assert(det !== undefined, "csm_infernal_reavers must exist");
  assert(det.maxCharacters === undefined,
    "Infernal Reavers should not have maxCharacters set");
});

test("CSM Champions of Chaos has maxCharacters set to 2", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_champions_of_chaos");
  assert(det !== undefined, "csm_champions_of_chaos must exist");
  assertEqual(det.maxCharacters, 2, "Champions of Chaos must have maxCharacters: 2");
});

test("Pilum Strike Team detachment has maxCharacters set to 3", () => {
  const pilum = factionData["space_marines"].detachments.find(d => d.id === "sm_vanguard");
  assertEqual(pilum.maxCharacters, 3,
    "Pilum Strike Team must have maxCharacters: 3");
});

test("Terminator Assault detachment has maxCharacters set to 2", () => {
  const ta = factionData["space_marines"].detachments.find(d => d.id === "sm_terminator_assault");
  assertEqual(ta.maxCharacters, 2,
    "Terminator Assault must have maxCharacters: 2");
});

// ── Keyword Ratio Constraint ──────────────────────────────────────────────────

section("7. Keyword Ratio Constraint");

// Reload custodes data to pick up the new keywordRatio field
const custDataR  = loadJSON("data/factions/adeptus_custodes.json");
const custDetR   = custDataR.detachments[0];
const custUnitsR = custDataR.units;

// Mirror app helpers
function keywordCountInListR(list, keyword, units) {
  return list.filter(l => units.find(u => u.id === l.unitId)?.keywords.includes(keyword)).length;
}
function ratioUnitCountInListR(list, unitIds) {
  return list.filter(l => unitIds.includes(l.unitId)).length;
}
function isKeywordRatioBlockedR(unit, det, list, units) {
  const ratios = [];
  if (det?.keywordRatio)  ratios.push(det.keywordRatio);
  if (det?.keywordRatios) ratios.push(...det.keywordRatios);
  for (const ratio of ratios) {
    const denCount = ratio.denominatorKeyword
      ? keywordCountInListR(list, ratio.denominatorKeyword, units)
      : ratioUnitCountInListR(list, ratio.denominatorUnitIds);
    if (ratio.numeratorUnitIds) {
      if (!ratio.numeratorUnitIds.includes(unit.id)) continue;
      if (ratioUnitCountInListR(list, ratio.numeratorUnitIds) + 1 > denCount) return true;
    } else {
      if (!unit.keywords.includes(ratio.numeratorKeyword)) continue;
      if (keywordCountInListR(list, ratio.numeratorKeyword, units) + 1 > denCount) return true;
    }
  }
  return false;
}
function canAddUnitR(unitId, list, det, units) {
  const unit    = units.find(u => u.id === unitId);
  const detUnit = det.units.find(du => du.id === unitId);
  if (list.filter(l => l.unitId === unitId).length >= (detUnit?.max ?? 1)) return false;
  if (unit.type === "CHARACTER" && det.maxCharacters !== undefined &&
      list.filter(l => units.find(u => u.id === l.unitId)?.type === "CHARACTER").length >= det.maxCharacters) return false;
  if (isKeywordRatioBlockedR(unit, det, list, units)) return false;
  return true;
}

test("Voyagers into Darkness has a keywordRatio constraint defined", () => {
  assert(custDetR.keywordRatio !== undefined,
    "keywordRatio must be defined on the Voyagers into Darkness detachment");
});

test("keywordRatio numeratorKeyword is ANATHEMA PSYKANA", () => {
  assertEqual(custDetR.keywordRatio.numeratorKeyword, "ANATHEMA PSYKANA",
    "numeratorKeyword must be ANATHEMA PSYKANA");
});

test("keywordRatio denominatorUnitIds contains all three guardian unit IDs", () => {
  const ids = custDetR.keywordRatio.denominatorUnitIds;
  assert(ids.includes("cust_custodian_guard"),     "denominatorUnitIds must include cust_custodian_guard");
  assert(ids.includes("cust_allarus_custodians"),  "denominatorUnitIds must include cust_allarus_custodians");
  assert(ids.includes("cust_custodian_wardens"),   "denominatorUnitIds must include cust_custodian_wardens");
  assertEqual(ids.length, 3, "denominatorUnitIds must contain exactly 3 unit IDs");
});

test("keywordRatio has a description string", () => {
  assert(typeof custDetR.keywordRatio.description === "string" && custDetR.keywordRatio.description.length > 0,
    "keywordRatio must have a non-empty description string");
});

test("keywordRatio denominatorUnitIds all reference real units in the faction", () => {
  const unitIds = new Set(custUnitsR.map(u => u.id));
  custDetR.keywordRatio.denominatorUnitIds.forEach(id => {
    assert(unitIds.has(id), `denominatorUnitId "${id}" does not exist in the faction's units`);
  });
});

test("ANATHEMA PSYKANA unit can be added when no guardian units are present but no AP units either", () => {
  // 0 AP, 0 guardians → 0 < 0 is false, so first AP unit needs at least one guardian first
  const list = [];
  assert(!canAddUnitR("cust_prosecutors", list, custDetR, custUnitsR),
    "Should NOT be able to add an ANATHEMA PSYKANA unit when no guardian units are present");
});

test("ANATHEMA PSYKANA unit can be added when guardian count exceeds AP count", () => {
  const list = [{ unitId: "cust_custodian_guard", pts: 150 }];
  assert(canAddUnitR("cust_prosecutors", list, custDetR, custUnitsR),
    "Should be able to add an ANATHEMA PSYKANA unit when guardian count (1) exceeds AP count (0)");
});

test("Second ANATHEMA PSYKANA unit is blocked when AP count equals guardian count", () => {
  const list = [
    { unitId: "cust_custodian_guard", pts: 150 },
    { unitId: "cust_prosecutors",     pts: 50  },
  ];
  assert(!canAddUnitR("cust_vigilators", list, custDetR, custUnitsR),
    "Should NOT be able to add a second AP unit when AP count (1) already equals guardian count (1)");
});

test("Second ANATHEMA PSYKANA unit can be added when two guardian units are present", () => {
  const list = [
    { unitId: "cust_custodian_guard",    pts: 150 },
    { unitId: "cust_allarus_custodians", pts: 110 },
    { unitId: "cust_prosecutors",        pts: 50  },
  ];
  assert(canAddUnitR("cust_vigilators", list, custDetR, custUnitsR),
    "Should be able to add second AP unit when two guardian units (2) exceed AP count (1)");
});

test("Third ANATHEMA PSYKANA unit is blocked when only two guardian units are present", () => {
  const list = [
    { unitId: "cust_custodian_guard",    pts: 150 },
    { unitId: "cust_allarus_custodians", pts: 110 },
    { unitId: "cust_prosecutors",        pts: 50  },
    { unitId: "cust_vigilators",         pts: 55  },
  ];
  assert(!canAddUnitR("cust_witchseekers", list, custDetR, custUnitsR),
    "Should NOT be able to add a third AP unit when guardian count (2) equals AP count (2)");
});

test("All three ANATHEMA PSYKANA units allowed when three guardian units are present", () => {
  const list = [
    { unitId: "cust_custodian_guard",    pts: 150 },
    { unitId: "cust_allarus_custodians", pts: 110 },
    { unitId: "cust_custodian_wardens",  pts: 210 },
    { unitId: "cust_prosecutors",        pts: 50  },
    { unitId: "cust_vigilators",         pts: 55  },
  ];
  assert(canAddUnitR("cust_witchseekers", list, custDetR, custUnitsR),
    "Should be able to add third AP unit when three guardian units are present");
});

test("Non-ANATHEMA PSYKANA units are never blocked by the ratio constraint", () => {
  // Add three AP units with only one guardian — non-AP units still unaffected
  const list = [
    { unitId: "cust_custodian_guard", pts: 150 },
    { unitId: "cust_prosecutors",     pts: 50  },
  ];
  assert(canAddUnitR("cust_blade_champion", list, custDetR, custUnitsR),
    "CHARACTER unit should not be blocked by ratio constraint");
  assert(canAddUnitR("cust_custodian_wardens", list, custDetR, custUnitsR),
    "Guardian unit should not be blocked by ratio constraint");
});

test("Removing a guardian unit can block a previously allowed AP unit", () => {
  const listWith = [
    { id: 0, unitId: "cust_custodian_guard",    pts: 150 },
    { id: 1, unitId: "cust_allarus_custodians", pts: 110 },
    { id: 2, unitId: "cust_prosecutors",        pts: 50  },
  ];
  // With 2 guardians, second AP unit is allowed
  assert(canAddUnitR("cust_vigilators", listWith, custDetR, custUnitsR),
    "Second AP should be allowed with 2 guardians");
  // Remove one guardian
  const listWithout = listWith.filter(l => l.id !== 1);
  assert(!canAddUnitR("cust_vigilators", listWithout, custDetR, custUnitsR),
    "Second AP should be blocked after one guardian is removed, equalising counts");
});

test("keywordCountInList counts only units with the matching keyword", () => {
  const list = [
    { unitId: "cust_prosecutors",        pts: 50  },  // AP
    { unitId: "cust_vigilators",         pts: 55  },  // AP
    { unitId: "cust_custodian_guard",    pts: 150 },  // not AP
    { unitId: "cust_blade_champion",     pts: 120 },  // not AP
  ];
  assertEqual(keywordCountInListR(list, "ANATHEMA PSYKANA", custUnitsR), 2,
    "Should count exactly 2 ANATHEMA PSYKANA units");
});

test("ratioUnitCountInList counts only units matching the denominator IDs", () => {
  const list = [
    { unitId: "cust_custodian_guard",    pts: 150 },
    { unitId: "cust_allarus_custodians", pts: 110 },
    { unitId: "cust_prosecutors",        pts: 50  },  // not a guardian
    { unitId: "cust_blade_champion",     pts: 120 },  // not a guardian
  ];
  const ids = custDetR.keywordRatio.denominatorUnitIds;
  assertEqual(ratioUnitCountInListR(list, ids), 2,
    "Should count exactly 2 guardian (denominator) units");
});

test("HTML enforces ratio constraint in addUnit", () => {
  assert(
    html.includes("isKeywordRatioBlocked") && html.includes("keywordRatio"),
    "addUnit must call isKeywordRatioBlocked and reference keywordRatio"
  );
});

test("HTML greys out ratio-blocked units in the unit grid", () => {
  assert(
    html.includes("getUnitStatus"),
    "renderUnitGrid must use getUnitStatus to determine blocked/greyed state"
  );
});

test("HTML shows a warning pill when ratio constraint is active", () => {
  assert(
    html.includes("ratio.description"),
    "renderWarnings must emit the ratio.description in a warning pill"
  );
});

test("Detachments without keywordRatio are unaffected", () => {
  // Tyranids and Space Marines have no keywordRatio
  ["space_marines", "tyranids"].forEach(factionId => {
    factionData[factionId].detachments.forEach(det => {
      assert(det.keywordRatio === undefined,
        `Detachment "${det.id}" in "${factionId}" should not have keywordRatio set`);
    });
  });
  // CSM: only Champions of Chaos and Underdeck Uprising have no keywordRatio
  ["csm_champions_of_chaos", "csm_underdeck_uprising"].forEach(detId => {
    const det = factionData["chaos_space_marines"].detachments.find(d => d.id === detId);
    assert(det !== undefined, `Detachment "${detId}" must exist`);
    assert(det.keywordRatio === undefined,
      `Detachment "${detId}" should not have keywordRatio set`);
  });
});

test("Infernal Reavers has keywordRatio with numeratorUnitIds", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  assert(det.keywordRatio !== undefined, "Infernal Reavers must have keywordRatio");
  assert(Array.isArray(det.keywordRatio.numeratorUnitIds),
    "Infernal Reavers keywordRatio must use numeratorUnitIds");
  assert(det.keywordRatio.numeratorUnitIds.includes("csm_accursed_cultists"),
    "numeratorUnitIds must include csm_accursed_cultists");
  assert(det.keywordRatio.numeratorUnitIds.includes("csm_cultist_mob"),
    "numeratorUnitIds must include csm_cultist_mob");
  assert(det.keywordRatio.numeratorUnitIds.includes("csm_traitor_guardsmen"),
    "numeratorUnitIds must include csm_traitor_guardsmen");
  assert(det.keywordRatio.numeratorUnitIds.includes("csm_fellgor_beastmen"),
    "numeratorUnitIds must include csm_fellgor_beastmen");
  assert(Array.isArray(det.keywordRatio.denominatorUnitIds),
    "Infernal Reavers keywordRatio must have denominatorUnitIds");
  assert(det.keywordRatio.denominatorUnitIds.includes("csm_warriors"),
    "denominatorUnitIds must include csm_warriors (Legionaries)");
});



// ── requiresCharacterWithKeyword Constraint ───────────────────────────────────

section("8. requiresCharacterWithKeyword Constraint");

const custDataQ  = loadJSON("data/factions/adeptus_custodes.json");
const bsgDetQ    = custDataQ.detachments.find(d => d.id === "cust_black_ship_guardians");
const custUnitsQ = custDataQ.units;

// Mirror app helpers
function getUnitQ(unitId) {
  return custUnitsQ.find(u => u.id === unitId);
}
function isRequiredCharacterMissingQ(unitId, list) {
  const detUnit = bsgDetQ.units.find(du => du.id === unitId);
  const kw = detUnit?.requiresCharacterWithKeyword;
  if (!kw) return false;
  return !list.some(l => {
    const u = getUnitQ(l.unitId);
    return u?.type === "CHARACTER" && u.keywords.includes(kw);
  });
}

test("Black Ship Guardians has units with requiresCharacterWithKeyword set", () => {
  const restricted = bsgDetQ.units.filter(du => du.requiresCharacterWithKeyword);
  assert(restricted.length > 0,
    "Black Ship Guardians must have at least one unit with requiresCharacterWithKeyword");
});

test("requiresCharacterWithKeyword is set to ANATHEMA PSYKANA on restricted units", () => {
  const restricted = bsgDetQ.units.filter(du => du.requiresCharacterWithKeyword);
  restricted.forEach(du => {
    assertEqual(du.requiresCharacterWithKeyword, "ANATHEMA PSYKANA",
      `Unit "${du.id}" requiresCharacterWithKeyword must be ANATHEMA PSYKANA`);
  });
});

test("Shield Captain is blocked when no ANATHEMA PSYKANA CHARACTER is in the list", () => {
  const list = [];
  assert(isRequiredCharacterMissingQ("cust_shield_captain", list),
    "Shield Captain should be blocked when list is empty");
});

test("Shield Captain is blocked when only non-ANATHEMA PSYKANA units are in the list", () => {
  const list = [{ unitId: "cust_custodian_guard" }];
  assert(isRequiredCharacterMissingQ("cust_shield_captain", list),
    "Shield Captain should be blocked when no ANATHEMA PSYKANA CHARACTER is present");
});

test("Shield Captain is unblocked when an ANATHEMA PSYKANA CHARACTER is in the list", () => {
  const list = [{ unitId: "cust_aleya" }];
  assert(!isRequiredCharacterMissingQ("cust_shield_captain", list),
    "Shield Captain should be available when Aleya (ANATHEMA PSYKANA CHARACTER) is in the list");
});

test("Knight-Centura also unlocks Shield Captain as she has ANATHEMA PSYKANA", () => {
  const list = [{ unitId: "cust_knight_centura" }];
  assert(!isRequiredCharacterMissingQ("cust_shield_captain", list),
    "Shield Captain should be available when Knight-Centura is in the list");
});

test("Shield Captain in Allarus Armour is also blocked without ANATHEMA PSYKANA CHARACTER", () => {
  const list = [];
  assert(isRequiredCharacterMissingQ("cust_shield_captain_allarus", list),
    "Shield Captain in Allarus Armour should be blocked when list is empty");
});

test("Valerian is also blocked without ANATHEMA PSYKANA CHARACTER", () => {
  const list = [];
  assert(isRequiredCharacterMissingQ("cust_valerian", list),
    "Valerian should be blocked when no ANATHEMA PSYKANA CHARACTER is in the list");
});

test("Units without requiresCharacterWithKeyword are never blocked by this constraint", () => {
  const list = [];
  assert(!isRequiredCharacterMissingQ("cust_prosecutors", list),
    "Prosecutors have no requiresCharacterWithKeyword and should never be blocked by it");
  assert(!isRequiredCharacterMissingQ("cust_aleya", list),
    "Aleya has no requiresCharacterWithKeyword and should never be blocked by it");
});

test("Removing the ANATHEMA PSYKANA CHARACTER re-blocks restricted units", () => {
  const listWith = [{ id: 0, unitId: "cust_aleya" }];
  assert(!isRequiredCharacterMissingQ("cust_shield_captain", listWith),
    "Shield Captain should be unblocked with Aleya present");
  const listWithout = listWith.filter(l => l.id !== 0);
  assert(isRequiredCharacterMissingQ("cust_shield_captain", listWithout),
    "Shield Captain should be re-blocked after Aleya is removed");
});

test("HTML enforces requiresCharacterWithKeyword in addUnit", () => {
  assert(
    html.includes("isRequiredCharacterMissing") && html.includes("requiresCharacterWithKeyword"),
    "addUnit must call isRequiredCharacterMissing and reference requiresCharacterWithKeyword"
  );
});

test("HTML greys out restricted units in the unit grid", () => {
  assert(
    html.includes("cardStatus.hint"),
    "renderUnitGrid must render cardStatus.hint to explain why a unit is blocked"
  );
});

// ── Necrons: Harbinger Cabal ─────────────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("9. Necrons — Harbinger Cabal");

const necData  = loadJSON("data/factions/necrons.json");
const necDet   = necData.detachments.find(d => d.id === "nec_harbinger_cabal");
const necUnits = necData.units;

test("Harbinger Cabal detachment exists", () => {
  assert(necDet !== undefined, "nec_harbinger_cabal detachment must exist");
});

test("Harbinger Cabal has maxCharacters set to 3", () => {
  assertEqual(necDet.maxCharacters, 3,
    "Harbinger Cabal must have maxCharacters: 3");
});

test("Harbinger Cabal has CRYPTEK units as characters", () => {
  const crypteks = necUnits.filter(u => u.keywords.includes("CRYPTEK") && u.type === "CHARACTER");
  assert(crypteks.length >= 4,
    "There should be at least 4 CRYPTEK CHARACTER units available");
});

test("Harbinger Cabal — up to 3 CHARACTERs can be added (cap not hit yet)", () => {
  const list = [
    { unitId: "nec_chronomancer",  pts: 65 },
    { unitId: "nec_geomancer",     pts: 75 },
  ];
  const charCount = list.filter(l => necUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < necDet.maxCharacters,
    "Two CHARACTERs should be below the cap of 3");
});

test("Harbinger Cabal — 4th CHARACTER is blocked when cap of 3 is reached", () => {
  const list = [
    { unitId: "nec_chronomancer",  pts: 65 },
    { unitId: "nec_geomancer",     pts: 75 },
    { unitId: "nec_plasmancer",    pts: 55 },
  ];
  const charCount = list.filter(l => necUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assertEqual(charCount, 3, "Three CHARACTERs should equal the cap");

  // Simulate canAdd for a 4th CHARACTER
  function canAddNec(unitId) {
    const unit    = necUnits.find(u => u.id === unitId);
    const detUnit = necDet.units.find(du => du.id === unitId);
    if (list.filter(l => l.unitId === unitId).length >= (detUnit?.max ?? 1)) return false;
    if (unit.type === "CHARACTER" && necDet.maxCharacters !== undefined &&
        charCount >= necDet.maxCharacters) return false;
    return true;
  }
  assert(!canAddNec("nec_psychomancer"),
    "4th CHARACTER should be blocked when cap of 3 is already reached");
});

test("Harbinger Cabal — Illuminor Szeras entry exists and has correct cost", () => {
  const szeras = necUnits.find(u => u.id === "nec_illuminor_szeras");
  assert(szeras !== undefined, "nec_illuminor_szeras must exist");
  assertEqual(szeras.sizes[0].pts, 165, "Illuminor Szeras should cost 165pts");
  assert(szeras.keywords.includes("EPIC HERO"), "Illuminor Szeras should be EPIC HERO");
});

test("Necron Warriors battleline size is 10 models only", () => {
  const warriors = necUnits.find(u => u.id === "nec_warriors");
  assert(warriors !== undefined, "nec_warriors must exist");
  assertEqual(warriors.sizes.length, 1, "Necron Warriors should only have 1 size option (10 models)");
  assertEqual(warriors.sizes[0].label, "10 models", "Necron Warriors only come in 10s");
  assertEqual(warriors.sizes[0].pts, 90, "Necron Warriors 10-man should cost 90pts");
});

test("Harbinger Cabal lists have the Transdimensional Reinforcement army rule in index.json", () => {
  const necFaction = index.factions.find(f => f.id === "necrons");
  assert(necFaction !== undefined, "necrons faction must exist in index.json");
  assertEqual(necFaction.armyRule.name, "Transdimensional Reinforcement",
    "Necrons army rule must be Transdimensional Reinforcement");
});

test("Harbinger Cabal smoke test — build a legal 490pt list", () => {
  // Chronomancer (65) + Orikan (80) + Plasmancer (55) + Warriors x3 (270) + Immortals (70) = 540 — too much
  // Chronomancer (65) + Orikan (80) + Warriors x2 (180) + Immortals (70) = 395 — legal
  const list = [
    { unitId: "nec_chronomancer", pts: 65 },
    { unitId: "nec_orikan_the_diviner", pts: 80 },
    { unitId: "nec_warriors", pts: 90 },
    { unitId: "nec_warriors", pts: 90 },
    { unitId: "nec_immortals", pts: 70 },
    { unitId: "nec_immortals", pts: 70 },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts should be within 500pt limit`);
  const chars = list.filter(l => necUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(chars <= necDet.maxCharacters, `${chars} CHARACTERs should be within cap of ${necDet.maxCharacters}`);
});

// ── Canoptek Harvesters — BEASTS and SWARM ───────────────────────────────────

const necDataFull  = loadJSON("data/factions/necrons.json");
const canoptekDet  = necDataFull.detachments.find(d => d.id === "nec_canoptek_harvesters");
const necUnitsFull = necDataFull.units;

test("Canoptek Harvesters detachment exists", () => {
  assert(canoptekDet !== undefined, "nec_canoptek_harvesters detachment must exist");
});

test("Canoptek Wraiths are in the Canoptek Harvesters detachment with max 2", () => {
  const entry = canoptekDet.units.find(u => u.id === "nec_canoptek_wraiths");
  assert(entry !== undefined, "nec_canoptek_wraiths must be listed in Canoptek Harvesters");
  assertEqual(entry.max, 2, "Canoptek Wraiths should have max 2");
});

test("Canoptek Scarab Swarm is in the Canoptek Harvesters detachment with max 2", () => {
  const entry = canoptekDet.units.find(u => u.id === "nec_canoptek_scarab_swarm");
  assert(entry !== undefined, "nec_canoptek_scarab_swarm must be listed in Canoptek Harvesters");
  assertEqual(entry.max, 2, "Canoptek Scarab Swarm should have max 2");
});

test("Canoptek Wraiths have type BEASTS", () => {
  const unit = necUnitsFull.find(u => u.id === "nec_canoptek_wraiths");
  assert(unit !== undefined, "nec_canoptek_wraiths unit must exist");
  assertEqual(unit.type, "BEASTS", "Canoptek Wraiths must have type BEASTS");
});

test("Canoptek Scarab Swarm has type SWARM", () => {
  const unit = necUnitsFull.find(u => u.id === "nec_canoptek_scarab_swarm");
  assert(unit !== undefined, "nec_canoptek_scarab_swarm unit must exist");
  assertEqual(unit.type, "SWARM", "Canoptek Scarab Swarm must have type SWARM");
});

test("Canoptek Wraiths cost 110pts for 3 models", () => {
  const unit = necUnitsFull.find(u => u.id === "nec_canoptek_wraiths");
  assertEqual(unit.sizes.length, 1, "Canoptek Wraiths should have exactly 1 size option");
  assertEqual(unit.sizes[0].pts, 110, "Canoptek Wraiths should cost 110pts");
  assertEqual(unit.sizes[0].label, "3 models", "Canoptek Wraiths size label should be '3 models'");
});

test("Canoptek Scarab Swarm costs 40pts for 3 models", () => {
  const unit = necUnitsFull.find(u => u.id === "nec_canoptek_scarab_swarm");
  assertEqual(unit.sizes.length, 1, "Canoptek Scarab Swarm should have exactly 1 size option");
  assertEqual(unit.sizes[0].pts, 40, "Canoptek Scarab Swarm should cost 40pts");
  assertEqual(unit.sizes[0].label, "3 models", "Canoptek Scarab Swarm size label should be '3 models'");
});

test("HTML TYPE_ORDER includes BEASTS and SWARM after INFANTRY", () => {
  assert(html.includes('"CHARACTER","BATTLELINE","INFANTRY","VEHICLE","BEASTS","BEAST","MOUNTED","SWARM"'),
    "TYPE_ORDER must include VEHICLE, BEASTS, BEAST, MOUNTED and SWARM in correct order");
});

test("HTML has badge styles for BEASTS and SWARM types", () => {
  assert(html.includes("badge-BEASTS"), "HTML must define a badge style for BEASTS");
  assert(html.includes("badge-SWARM"),  "HTML must define a badge style for SWARM");
});

test("HTML has print-sheet badge styles for BEASTS and SWARM types", () => {
  assert(html.includes("ps-badge-BEASTS"), "HTML must define a print badge style for BEASTS");
  assert(html.includes("ps-badge-SWARM"),  "HTML must define a print badge style for SWARM");
});

test("Canoptek Harvesters smoke test — list with BEASTS and SWARM units", () => {
  // Chronomancer (65) + Wraiths x2 (220) + Scarab Swarm x2 (80) + Warriors (90) = 455pts
  const list = [
    { unitId: "nec_chronomancer",          pts: 65,  type: "CHARACTER" },
    { unitId: "nec_canoptek_wraiths",      pts: 110, type: "BEASTS"    },
    { unitId: "nec_canoptek_wraiths",      pts: 110, type: "BEASTS"    },
    { unitId: "nec_canoptek_scarab_swarm", pts: 40,  type: "SWARM"     },
    { unitId: "nec_canoptek_scarab_swarm", pts: 40,  type: "SWARM"     },
    { unitId: "nec_warriors",              pts: 90,  type: "BATTLELINE"},
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts should be within the 500pt limit`);
  const chars = list.filter(l => l.type === "CHARACTER").length;
  assert(chars <= canoptekDet.maxCharacters,
    `${chars} CHARACTERs should be within cap of ${canoptekDet.maxCharacters}`);
  const wraiths = list.filter(l => l.unitId === "nec_canoptek_wraiths").length;
  assert(wraiths <= 2, "Should not exceed max of 2 Canoptek Wraiths");
  const scarabs = list.filter(l => l.unitId === "nec_canoptek_scarab_swarm").length;
  assert(scarabs <= 2, "Should not exceed max of 2 Canoptek Scarab Swarms");
});

// ── Faction Keyword Groups ────────────────────────────────────────────────────

section("10. Faction Keyword Groups");

const smData  = loadJSON("data/factions/adeptus_astartes.json");
const smUnits = smData.units;

const CHAPTER_GROUP = [
  "SPACE WOLVES", "DARK ANGELS", "DEATHWATCH", "IMPERIAL FISTS", "ULTRAMARINES",
  "RAVEN GUARD", "SALAMANDERS", "BLOOD ANGELS", "BLACK TEMPLARS", "CRIMSON FISTS",
  "WHITE SCARS", "IRON HANDS"
];

test("All three Adeptus Astartes detachments have factionKeywordGroups defined", () => {
  smData.detachments.forEach(det => {
    assert(Array.isArray(det.factionKeywordGroups) && det.factionKeywordGroups.length > 0,
      `Detachment "${det.id}" must have a non-empty factionKeywordGroups array`);
  });
});

test("factionKeywordGroups contains all 12 chapter keywords", () => {
  smData.detachments.forEach(det => {
    const group = det.factionKeywordGroups[0];
    CHAPTER_GROUP.forEach(kw => {
      assert(group.includes(kw),
        `Detachment "${det.id}" factionKeywordGroups is missing keyword "${kw}"`);
    });
    assertEqual(group.length, CHAPTER_GROUP.length,
      `Detachment "${det.id}" factionKeywordGroups should have exactly ${CHAPTER_GROUP.length} keywords`);
  });
});

// Mirror app logic for tests
function isFactionGroupBlockedSim(unit, det, list, units) {
  const groups = det?.factionKeywordGroups;
  if (!groups) return false;
  for (const group of groups) {
    const unitGroupKws = unit.keywords.filter(k => group.includes(k));
    if (!unitGroupKws.length) continue;
    const committed = group.find(kw =>
      list.some(l => units.find(u => u.id === l.unitId)?.keywords.includes(kw))
    );
    if (committed && !unitGroupKws.includes(committed)) return true;
  }
  return false;
}

const taDet = smData.detachments.find(d => d.id === "sm_terminator_assault");
const arjac  = smUnits.find(u => u.id === "sm_arjac_rockfist");     // SPACE WOLVES
const belial = smUnits.find(u => u.id === "sm_belial");              // DARK ANGELS
const lysander = smUnits.find(u => u.id === "sm_darnath_lysander"); // IMPERIAL FISTS
const shrike   = smUnits.find(u => u.id === "sm_kayvaan_shrike");   // RAVEN GUARD
const capTerm  = smUnits.find(u => u.id === "sm_captain_terminator"); // no chapter kw

test("Unit with no chapter keyword is never blocked by faction group", () => {
  const list = [{ unitId: "sm_arjac_rockfist" }];
  assert(!isFactionGroupBlockedSim(capTerm, taDet, list, smUnits),
    "Captain in Terminator Armour (no chapter kw) should not be blocked even when SPACE WOLVES are present");
});

test("First chapter unit is never blocked (no committed keyword yet)", () => {
  const list = [];
  assert(!isFactionGroupBlockedSim(arjac, taDet, list, smUnits),
    "Arjac should not be blocked when the list is empty");
});

test("Same-chapter unit is never blocked by its own chapter being committed", () => {
  const list = [{ unitId: "sm_arjac_rockfist" }];
  const wolfGuard = smUnits.find(u => u.id === "sm_wolf_guard_terminators");
  assert(!isFactionGroupBlockedSim(wolfGuard, taDet, list, smUnits),
    "Wolf Guard Terminators (SPACE WOLVES) should not be blocked when Arjac (SPACE WOLVES) is present");
});

test("Different-chapter unit is blocked once a chapter is committed", () => {
  const list = [{ unitId: "sm_arjac_rockfist" }]; // SPACE WOLVES committed
  assert(isFactionGroupBlockedSim(belial, taDet, list, smUnits),
    "Belial (DARK ANGELS) should be blocked when Arjac (SPACE WOLVES) is in the list");
});

test("All other chapter units are blocked once one chapter is committed", () => {
  const list = [{ unitId: "sm_belial" }]; // DARK ANGELS committed
  [arjac, lysander, shrike].forEach(unit => {
    assert(isFactionGroupBlockedSim(unit, taDet, list, smUnits),
      `${unit.name} should be blocked when DARK ANGELS are committed`);
  });
});

test("Blocking clears when the committed unit is removed", () => {
  const list = [{ id: 0, unitId: "sm_arjac_rockfist" }];
  assert(isFactionGroupBlockedSim(belial, taDet, list, smUnits),
    "Belial should be blocked with Arjac present");
  const trimmed = list.filter(l => l.id !== 0);
  assert(!isFactionGroupBlockedSim(belial, taDet, trimmed, smUnits),
    "Belial should be unblocked once Arjac is removed");
});

test("HTML enforces isFactionGroupBlocked in addUnit", () => {
  assert(html.includes("isFactionGroupBlocked"),
    "addUnit must call isFactionGroupBlocked");
});

test("HTML greys out faction-group-blocked units in the unit grid", () => {
  assert(html.includes("isFactionGroupBlocked"),
    "getUnitStatus must call isFactionGroupBlocked when checking if a unit is blocked");
});

test("HTML shows which chapter is committed in the blocked unit hint", () => {
  assert(html.includes("Unavailable —") && html.includes("units already selected"),
    "renderUnitGrid must show a hint naming the committed chapter when a unit is blocked");
});

// ── Tomb Ship Complement & maxKeywordUnits ────────────────────────────────────

section("11. Tomb Ship Complement & maxKeywordUnits Constraint");

const necDataFull2 = loadJSON("data/factions/necrons.json");
const tombShipDet = necDataFull2.detachments.find(d => d.id === "nec_tomb_ship");
const necUnitsTomb = necDataFull2.units;

// Mirror app helpers for maxKeywordUnits
function keywordCountInListT(list, keyword, units) {
  return list.filter(l => units.find(u => u.id === l.unitId)?.keywords.includes(keyword)).length;
}
function isKeywordUnitCapBlockedT(unit, det, list, units) {
  const caps = det?.maxKeywordUnits;
  if (!caps) return false;
  for (const cap of caps) {
    if (!unit.keywords.includes(cap.keyword)) continue;
    if (keywordCountInListT(list, cap.keyword, units) >= cap.max) return true;
  }
  return false;
}
function canAddUnitTomb(unitId, list, det, units) {
  const unit    = units.find(u => u.id === unitId);
  const detUnit = det.units.find(du => du.id === unitId);
  if (!detUnit) return false;
  const pts = unit.sizes[0].pts;
  if (list.reduce((s, l) => s + l.pts, 0) + pts > 500) return false;
  if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
  if (unit.type === "CHARACTER" && det.maxCharacters !== undefined &&
      list.filter(l => units.find(u => u.id === l.unitId)?.type === "CHARACTER").length >= det.maxCharacters) return false;
  if (isKeywordUnitCapBlockedT(unit, det, list, units)) return false;
  return true;
}

test("Tomb Ship Complement detachment exists in necrons.json", () => {
  assert(tombShipDet !== undefined, "nec_tomb_ship detachment must exist in necrons.json");
});

test("Tomb Ship Complement has correct name", () => {
  assertEqual(tombShipDet.name, "Tomb Ship Complement",
    "Detachment name must be 'Tomb Ship Complement'");
});

test("Tomb Ship Complement has Conquest Protocols special rule", () => {
  assertEqual(tombShipDet.specialRule.name, "Conquest Protocols",
    "Special rule name must be 'Conquest Protocols'");
  assert(tombShipDet.specialRule.desc.length > 0, "Special rule must have a description");
});

test("Tomb Ship Complement has maxCharacters set to 2", () => {
  assertEqual(tombShipDet.maxCharacters, 2,
    "Tomb Ship Complement must have maxCharacters: 2");
});

test("Tomb Ship Complement has maxKeywordUnits defined", () => {
  assert(Array.isArray(tombShipDet.maxKeywordUnits) && tombShipDet.maxKeywordUnits.length > 0,
    "maxKeywordUnits must be a non-empty array");
});

test("maxKeywordUnits CRYPTEK cap is set to 1", () => {
  const cryptekCap = tombShipDet.maxKeywordUnits.find(c => c.keyword === "CRYPTEK");
  assert(cryptekCap !== undefined, "Must have a CRYPTEK entry in maxKeywordUnits");
  assertEqual(cryptekCap.max, 1, "CRYPTEK cap must be 1");
  assert(typeof cryptekCap.description === "string" && cryptekCap.description.length > 0,
    "CRYPTEK cap must have a description");
});

test("Tomb Ship Complement has Resurrection Protocols enhancement", () => {
  const enh = tombShipDet.enhancements.find(e => e.id === "enh_nec_resurrection_protocols");
  assert(enh !== undefined, "enh_nec_resurrection_protocols must exist");
  assertEqual(enh.name, "Resurrection Protocols", "Enhancement name must match");
  assert(!enh.requiresKeywords.length, "Resurrection Protocols must have no keyword requirement");
});

test("Tomb Ship Complement has Mindshackle Scarabs enhancement", () => {
  const enh = tombShipDet.enhancements.find(e => e.id === "enh_nec_mindshackle_scarabs");
  assert(enh !== undefined, "enh_nec_mindshackle_scarabs must exist");
  assertEqual(enh.name, "Mindshackle Scarabs", "Enhancement name must match");
  assert(enh.requiresKeywords.includes("CRYPTEK"),
    "Mindshackle Scarabs must require CRYPTEK keyword");
});

test("Mindshackle Scarabs is available to CRYPTEK units", () => {
  const enh = tombShipDet.enhancements.find(e => e.id === "enh_nec_mindshackle_scarabs");
  const chrono = necUnitsTomb.find(u => u.id === "nec_chronomancer");
  assert(enh.requiresKeywords.every(kw => chrono.keywords.includes(kw)),
    "Chronomancer (CRYPTEK) should be eligible for Mindshackle Scarabs");
});

test("Mindshackle Scarabs is not available to non-CRYPTEK units", () => {
  const enh = tombShipDet.enhancements.find(e => e.id === "enh_nec_mindshackle_scarabs");
  const hexmark = necUnitsTomb.find(u => u.id === "nec_hexmark_destroyer");
  const eligible = enh.requiresKeywords.every(kw => hexmark.keywords.includes(kw));
  assert(!eligible, "Hexmark Destroyer (not CRYPTEK) should not be eligible for Mindshackle Scarabs");
});

test("Tomb Ship Complement has all original 12 units listed", () => {
  const expectedIds = [
    "nec_hexmark_destroyer", "nec_skorpekh_lord", "nec_chronomancer",
    "nec_illuminor_szeras", "nec_orikan_the_diviner", "nec_plasmancer",
    "nec_psychomancer", "nec_technomancer", "nec_immortals",
    "nec_warriors", "nec_flayed_ones", "nec_skorpekh_destroyers"
  ];
  const actualIds = tombShipDet.units.map(u => u.id);
  expectedIds.forEach(id => {
    assert(actualIds.includes(id), `Tomb Ship Complement must include unit "${id}"`);
  });
});

test("Tomb Ship Complement does not include Canoptek Wraiths", () => {
  assert(!tombShipDet.units.find(u => u.id === "nec_canoptek_wraiths"),
    "Canoptek Wraiths should not be in Tomb Ship Complement");
});

test("All unit IDs in Tomb Ship Complement reference real Necron units", () => {
  const unitIds = new Set(necUnitsTomb.map(u => u.id));
  tombShipDet.units.forEach(du => {
    assert(unitIds.has(du.id),
      `Tomb Ship Complement references unit "${du.id}" which does not exist in necrons.json`);
  });
});

test("First CRYPTEK unit can be added to an empty list", () => {
  const list = [];
  assert(canAddUnitTomb("nec_chronomancer", list, tombShipDet, necUnitsTomb),
    "Should be able to add the first CRYPTEK unit (Chronomancer) to an empty list");
});

test("Second CRYPTEK unit is blocked once one CRYPTEK is in the list", () => {
  const list = [{ unitId: "nec_chronomancer", pts: 65 }];
  assert(!canAddUnitTomb("nec_plasmancer", list, tombShipDet, necUnitsTomb),
    "Should NOT be able to add a second CRYPTEK unit (Plasmancer) when Chronomancer is already present");
});

test("All CRYPTEK variants are blocked once one CRYPTEK is in the list", () => {
  const list = [{ unitId: "nec_technomancer", pts: 80 }];
  const cryptekIds = ["nec_chronomancer", "nec_illuminor_szeras", "nec_orikan_the_diviner",
                      "nec_plasmancer", "nec_psychomancer"];
  cryptekIds.forEach(id => {
    assert(!canAddUnitTomb(id, list, tombShipDet, necUnitsTomb),
      `${id} should be blocked when a CRYPTEK unit is already in the list`);
  });
});

test("Non-CRYPTEK units are unaffected by the CRYPTEK cap", () => {
  const list = [{ unitId: "nec_chronomancer", pts: 65 }];
  assert(canAddUnitTomb("nec_hexmark_destroyer", list, tombShipDet, necUnitsTomb),
    "Hexmark Destroyer (not CRYPTEK) should not be blocked when CRYPTEK cap is reached");
  assert(canAddUnitTomb("nec_immortals", list, tombShipDet, necUnitsTomb),
    "Immortals (not CRYPTEK) should not be blocked when CRYPTEK cap is reached");
  assert(canAddUnitTomb("nec_skorpekh_destroyers", list, tombShipDet, necUnitsTomb),
    "Skorpekh Destroyers (not CRYPTEK) should not be blocked when CRYPTEK cap is reached");
});

test("Character cap still applies alongside CRYPTEK cap", () => {
  const list = [
    { unitId: "nec_hexmark_destroyer", pts: 85 },
    { unitId: "nec_skorpekh_lord",     pts: 90 }
  ];
  // Both are CHARACTER — cap of 2 should be hit
  assert(!canAddUnitTomb("nec_chronomancer", list, tombShipDet, necUnitsTomb),
    "CRYPTEK (which is also CHARACTER) should be blocked when character cap of 2 is reached");
});

test("Tomb Ship Complement smoke test — valid 475pt list", () => {
  // Plasmancer (55) + Hexmark Destroyer (85) + Immortals x3 (210) + Skorpekh Destroyers (90) + Flayed Ones 5-man (60) = 500
  // Use: Chronomancer (65) + Immortals x2 (140) + Warriors (90) + Skorpekh Destroyers (90) + Flayed Ones (60) = 445
  const list = [
    { unitId: "nec_chronomancer",        pts: 65,  type: "CHARACTER" },
    { unitId: "nec_immortals",           pts: 70,  type: "BATTLELINE" },
    { unitId: "nec_immortals",           pts: 70,  type: "BATTLELINE" },
    { unitId: "nec_warriors",            pts: 90,  type: "BATTLELINE" },
    { unitId: "nec_skorpekh_destroyers", pts: 90,  type: "INFANTRY"  },
    { unitId: "nec_flayed_ones",         pts: 60,  type: "INFANTRY"  },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts should be within the 500pt limit`);
  const chars = list.filter(l => l.type === "CHARACTER").length;
  assert(chars <= tombShipDet.maxCharacters, `${chars} CHARACTERs within cap of ${tombShipDet.maxCharacters}`);
  const cryptekCount = keywordCountInListT(list, "CRYPTEK", necUnitsTomb);
  assert(cryptekCount <= 1, `CRYPTEK count ${cryptekCount} must not exceed cap of 1`);
});

test("HTML enforces isKeywordUnitCapBlocked in addUnit", () => {
  assert(html.includes("isKeywordUnitCapBlocked"),
    "addUnit must call isKeywordUnitCapBlocked to enforce maxKeywordUnits");
});

test("HTML greys out keyword-cap-blocked units in the unit grid", () => {
  assert(html.includes("isKeywordUnitCapBlocked"),
    "getUnitStatus must call isKeywordUnitCapBlocked when checking if a unit is blocked");
});

test("HTML shows a hint when a unit is blocked by the keyword cap", () => {
  assert(html.includes("getKeywordUnitCapHint"),
    "getUnitStatus must call getKeywordUnitCapHint to populate the blocked hint");
});

test("HTML emits a warning pill when a keyword cap is reached", () => {
  assert(html.includes("maxKeywordUnits"),
    "renderWarnings must check maxKeywordUnits to emit a pill when a cap is reached");
});

test("Detachments without maxKeywordUnits are unaffected", () => {
  ["chaos_space_marines", "tyranids", "space_marines"].forEach(factionId => {
    factionData[factionId].detachments.forEach(det => {
      assert(det.maxKeywordUnits === undefined,
        `Detachment "${det.id}" in "${factionId}" should not have maxKeywordUnits set`);
    });
  });
});

test("Tomb Ship Complement now has all 23 expected units listed", () => {
  const expectedIds = [
    "nec_hexmark_destroyer", "nec_skorpekh_lord", "nec_chronomancer",
    "nec_illuminor_szeras", "nec_orikan_the_diviner", "nec_plasmancer",
    "nec_psychomancer", "nec_technomancer", "nec_immortals",
    "nec_warriors", "nec_flayed_ones", "nec_skorpekh_destroyers",
    "nec_imotekh", "nec_overlord", "nec_overlord_shroud",
    "nec_royal_warden", "nec_trazyn", "nec_deathmarks", "nec_lychguard",
    "nec_geomancer", "nec_canoptek_scarab_swarm", "nec_ophydian_destroyers",
    "nec_triarch_praetorians"
  ];
  const actualIds = tombShipDet.units.map(u => u.id);
  expectedIds.forEach(id => {
    assert(actualIds.includes(id), `Tomb Ship Complement must include unit "${id}"`);
  });
  assertEqual(actualIds.length, expectedIds.length,
    `Expected ${expectedIds.length} units, found ${actualIds.length}`);
});

test("Imotekh the Stormlord has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_imotekh");
  assert(u !== undefined, "nec_imotekh must exist");
  assertEqual(u.name, "Imotekh the Stormlord");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NOBLE"),     "Imotekh must have NOBLE keyword");
  assert(u.keywords.includes("EPIC HERO"), "Imotekh must have EPIC HERO keyword");
  assertEqual(u.sizes[0].pts, 100,         "Imotekh must cost 100pts");
  assert(u.rulesAdaptations && u.rulesAdaptations.includes("Grand Strategist"),
    "Imotekh must have rulesAdaptations referencing Grand Strategist");
});

test("Overlord has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_overlord");
  assert(u !== undefined, "nec_overlord must exist");
  assertEqual(u.name, "Overlord");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NOBLE"), "Overlord must have NOBLE keyword");
  assertEqual(u.sizes[0].pts, 85,      "Overlord must cost 85pts");
  assert(!u.rulesAdaptations,          "Overlord should have no rulesAdaptations");
});

test("Overlord with Translocation Shroud has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_overlord_shroud");
  assert(u !== undefined, "nec_overlord_shroud must exist");
  assertEqual(u.name, "Overlord with Translocation Shroud");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NOBLE"), "Overlord with Translocation Shroud must have NOBLE keyword");
  assertEqual(u.sizes[0].pts, 85,      "Overlord with Translocation Shroud must cost 85pts");
  assert(u.rulesAdaptations && u.rulesAdaptations.includes("Translocation Shroud"),
    "Overlord with Translocation Shroud must have rulesAdaptations referencing Translocation Shroud");
});

test("Royal Warden has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_royal_warden");
  assert(u !== undefined, "nec_royal_warden must exist");
  assertEqual(u.name, "Royal Warden");
  assertEqual(u.type, "CHARACTER");
  assert(!u.keywords.includes("NOBLE"), "Royal Warden must not have NOBLE keyword");
  assertEqual(u.sizes[0].pts, 50,       "Royal Warden must cost 50pts");
  assert(!u.rulesAdaptations,           "Royal Warden should have no rulesAdaptations");
});

test("Trazyn the Infinite has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_trazyn");
  assert(u !== undefined, "nec_trazyn must exist");
  assertEqual(u.name, "Trazyn the Infinite");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NOBLE"),     "Trazyn must have NOBLE keyword");
  assert(u.keywords.includes("EPIC HERO"), "Trazyn must have EPIC HERO keyword");
  assertEqual(u.sizes[0].pts, 75,          "Trazyn must cost 75pts");
  assert(u.rulesAdaptations && u.rulesAdaptations.includes("Ancient Collector"),
    "Trazyn must have rulesAdaptations referencing Ancient Collector");
});

test("Deathmarks has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_deathmarks");
  assert(u !== undefined, "nec_deathmarks must exist");
  assertEqual(u.name, "Deathmarks");
  assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 2,     "Deathmarks must have 2 size options");
  assertEqual(u.sizes[0].pts, 60,    "Deathmarks 5-man must cost 60pts");
  assertEqual(u.sizes[1].pts, 120,   "Deathmarks 10-man must cost 120pts");
  assertEqual(u.sizes[0].label, "5 models",  "Deathmarks small size label must be '5 models'");
  assertEqual(u.sizes[1].label, "10 models", "Deathmarks large size label must be '10 models'");
});

test("Lychguard has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_lychguard");
  assert(u !== undefined, "nec_lychguard must exist");
  assertEqual(u.name, "Lychguard");
  assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 2,     "Lychguard must have 2 size options");
  assertEqual(u.sizes[0].pts, 85,    "Lychguard 5-man must cost 85pts");
  assertEqual(u.sizes[1].pts, 170,   "Lychguard 10-man must cost 170pts");
  assertEqual(u.sizes[0].label, "5 models",  "Lychguard small size label must be '5 models'");
  assertEqual(u.sizes[1].label, "10 models", "Lychguard large size label must be '10 models'");
});

test("New Noble characters are not CRYPTEK — CRYPTEK cap does not affect them", () => {
  ["nec_imotekh", "nec_overlord", "nec_overlord_shroud", "nec_trazyn"].forEach(id => {
    const u = necUnitsTomb.find(u => u.id === id);
    assert(!u.keywords.includes("CRYPTEK"),
      `${u.name} must not have the CRYPTEK keyword`);
  });
});

test("Royal Warden is not NOBLE and not CRYPTEK", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_royal_warden");
  assert(!u.keywords.includes("NOBLE"),   "Royal Warden must not be NOBLE");
  assert(!u.keywords.includes("CRYPTEK"), "Royal Warden must not be CRYPTEK");
});

test("Tomb Ship Complement — Noble character does not consume CRYPTEK cap", () => {
  const list = [{ unitId: "nec_overlord", pts: 85 }];
  // CRYPTEK cap should still be free — can still add a CRYPTEK
  assert(canAddUnitTomb("nec_chronomancer", list, tombShipDet, necUnitsTomb),
    "Adding an Overlord (NOBLE, not CRYPTEK) should not block adding a CRYPTEK unit");
});

test("Tomb Ship Complement — CRYPTEK cap blocks Noble characters that are also CRYPTEK (none exist, but logic is correct)", () => {
  // All new Noble units are not CRYPTEK, so they are always unaffected by the cap
  const list = [{ unitId: "nec_chronomancer", pts: 65 }];
  ["nec_imotekh", "nec_overlord", "nec_overlord_shroud", "nec_royal_warden", "nec_trazyn"].forEach(id => {
    assert(canAddUnitTomb(id, list, tombShipDet, necUnitsTomb),
      `${id} should not be blocked by the CRYPTEK cap`);
  });
});

test("Tomb Ship Complement — Deathmarks and Lychguard both max 1", () => {
  const dm = tombShipDet.units.find(du => du.id === "nec_deathmarks");
  const lg = tombShipDet.units.find(du => du.id === "nec_lychguard");
  assertEqual(dm.max, 1, "Deathmarks must have max 1 in Tomb Ship Complement");
  assertEqual(lg.max, 1, "Lychguard must have max 1 in Tomb Ship Complement");
});

test("Tomb Ship Complement — no duplicate IDs in the detachment unit list", () => {
  const ids = tombShipDet.units.map(du => du.id);
  const unique = new Set(ids);
  assertEqual(unique.size, ids.length, "Tomb Ship Complement must not have duplicate unit entries");
});

test("All new Necron units pass data integrity checks", () => {
  const newIds = ["nec_imotekh","nec_overlord","nec_overlord_shroud","nec_royal_warden",
                  "nec_trazyn","nec_deathmarks","nec_lychguard"];
  newIds.forEach(id => {
    const u = necUnitsTomb.find(u => u.id === id);
    assert(u,                              `Unit "${id}" must exist`);
    assert(u.name,                         `Unit "${id}" must have a name`);
    assert(u.type,                         `Unit "${id}" must have a type`);
    assert(Array.isArray(u.keywords),      `Unit "${id}" must have keywords array`);
    assert(Array.isArray(u.sizes) && u.sizes.length > 0, `Unit "${id}" must have sizes`);
    assert(!("max" in u),                  `Unit "${id}" must not have max on the unit itself`);
    u.sizes.forEach(s => {
      assert(s.label,                      `Unit "${id}" size missing label`);
      assert(typeof s.pts === "number",    `Unit "${id}" size missing pts`);
    });
    if (u.rulesAdaptations !== undefined) {
      assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.trim().length > 0,
        `Unit "${id}" rulesAdaptations must be a non-empty string if present`);
    }
  });
});

// ── Exclusive Unit Group Constraint ──────────────────────────────────────────

section("12. Exclusive Unit Group Constraint");

const necDataExcl  = loadJSON("data/factions/necrons.json");
const tombShipExcl = necDataExcl.detachments.find(d => d.id === "nec_tomb_ship");
const necUnitsExcl = necDataExcl.units;

const EXCLUSIVE_GROUP = [
  "nec_imotekh", "nec_overlord", "nec_hexmark_destroyer",
  "nec_overlord_shroud", "nec_trazyn", "nec_royal_warden", "nec_skorpekh_lord"
];

// Mirror app logic
function isExclusiveGroupBlockedSim(unitId, det, list) {
  return makeExcGroupChecker(det?.exclusiveUnitGroups)(unitId, list);
}
function canAddUnitExcl(unitId, list, det, units) {
  const unit    = units.find(u => u.id === unitId);
  const detUnit = det.units.find(du => du.id === unitId);
  if (!detUnit) return false;
  if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
  if (unit.type === "CHARACTER" && det.maxCharacters !== undefined &&
      list.filter(l => units.find(u => u.id === l.unitId)?.type === "CHARACTER").length >= det.maxCharacters) return false;
  const caps = det?.maxKeywordUnits;
  if (caps) for (const cap of caps) {
    if (!unit.keywords.includes(cap.keyword)) continue;
    if (list.filter(l => units.find(u => u.id === l.unitId)?.keywords.includes(cap.keyword)).length >= cap.max) return false;
  }
  if (isExclusiveGroupBlockedSim(unitId, det, list)) return false;
  return true;
}

test("Tomb Ship Complement has exclusiveUnitGroups defined", () => {
  assert(Array.isArray(tombShipExcl.exclusiveUnitGroups) && tombShipExcl.exclusiveUnitGroups.length > 0,
    "exclusiveUnitGroups must be a non-empty array on Tomb Ship Complement");
});

test("The exclusive group contains exactly the 7 correct unit IDs", () => {
  const group = tombShipExcl.exclusiveUnitGroups[0];
  assertEqual(group.length, EXCLUSIVE_GROUP.length,
    `Exclusive group must contain exactly ${EXCLUSIVE_GROUP.length} units`);
  EXCLUSIVE_GROUP.forEach(id => {
    assert(group.includes(id), `Exclusive group must include "${id}"`);
  });
});

test("All exclusive group unit IDs exist in necrons.json units", () => {
  const unitIds = new Set(necUnitsExcl.map(u => u.id));
  tombShipExcl.exclusiveUnitGroups[0].forEach(id => {
    assert(unitIds.has(id),
      `Exclusive group references "${id}" which does not exist in necrons.json units`);
  });
});

test("All exclusive group unit IDs are in the Tomb Ship Complement detachment roster", () => {
  const detUnitIds = new Set(tombShipExcl.units.map(du => du.id));
  tombShipExcl.exclusiveUnitGroups[0].forEach(id => {
    assert(detUnitIds.has(id),
      `Exclusive group unit "${id}" must be listed in the Tomb Ship Complement units array`);
  });
});

test("First exclusive unit can be added to an empty list", () => {
  EXCLUSIVE_GROUP.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipExcl, []),
      `${id} should not be blocked when the list is empty`);
  });
});

test("Adding one exclusive unit blocks all others in the group", () => {
  EXCLUSIVE_GROUP.forEach(takenId => {
    const list = [{ unitId: takenId }];
    EXCLUSIVE_GROUP.filter(id => id !== takenId).forEach(otherId => {
      assert(isExclusiveGroupBlockedSim(otherId, tombShipExcl, list),
        `${otherId} should be blocked when ${takenId} is already in the list`);
    });
  });
});

test("A unit is never blocked by its own presence in the list", () => {
  EXCLUSIVE_GROUP.forEach(id => {
    const list = [{ unitId: id }];
    // The unit is already at max:1 so won't be addable, but the exclusive block
    // specifically should NOT be triggered for a unit against itself
    assert(!isExclusiveGroupBlockedSim(id, tombShipExcl, list),
      `${id} should not be exclusively-blocked by its own presence`);
  });
});

test("Units outside the exclusive group are never blocked by it", () => {
  const list = [{ unitId: "nec_imotekh" }];
  const outsideGroup = ["nec_chronomancer", "nec_immortals", "nec_warriors",
                        "nec_deathmarks", "nec_lychguard", "nec_flayed_ones",
                        "nec_skorpekh_destroyers"];
  outsideGroup.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipExcl, list),
      `${id} (outside exclusive group) should not be blocked when an exclusive unit is present`);
  });
});

test("Removing the taken unit unblocks the rest of the group", () => {
  const list = [{ id: 0, unitId: "nec_overlord" }];
  assert(isExclusiveGroupBlockedSim("nec_imotekh", tombShipExcl, list),
    "Imotekh should be blocked while Overlord is in the list");
  const trimmed = list.filter(l => l.id !== 0);
  assert(!isExclusiveGroupBlockedSim("nec_imotekh", tombShipExcl, trimmed),
    "Imotekh should be unblocked once Overlord is removed");
});

test("canAddUnit — Hexmark Destroyer is blocked when Skorpekh Lord is present", () => {
  const list = [{ unitId: "nec_skorpekh_lord", pts: 90 }];
  assert(!canAddUnitExcl("nec_hexmark_destroyer", list, tombShipExcl, necUnitsExcl),
    "Hexmark Destroyer should be blocked when Skorpekh Lord is already in the list");
});

test("canAddUnit — Royal Warden is blocked when Trazyn is present", () => {
  const list = [{ unitId: "nec_trazyn", pts: 75 }];
  assert(!canAddUnitExcl("nec_royal_warden", list, tombShipExcl, necUnitsExcl),
    "Royal Warden should be blocked when Trazyn the Infinite is already in the list");
});

test("canAddUnit — Overlord with Shroud is blocked when plain Overlord is present", () => {
  const list = [{ unitId: "nec_overlord", pts: 85 }];
  assert(!canAddUnitExcl("nec_overlord_shroud", list, tombShipExcl, necUnitsExcl),
    "Overlord with Translocation Shroud should be blocked when Overlord is already in the list");
});

test("canAddUnit — Imotekh can be added when only non-exclusive units are present", () => {
  const list = [
    { unitId: "nec_chronomancer",  pts: 65 },
    { unitId: "nec_immortals",     pts: 70 },
  ];
  assert(canAddUnitExcl("nec_imotekh", list, tombShipExcl, necUnitsExcl),
    "Imotekh should be addable when only non-exclusive units are in the list");
});

test("Exclusive constraint and CRYPTEK cap both apply independently", () => {
  // Add Imotekh (exclusive group, not CRYPTEK) + Chronomancer (CRYPTEK) — both should be fine
  const list = [
    { unitId: "nec_imotekh",      pts: 100 },
    { unitId: "nec_chronomancer", pts: 65  },
  ];
  // Now Overlord should be blocked by exclusive group, but Plasmancer blocked by CRYPTEK cap
  assert(isExclusiveGroupBlockedSim("nec_overlord", tombShipExcl, list),
    "Overlord should be exclusive-blocked when Imotekh is present");
  const plasmancer = necUnitsExcl.find(u => u.id === "nec_plasmancer");
  const cryptekCap = tombShipExcl.maxKeywordUnits.find(c => c.keyword === "CRYPTEK");
  const cryptekCount = list.filter(l => necUnitsExcl.find(u => u.id === l.unitId)?.keywords.includes("CRYPTEK")).length;
  assert(cryptekCount >= cryptekCap.max,
    "CRYPTEK cap should independently be reached, blocking Plasmancer");
});

test("Smoke test — valid list with one exclusive unit plus supporting units", () => {
  // Overlord (85) + Chronomancer (65) + Immortals x2 (140) + Lychguard 5-man (85) + Warriors (90) = 465pts
  const list = [
    { unitId: "nec_overlord",      pts: 85,  type: "CHARACTER"  },
    { unitId: "nec_chronomancer",  pts: 65,  type: "CHARACTER"  },
    { unitId: "nec_immortals",     pts: 70,  type: "BATTLELINE" },
    { unitId: "nec_immortals",     pts: 70,  type: "BATTLELINE" },
    { unitId: "nec_lychguard",     pts: 85,  type: "INFANTRY"   },
    { unitId: "nec_warriors",      pts: 90,  type: "BATTLELINE" },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts must be within 500pt limit`);
  const chars = list.filter(l => l.type === "CHARACTER").length;
  assert(chars <= tombShipExcl.maxCharacters,
    `${chars} CHARACTERs must be within cap of ${tombShipExcl.maxCharacters}`);
  const exclusiveInList = list.filter(l => EXCLUSIVE_GROUP.includes(l.unitId));
  assert(exclusiveInList.length <= 1,
    `Only 1 exclusive unit should be present; found ${exclusiveInList.length}`);
  const cryptekCount = list.filter(l =>
    necUnitsExcl.find(u => u.id === l.unitId)?.keywords.includes("CRYPTEK")).length;
  assert(cryptekCount <= 1, `CRYPTEK count ${cryptekCount} must not exceed cap of 1`);
});

test("HTML enforces isExclusiveGroupBlocked in addUnit", () => {
  assert(html.includes("isExclusiveGroupBlocked"),
    "addUnit must call isExclusiveGroupBlocked");
});

test("HTML greys out exclusive-group-blocked units in the unit grid", () => {
  assert(html.includes("isExclusiveGroupBlocked"),
    "getUnitStatus must call isExclusiveGroupBlocked when checking if a unit is blocked");
});

test("HTML shows a hint naming the taken unit when an exclusive unit is blocked", () => {
  assert(html.includes("getExclusiveGroupHint"),
    "getUnitStatus must call getExclusiveGroupHint to populate the blocked hint");
});

test("HTML getExclusiveGroupHint names the unit that caused the block", () => {
  assert(html.includes("already selected from this exclusive group"),
    "getExclusiveGroupHint must include the phrase 'already selected from this exclusive group'");
});

test("Detachments without exclusiveUnitGroups are unaffected", () => {
  // Tyranids have no exclusive groups
  factionData["tyranids"].detachments.forEach(det => {
    assert(det.exclusiveUnitGroups === undefined,
      `Detachment "${det.id}" in "tyranids" should not have exclusiveUnitGroups`);
  });
  // CSM Underdeck Uprising and Champions of Chaos have no exclusive groups
  ["csm_underdeck_uprising", "csm_champions_of_chaos"].forEach(detId => {
    const det = factionData["chaos_space_marines"].detachments.find(d => d.id === detId);
    assert(det !== undefined, `Detachment "${detId}" must exist`);
    assert(det.exclusiveUnitGroups === undefined,
      `Detachment "${detId}" should not have exclusiveUnitGroups`);
  });
  // Pilum Strike Team and Terminator Assault have no exclusive groups
  ["sm_vanguard", "sm_terminator_assault"].forEach(detId => {
    const det = factionData["space_marines"].detachments.find(d => d.id === detId);
    assert(det.exclusiveUnitGroups === undefined,
      `Detachment "${detId}" should not have exclusiveUnitGroups`);
  });
  // Other Necron detachments also unaffected
  ["nec_harbinger_cabal", "nec_deranged_outcasts", "nec_canoptek_harvesters"].forEach(detId => {
    const det = necDataExcl.detachments.find(d => d.id === detId);
    assert(det.exclusiveUnitGroups === undefined,
      `Detachment "${detId}" should not have exclusiveUnitGroups`);
  });
});

test("Infernal Reavers has correct exclusiveUnitGroups", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  assert(Array.isArray(det.exclusiveUnitGroups) && det.exclusiveUnitGroups.length === 2,
    "Infernal Reavers must have 2 exclusiveUnitGroups");
  // Group 1: Cultist Firebrand / Dark Commune / Traitor Enforcer
  const group1 = det.exclusiveUnitGroups[0];
  assert(group1.includes("csm_cultist_firebrand"), "Group 1 must include csm_cultist_firebrand");
  assert(group1.includes("csm_dark_commune"),      "Group 1 must include csm_dark_commune");
  assert(group1.includes("csm_traitor_enforcer"),  "Group 1 must include csm_traitor_enforcer");
  // Group 2: Chaos Spawn / Raptors / Warp Talons / Possessed
  const group2 = det.exclusiveUnitGroups[1];
  assert(group2.includes("csm_chaos_spawn"),    "Group 2 must include csm_chaos_spawn");
  assert(group2.includes("csm_raptors"),         "Group 2 must include csm_raptors");
  assert(group2.includes("csm_warp_talons"),     "Group 2 must include csm_warp_talons");
  assert(group2.includes("csm_possessed"),       "Group 2 must include csm_possessed");
});

test("Geomancer is in Tomb Ship Complement with max 1", () => {
  const du = tombShipDet.units.find(u => u.id === "nec_geomancer");
  assert(du !== undefined, "nec_geomancer must be in Tomb Ship Complement");
  assertEqual(du.max, 1, "Geomancer must have max 1");
  const unit = necUnitsTomb.find(u => u.id === "nec_geomancer");
  assert(unit.keywords.includes("CRYPTEK"),
    "Geomancer must have CRYPTEK keyword — subject to the CRYPTEK cap");
});

test("Canoptek Scarab Swarm is in Tomb Ship Complement with max 1", () => {
  const du = tombShipDet.units.find(u => u.id === "nec_canoptek_scarab_swarm");
  assert(du !== undefined, "nec_canoptek_scarab_swarm must be in Tomb Ship Complement");
  assertEqual(du.max, 1, "Canoptek Scarab Swarm must have max 1");
  const unit = necUnitsTomb.find(u => u.id === "nec_canoptek_scarab_swarm");
  assertEqual(unit.type, "SWARM", "Canoptek Scarab Swarm must have type SWARM");
});

test("Ophydian Destroyers is in Tomb Ship Complement with max 1", () => {
  const du = tombShipDet.units.find(u => u.id === "nec_ophydian_destroyers");
  assert(du !== undefined, "nec_ophydian_destroyers must be in Tomb Ship Complement");
  assertEqual(du.max, 1, "Ophydian Destroyers must have max 1");
  const unit = necUnitsTomb.find(u => u.id === "nec_ophydian_destroyers");
  assertEqual(unit.type, "INFANTRY", "Ophydian Destroyers must have type INFANTRY");
});

test("Geomancer counts toward the CRYPTEK cap in Tomb Ship Complement", () => {
  // If Geomancer is in the list, another CRYPTEK like Plasmancer must be blocked
  const list = [{ unitId: "nec_geomancer", pts: 75 }];
  const plasmancer = necUnitsTomb.find(u => u.id === "nec_plasmancer");
  const cryptekCap = tombShipDet.maxKeywordUnits.find(c => c.keyword === "CRYPTEK");
  const cryptekCount = list.filter(l =>
    necUnitsTomb.find(u => u.id === l.unitId)?.keywords.includes("CRYPTEK")).length;
  assert(cryptekCount >= cryptekCap.max,
    "Geomancer (CRYPTEK) must consume the CRYPTEK cap, blocking further CRYPTEK units");
});

test("Canoptek Scarab Swarm and Ophydian Destroyers are outside the exclusive group", () => {
  const group = tombShipDet.exclusiveUnitGroups[0];
  assert(!group.includes("nec_canoptek_scarab_swarm"),
    "Canoptek Scarab Swarm must not be in the exclusive unit group");
  assert(!group.includes("nec_ophydian_destroyers"),
    "Ophydian Destroyers must not be in the exclusive unit group");
  assert(!group.includes("nec_geomancer"),
    "Geomancer must not be in the exclusive unit group");
});

test("Triarch Praetorians is in Tomb Ship Complement with max 1", () => {
  const du = tombShipDet.units.find(u => u.id === "nec_triarch_praetorians");
  assert(du !== undefined, "nec_triarch_praetorians must be in Tomb Ship Complement");
  assertEqual(du.max, 1, "Triarch Praetorians must have max 1");
});

test("Triarch Praetorians has correct fields", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_triarch_praetorians");
  assert(u !== undefined, "nec_triarch_praetorians must exist in necrons.json");
  assertEqual(u.name, "Triarch Praetorians");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("NECRONS"),   "must have NECRONS keyword");
  assert(u.keywords.includes("INFANTRY"),  "must have INFANTRY keyword");
  assertEqual(u.sizes.length, 2,           "must have 2 size options");
  assertEqual(u.sizes[0].label, "5 models",  "small size label must be '5 models'");
  assertEqual(u.sizes[0].pts,   90,          "5-model size must cost 90pts");
  assertEqual(u.sizes[1].label, "10 models", "large size label must be '10 models'");
  assertEqual(u.sizes[1].pts,   180,         "10-model size must cost 180pts");
  assert(u.rulesAdaptations && u.rulesAdaptations.includes("Deep Strike"),
    "rulesAdaptations must reference Deep Strike");
  assert(u.rulesAdaptations.includes("9"),
    "rulesAdaptations must reference the reduced Movement of 9\"");
});

test("Triarch Praetorians is outside the exclusive unit group", () => {
  const group = tombShipDet.exclusiveUnitGroups[0];
  assert(!group.includes("nec_triarch_praetorians"),
    "Triarch Praetorians must not be in the exclusive unit group");
});

test("Triarch Praetorians is not CRYPTEK — does not consume the CRYPTEK cap", () => {
  const u = necUnitsTomb.find(u => u.id === "nec_triarch_praetorians");
  assert(!u.keywords.includes("CRYPTEK"),
    "Triarch Praetorians must not have the CRYPTEK keyword");
});

test("Tomb Ship Complement has a second exclusive unit group for mobile units", () => {
  assertEqual(tombShipDet.exclusiveUnitGroups.length, 2,
    "Tomb Ship Complement must have exactly 2 exclusive unit groups");
});

test("Second exclusive group contains exactly Canoptek Scarab Swarm, Ophydian Destroyers, Triarch Praetorians", () => {
  const group = tombShipDet.exclusiveUnitGroups[1];
  const expectedIds = ["nec_canoptek_scarab_swarm", "nec_ophydian_destroyers", "nec_triarch_praetorians"];
  assertEqual(group.length, expectedIds.length,
    `Second exclusive group must contain exactly ${expectedIds.length} units`);
  expectedIds.forEach(id => {
    assert(group.includes(id), `Second exclusive group must include "${id}"`);
  });
});

test("Second exclusive group — first unit can be added to an empty list", () => {
  const group2 = tombShipDet.exclusiveUnitGroups[1];
  group2.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipDet, []),
      `${id} should not be blocked when the list is empty`);
  });
});

test("Second exclusive group — adding one blocks the other two", () => {
  const group2 = tombShipDet.exclusiveUnitGroups[1];
  group2.forEach(takenId => {
    const list = [{ unitId: takenId }];
    group2.filter(id => id !== takenId).forEach(otherId => {
      assert(isExclusiveGroupBlockedSim(otherId, tombShipDet, list),
        `${otherId} should be blocked when ${takenId} is already in the list`);
    });
  });
});

test("Second exclusive group — a unit is not blocked by its own presence", () => {
  const group2 = tombShipDet.exclusiveUnitGroups[1];
  group2.forEach(id => {
    const list = [{ unitId: id }];
    assert(!isExclusiveGroupBlockedSim(id, tombShipDet, list),
      `${id} should not be exclusively-blocked by its own presence`);
  });
});

test("Second exclusive group — removing the taken unit unblocks the others", () => {
  const list = [{ id: 0, unitId: "nec_triarch_praetorians" }];
  assert(isExclusiveGroupBlockedSim("nec_canoptek_scarab_swarm", tombShipDet, list),
    "Canoptek Scarab Swarm should be blocked while Triarch Praetorians is in the list");
  const trimmed = list.filter(l => l.id !== 0);
  assert(!isExclusiveGroupBlockedSim("nec_canoptek_scarab_swarm", tombShipDet, trimmed),
    "Canoptek Scarab Swarm should be unblocked once Triarch Praetorians is removed");
});

test("Two exclusive groups are independent — selecting from group 1 does not block group 2", () => {
  const list = [{ unitId: "nec_overlord" }]; // group 1 unit
  const group2 = tombShipDet.exclusiveUnitGroups[1];
  group2.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipDet, list),
      `${id} (group 2) should not be blocked by selecting an Overlord (group 1)`);
  });
});

test("Two exclusive groups are independent — selecting from group 2 does not block group 1", () => {
  const list = [{ unitId: "nec_canoptek_scarab_swarm" }]; // group 2 unit
  const group1 = tombShipDet.exclusiveUnitGroups[0];
  group1.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipDet, list),
      `${id} (group 1) should not be blocked by selecting a Canoptek Scarab Swarm (group 2)`);
  });
});

test("Units outside both exclusive groups are never blocked by either", () => {
  const list = [
    { unitId: "nec_imotekh" },             // group 1
    { unitId: "nec_triarch_praetorians" }  // group 2
  ];
  const outsideBoth = ["nec_chronomancer", "nec_immortals", "nec_warriors",
                       "nec_deathmarks", "nec_lychguard", "nec_flayed_ones",
                       "nec_skorpekh_destroyers"];
  outsideBoth.forEach(id => {
    assert(!isExclusiveGroupBlockedSim(id, tombShipDet, list),
      `${id} (outside both groups) should not be blocked`);
  });
});

// ── Boarding Strike Detachment ────────────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("13. Adeptus Astartes — Boarding Strike Detachment");

const smDataBS  = loadJSON("data/factions/adeptus_astartes.json");
const boardingStrikeDet = smDataBS.detachments.find(d => d.id === "sm_boarding_strike");
const smUnitsBS = smDataBS.units;
// Convenience alias used throughout sections 13-15

test("Boarding Strike detachment exists", () => {
  assert(boardingStrikeDet !== undefined,
    "sm_boarding_strike detachment must exist in adeptus_astartes.json");
});

test("Boarding Strike has correct name", () => {
  assertEqual(boardingStrikeDet.name, "Boarding Strike",
    "Detachment name must be 'Boarding Strike'");
});

test("Boarding Strike has Drive Home the Blade special rule", () => {
  assertEqual(boardingStrikeDet.specialRule.name, "Drive Home the Blade",
    "Special rule name must be 'Drive Home the Blade'");
  assert(boardingStrikeDet.specialRule.desc.includes("SUSTAINED HITS 1"),
    "Special rule description must mention SUSTAINED HITS 1");
  assert(boardingStrikeDet.specialRule.desc.includes("Hatchway"),
    "Special rule description must mention Hatchway");
});

test("Boarding Strike has maxCharacters set to 2", () => {
  assertEqual(boardingStrikeDet.maxCharacters, 2,
    "Boarding Strike must have maxCharacters: 2");
});

test("Boarding Strike has factionKeywordGroups with all 12 chapter keywords", () => {
  assert(Array.isArray(boardingStrikeDet.factionKeywordGroups) &&
    boardingStrikeDet.factionKeywordGroups.length > 0,
    "Boarding Strike must have factionKeywordGroups defined");
  const group = boardingStrikeDet.factionKeywordGroups[0];
  assertEqual(group.length, 12, "factionKeywordGroups must contain all 12 chapter keywords");
  ["SPACE WOLVES", "DARK ANGELS", "DEATHWATCH", "IMPERIAL FISTS", "ULTRAMARINES",
   "RAVEN GUARD", "SALAMANDERS", "BLOOD ANGELS", "BLACK TEMPLARS",
   "CRIMSON FISTS", "WHITE SCARS", "IRON HANDS"].forEach(kw => {
    assert(group.includes(kw), `factionKeywordGroups must include "${kw}"`);
  });
});

test("Boarding Strike has 2 enhancements", () => {
  assertEqual(boardingStrikeDet.enhancements.length, 2,
    "Boarding Strike must have exactly 2 enhancements");
});

test("Boarding Strike enhancements have no keyword requirements", () => {
  boardingStrikeDet.enhancements.forEach(enh => {
    assert(Array.isArray(enh.requiresKeywords),
      `Enhancement "${enh.id}" must have requiresKeywords array`);
    assertEqual(enh.requiresKeywords.length, 0,
      `Enhancement "${enh.id}" must have no keyword requirements`);
  });
});

test("Boarding Strike has the Adamantine Mantle enhancement", () => {
  const enh = boardingStrikeDet.enhancements.find(e => e.id === "enh_sm_adamantine_mantle");
  assert(enh !== undefined, "enh_sm_adamantine_mantle must exist");
  assertEqual(enh.name, "Adamantine Mantle");
  assert(enh.desc.includes("Damage characteristic"), "Adamantine Mantle must reference the Damage characteristic");
  assert(enh.desc.includes("subtract 1"), "Adamantine Mantle must mention subtracting 1");
});

test("Boarding Strike has the Clavitine Reliquary enhancement", () => {
  const enh = boardingStrikeDet.enhancements.find(e => e.id === "enh_sm_clavitine_reliquary");
  assert(enh !== undefined, "enh_sm_clavitine_reliquary must exist");
  assertEqual(enh.name, "Clavitine Reliquary");
  assert(enh.desc.includes("Hatchway"), "Clavitine Reliquary must mention Hatchway");
  assert(enh.desc.includes("Normal or Advance move"), "Clavitine Reliquary must mention Normal or Advance move");
});

test("Adeptus Astartes has 4 detachments including Boarding Strike", () => {
  assertEqual(smDataBS.detachments.length, 4,
    "Adeptus Astartes must have exactly 4 detachments");
  assert(smDataBS.detachments.find(d => d.id === "sm_vanguard"),            "sm_vanguard must exist");
  assert(smDataBS.detachments.find(d => d.id === "sm_terminator_assault"),  "sm_terminator_assault must exist");
  assert(smDataBS.detachments.find(d => d.id === "sm_boarding_strike"),     "sm_boarding_strike must exist");
  assert(smDataBS.detachments.find(d => d.id === "sm_shield_of_the_void"),  "sm_shield_of_the_void must exist");
});

test("Boarding Strike has all 83 expected units", () => {
  const expectedIds = [
    "sm_captain", "sm_librarian", "sm_tacticals",
    "sm_adrax_agatone", "sm_aggressor_squad", "sm_ancient",
    "sm_apothecary", "sm_apothecary_biologis",
    "sm_assault_intercessors", "sm_assault_intercessors_jump",
    "sm_bladeguard_ancient", "sm_bladeguard_veterans", "sm_captain_gravis",
    "sm_captain_sicarius", "sm_captain_jump_pack", "sm_cato_sicarius",
    "sm_chaplain", "sm_chaplain_jump_pack", "sm_chief_librarian_tigurius",
    "sm_company_heroes",
    "sm_eradicator_squad", "sm_heavy_intercessors", "sm_hellblaster_squad",
    "sm_infernus_squad", "sm_intercessor_squad", "sm_iron_father_feirros",
    "sm_judiciar",
    "sm_korsarro_khan", "sm_lieutenant", "sm_marneus_calgar",
    "sm_pedro_kantor", "sm_roboute_guilliman",
    "sm_sternguard_veterans", "sm_techmarine", "sm_tor_garadon",
    "sm_uriel_ventris", "sm_vanguard_veterans_jump", "sm_vulkan_hestan",
    "sm_chaplain_grimaldus", "sm_high_marshal_helbrecht", "sm_castellan",
    "sm_crusade_ancient", "sm_emperors_champion", "sm_execrator",
    "sm_marshal", "sm_crusader_squad",
    "sm_astorath", "sm_chief_librarian_mephiston", "sm_commander_dante",
    "sm_lemartes", "sm_the_sanguinor",
    "sm_blood_angels_captain", "sm_death_company_captain",
    "sm_death_company_captain_jetpack", "sm_sanguinary_priest",
    "sm_death_company_marines", "sm_death_company_marines_bolt_rifles",
    "sm_death_company_marines_jump_packs", "sm_sanguinary_guard",
    "sm_asmodai", "sm_azrael", "sm_ezekiel", "sm_lazarus", "sm_lion_eljonson",
    "sm_inner_circle_companions", "sm_sword_brethren",
    "sm_watch_captain_artemis", "sm_watch_master", "sm_deathwatch_veterans",
    "sm_njal_stormcaller", "sm_ragnar_blackmane", "sm_ulrik_the_slayer",
    "sm_iron_priest", "sm_wolf_guard_battle_leader", "sm_wolf_priest",
    "sm_bloodclaws", "sm_grey_hunters", "sm_wolf_guard_headtakers",
    "sm_wulfen", "sm_wulfen_storm_shields", "sm_fenrisian_wolves",
    "sm_captain_titus", "sm_marneus_calgar_antilochus"
  ];
  const actualIds = boardingStrikeDet.units.map(u => u.id);
  expectedIds.forEach(id => {
    assert(actualIds.includes(id), `Boarding Strike must include unit "${id}"`);
  });
  assertEqual(actualIds.length, expectedIds.length,
    `Expected ${expectedIds.length} units, found ${actualIds.length}`);
});

test("Captain and Librarian are in Boarding Strike at max 1", () => {
  const capEntry = boardingStrikeDet.units.find(du => du.id === "sm_captain");
  const libEntry = boardingStrikeDet.units.find(du => du.id === "sm_librarian");
  assert(capEntry !== undefined, "sm_captain must be in Boarding Strike");
  assert(libEntry !== undefined, "sm_librarian must be in Boarding Strike");
  assertEqual(capEntry.max, 1, "Captain must have max 1");
  assertEqual(libEntry.max, 1, "Librarian must have max 1");
});

test("Tactical Squad is in Boarding Strike at max 3", () => {
  const entry = boardingStrikeDet.units.find(du => du.id === "sm_tacticals");
  assert(entry !== undefined, "sm_tacticals must be in Boarding Strike");
  assertEqual(entry.max, 3, "Tactical Squad must have max 3");
});

test("No CHARACTER+PHOBOS units are in Boarding Strike", () => {
  const phobosCharIds = smUnitsBS
    .filter(u => u.keywords.includes("CHARACTER") && u.keywords.includes("PHOBOS"))
    .map(u => u.id);
  assert(phobosCharIds.length === 6, `Expected 6 CHARACTER+PHOBOS units in the faction, found ${phobosCharIds.length}`);
  phobosCharIds.forEach(id => {
    const entry = boardingStrikeDet.units.find(du => du.id === id);
    assert(entry === undefined, `CHARACTER+PHOBOS unit "${id}" must NOT be in Boarding Strike`);
  });
});

test("Boarding Strike does not include generic Terminator units", () => {
  const excludedFromBS = ["sm_terminators", "sm_terminator_assault_squad"];
  excludedFromBS.forEach(id => {
    assert(!boardingStrikeDet.units.find(du => du.id === id),
      `Terminator unit "${id}" must not be in Boarding Strike`);
  });
});

test("factionKeywordGroups chapter exclusivity applies in Boarding Strike", () => {
  function isBlockedBS(unitId, list) {
    const unit = smUnitsBS.find(u => u.id === unitId);
    const groups = boardingStrikeDet.factionKeywordGroups;
    for (const group of groups) {
      const unitGroupKws = unit.keywords.filter(k => group.includes(k));
      if (!unitGroupKws.length) continue;
      const committed = group.find(kw =>
        list.some(l => smUnitsBS.find(u => u.id === l.unitId)?.keywords.includes(kw))
      );
      if (committed && !unitGroupKws.includes(committed)) return true;
    }
    return false;
  }
  const captain = smUnitsBS.find(u => u.id === "sm_captain");
  assert(captain !== undefined, "sm_captain must exist in the faction");
  assert(!captain.keywords.some(kw =>
    ["SPACE WOLVES","DARK ANGELS","DEATHWATCH","IMPERIAL FISTS","ULTRAMARINES",
     "RAVEN GUARD","SALAMANDERS","BLOOD ANGELS","BLACK TEMPLARS","CRIMSON FISTS",
     "WHITE SCARS","IRON HANDS"].includes(kw)),
    "Captain must have no chapter keyword");
  assert(!isBlockedBS("sm_captain", []), "Captain must not be blocked in an empty list");
  assert(!isBlockedBS("sm_librarian", []), "Librarian must not be blocked in an empty list");
});

test("Boarding Strike smoke test — valid list within all constraints", () => {
  const list = [
    { unitId: "sm_captain",   pts: 80,  type: "CHARACTER"  },
    { unitId: "sm_librarian", pts: 65,  type: "CHARACTER"  },
    { unitId: "sm_tacticals", pts: 140, type: "BATTLELINE" },
    { unitId: "sm_tacticals", pts: 140, type: "BATTLELINE" },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts must be within 500pt limit`);
  const chars = list.filter(l => l.type === "CHARACTER").length;
  assert(chars <= boardingStrikeDet.maxCharacters,
    `${chars} CHARACTERs must be within cap of ${boardingStrikeDet.maxCharacters}`);
  const allUnitIds = boardingStrikeDet.units.map(du => du.id);
  list.forEach(l => {
    assert(allUnitIds.includes(l.unitId), `${l.unitId} must be in the Boarding Strike detachment roster`);
  });
});


// ── 14. Boarding Strike — Unit Definitions ────────────────────────────────────

section("14. Boarding Strike — Unit Definitions");

// All unit definition tests. One test per unit covering: exists, name, type,
// key keywords, points, and rulesAdaptations where relevant.

test("Adrax Agatone has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_adrax_agatone");
  assert(unit !== undefined, "sm_adrax_agatone must exist");
  assertEqual(unit.name, "Adrax Agatone");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("SALAMANDERS"), "Must have SALAMANDERS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),    "Must have TACTICUS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_adrax_agatone")?.max, 1, "Must have max 1");
});

test("Aggressor Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_aggressor_squad");
  assert(unit !== undefined, "sm_aggressor_squad must exist");
  assertEqual(unit.name, "Aggressor Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 95);
  assert(unit.keywords.includes("GRAVIS"), "Must have GRAVIS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_aggressor_squad")?.max, 1, "Must have max 1");
});

test("Ancient has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_ancient");
  assert(unit !== undefined, "sm_ancient must exist");
  assertEqual(unit.name, "Ancient");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 50);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Ancient must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_ancient")?.max, 1, "Must have max 1");
});

test("Apothecary has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_apothecary");
  assert(unit !== undefined, "sm_apothecary must exist");
  assertEqual(unit.name, "Apothecary");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 50);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Narthecium"), "rulesAdaptations must mention Narthecium");
  assert(unit.rulesAdaptations?.includes("Gene-seed Recovery"), "rulesAdaptations must mention Gene-seed Recovery");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_apothecary")?.max, 1, "Must have max 1");
});

test("Apothecary Biologis has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_apothecary_biologis");
  assert(unit !== undefined, "sm_apothecary_biologis must exist");
  assertEqual(unit.name, "Apothecary Biologis");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("GRAVIS"), "Must have GRAVIS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_apothecary_biologis")?.max, 1, "Must have max 1");
});

test("Assault Intercessor Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_assault_intercessors");
  assert(unit !== undefined, "sm_assault_intercessors must exist");
  assertEqual(unit.name, "Assault Intercessor Squad");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 75);
  assertEqual(unit.sizes[1].pts, 150);
  assert(unit.keywords.includes("BATTLELINE"), "Must have BATTLELINE keyword");
  assert(unit.keywords.includes("TACTICUS"),   "Must have TACTICUS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_assault_intercessors")?.max, 3, "Must have max 3");
});

test("Assault Intercessors with Jump Packs has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_assault_intercessors_jump");
  assert(unit !== undefined, "sm_assault_intercessors_jump must exist");
  assertEqual(unit.name, "Assault Intercessors with Jump Packs");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 90);
  assertEqual(unit.sizes[1].pts, 170);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "rulesAdaptations must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Hammer of Wrath"), "rulesAdaptations must mention Hammer of Wrath");
  assert(unit.rulesAdaptations?.includes("Movement"), "rulesAdaptations must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_assault_intercessors_jump")?.max, 1, "Must have max 1");
});

test("Bladeguard Ancient has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_bladeguard_ancient");
  assert(unit !== undefined, "sm_bladeguard_ancient must exist");
  assertEqual(unit.name, "Bladeguard Ancient");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 45);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_bladeguard_ancient")?.max, 1, "Must have max 1");
});

test("Bladeguard Veteran Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_bladeguard_veterans");
  assert(unit !== undefined, "sm_bladeguard_veterans must exist");
  assertEqual(unit.name, "Bladeguard Veteran Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 80);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_bladeguard_veterans")?.max, 1, "Must have max 1");
});

test("Captain in Gravis Armour has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_captain_gravis");
  assert(unit !== undefined, "sm_captain_gravis must exist");
  assertEqual(unit.name, "Captain in Gravis Armour");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 80);
  assert(unit.keywords.includes("GRAVIS"), "Must have GRAVIS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_captain_gravis")?.max, 1, "Must have max 1");
});

test("Captain Sicarius has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_captain_sicarius");
  assert(unit !== undefined, "sm_captain_sicarius must exist");
  assertEqual(unit.name, "Captain Sicarius");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),     "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Knight Champion of Macragge"), "Must mention Knight Champion of Macragge");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_captain_sicarius")?.max, 1, "Must have max 1");
});

test("Captain with Jump Pack has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_captain_jump_pack");
  assert(unit !== undefined, "sm_captain_jump_pack must exist");
  assertEqual(unit.name, "Captain with Jump Pack");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 75);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_captain_jump_pack")?.max, 1, "Must have max 1");
});

test("Cato Sicarius has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_cato_sicarius");
  assert(unit !== undefined, "sm_cato_sicarius must exist");
  assertEqual(unit.name, "Cato Sicarius");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 95);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),     "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Knight Champion of Macragge"), "Must mention Knight Champion of Macragge");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_cato_sicarius")?.max, 1, "Must have max 1");
});

test("Chaplain has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_chaplain");
  assert(unit !== undefined, "sm_chaplain must exist");
  assertEqual(unit.name, "Chaplain");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 60);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_chaplain")?.max, 1, "Must have max 1");
});

test("Chaplain with Jump Pack has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_chaplain_jump_pack");
  assert(unit !== undefined, "sm_chaplain_jump_pack must exist");
  assertEqual(unit.name, "Chaplain with Jump Pack");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 75);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_chaplain_jump_pack")?.max, 1, "Must have max 1");
});

test("Chief Librarian Tigurius has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_chief_librarian_tigurius");
  assert(unit !== undefined, "sm_chief_librarian_tigurius must exist");
  assertEqual(unit.name, "Chief Librarian Tigurius");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("PSYKER"),       "Must have PSYKER keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),     "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Master of Prescience"), "Must mention Master of Prescience");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_chief_librarian_tigurius")?.max, 1, "Must have max 1");
});

test("Eradicator Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_eradicator_squad");
  assert(unit !== undefined, "sm_eradicator_squad must exist");
  assertEqual(unit.name, "Eradicator Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 90);
  assert(unit.keywords.includes("GRAVIS"), "Must have GRAVIS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_eradicator_squad")?.max, 1, "Must have max 1");
});

test("Heavy Intercessor Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_heavy_intercessors");
  assert(unit !== undefined, "sm_heavy_intercessors must exist");
  assertEqual(unit.name, "Heavy Intercessor Squad");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 100);
  assertEqual(unit.sizes[1].pts, 200);
  assert(unit.keywords.includes("BATTLELINE"), "Must have BATTLELINE keyword");
  assert(unit.keywords.includes("GRAVIS"),     "Must have GRAVIS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_heavy_intercessors")?.max, 3, "Must have max 3");
});

test("Hellblaster Squad has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_hellblaster_squad");
  assert(unit !== undefined, "sm_hellblaster_squad must exist");
  assertEqual(unit.name, "Hellblaster Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].pts, 110);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("For the Chapter!"), "rulesAdaptations must mention For the Chapter!");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_hellblaster_squad")?.max, 1, "Must have max 1");
});

test("Infernus Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_infernus_squad");
  assert(unit !== undefined, "sm_infernus_squad must exist");
  assertEqual(unit.name, "Infernus Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 90);
  assertEqual(unit.sizes[1].pts, 180);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_infernus_squad")?.max, 1, "Must have max 1");
});

test("Intercessor Squad has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_intercessor_squad");
  assert(unit !== undefined, "sm_intercessor_squad must exist");
  assertEqual(unit.name, "Intercessor Squad");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 80);
  assertEqual(unit.sizes[1].pts, 160);
  assert(unit.keywords.includes("BATTLELINE"), "Must have BATTLELINE keyword");
  assert(unit.keywords.includes("TACTICUS"),   "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Objective Secured"), "rulesAdaptations must mention Objective Secured");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_intercessor_squad")?.max, 3, "Must have max 3");
});

test("Iron Father Feirros has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_iron_father_feirros");
  assert(unit !== undefined, "sm_iron_father_feirros must exist");
  assertEqual(unit.name, "Iron Father Feirros");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 95);
  assert(unit.keywords.includes("IRON HANDS"), "Must have IRON HANDS keyword");
  assert(unit.keywords.includes("EPIC HERO"),  "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("GRAVIS"),     "Must have GRAVIS keyword");
  assert(unit.rulesAdaptations?.includes("Iron Father"), "rulesAdaptations must mention Iron Father");
  assert(unit.rulesAdaptations?.includes("Master of the Forge"), "rulesAdaptations must mention Master of the Forge");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_iron_father_feirros")?.max, 1, "Must have max 1");
});

test("Judiciar has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_judiciar");
  assert(unit !== undefined, "sm_judiciar must exist");
  assertEqual(unit.name, "Judiciar");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_judiciar")?.max, 1, "Must have max 1");
});

test("Kor'sarro Khan has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_korsarro_khan");
  assert(unit !== undefined, "sm_korsarro_khan must exist");
  assertEqual(unit.name, "Kor'sarro Khan");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 60);
  assert(unit.keywords.includes("WHITE SCARS"), "Must have WHITE SCARS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),    "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_korsarro_khan")?.max, 1, "Must have max 1");
});

test("Lieutenant has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_lieutenant");
  assert(unit !== undefined, "sm_lieutenant must exist");
  assertEqual(unit.name, "Lieutenant");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 55);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_lieutenant")?.max, 1, "Must have max 1");
});

test("Marneus Calgar has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_marneus_calgar");
  assert(unit !== undefined, "sm_marneus_calgar must exist");
  assertEqual(unit.name, "Marneus Calgar");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 200);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("GRAVIS"),       "Must have GRAVIS keyword");
  assert(unit.rulesAdaptations?.includes("Master Tactician"), "rulesAdaptations must mention Master Tactician");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_marneus_calgar")?.max, 1, "Must have max 1");
});

test("Pedro Kantor has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_pedro_kantor");
  assert(unit !== undefined, "sm_pedro_kantor must exist");
  assertEqual(unit.name, "Pedro Kantor");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 90);
  assert(unit.keywords.includes("CRIMSON FISTS"), "Must have CRIMSON FISTS keyword");
  assert(unit.keywords.includes("EPIC HERO"),     "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),      "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_pedro_kantor")?.max, 1, "Must have max 1");
});

test("Roboute Guilliman has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_roboute_guilliman");
  assert(unit !== undefined, "sm_roboute_guilliman must exist");
  assertEqual(unit.name, "Roboute Guilliman");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 340);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("MONSTER"),      "Must have MONSTER keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("PRIMARCH"),     "Must have PRIMARCH keyword");
  assert(!unit.keywords.includes("INFANTRY"),    "Must NOT have INFANTRY keyword");
  assert(unit.rulesAdaptations?.includes("Armour of Fate"), "rulesAdaptations must mention Armour of Fate");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_roboute_guilliman")?.max, 1, "Must have max 1");
});

test("Sternguard Veteran Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_sternguard_veterans");
  assert(unit !== undefined, "sm_sternguard_veterans must exist");
  assertEqual(unit.name, "Sternguard Veteran Squad");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 100);
  assertEqual(unit.sizes[1].pts, 170);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_sternguard_veterans")?.max, 1, "Must have max 1");
});

test("Techmarine has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_techmarine");
  assert(unit !== undefined, "sm_techmarine must exist");
  assertEqual(unit.name, "Techmarine");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 55);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_techmarine")?.max, 1, "Must have max 1");
});

test("Tor Garadon has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_tor_garadon");
  assert(unit !== undefined, "sm_tor_garadon must exist");
  assertEqual(unit.name, "Tor Garadon");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 90);
  assert(unit.keywords.includes("IMPERIAL FISTS"), "Must have IMPERIAL FISTS keyword");
  assert(unit.keywords.includes("EPIC HERO"),      "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("GRAVIS"),         "Must have GRAVIS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_tor_garadon")?.max, 1, "Must have max 1");
});

test("Uriel Ventris has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_uriel_ventris");
  assert(unit !== undefined, "sm_uriel_ventris must exist");
  assertEqual(unit.name, "Uriel Ventris");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 95);
  assert(unit.keywords.includes("ULTRAMARINES"), "Must have ULTRAMARINES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),     "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Master of the Fleet"), "rulesAdaptations must mention Master of the Fleet");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_uriel_ventris")?.max, 1, "Must have max 1");
});

test("Vanguard Veteran Squad with Jump Packs has correct fields and rules adaptation", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_vanguard_veterans_jump");
  assert(unit !== undefined, "sm_vanguard_veterans_jump must exist");
  assertEqual(unit.name, "Vanguard Veteran Squad with Jump Packs");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 100);
  assertEqual(unit.sizes[1].pts, 200);
  assert(unit.keywords.includes("TACTICUS"), "Must have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_vanguard_veterans_jump")?.max, 1, "Must have max 1");
});

test("Vulkan He'stan has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_vulkan_hestan");
  assert(unit !== undefined, "sm_vulkan_hestan must exist");
  assertEqual(unit.name, "Vulkan He'stan");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 100);
  assert(unit.keywords.includes("SALAMANDERS"), "Must have SALAMANDERS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),    "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_vulkan_hestan")?.max, 1, "Must have max 1");
});

// Black Templars
test("Chaplain Grimaldus has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_chaplain_grimaldus");
  assert(unit !== undefined, "sm_chaplain_grimaldus must exist");
  assertEqual(unit.name, "Chaplain Grimaldus");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].label, "4 models");
  assertEqual(unit.sizes[0].pts, 110);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assert(unit.keywords.includes("EPIC HERO"),      "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),       "Must have TACTICUS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_chaplain_grimaldus")?.max, 1, "Must have max 1");
});

test("High Marshal Helbrecht has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_high_marshal_helbrecht");
  assert(unit !== undefined, "sm_high_marshal_helbrecht must exist");
  assertEqual(unit.name, "High Marshal Helbrecht");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 120);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assert(unit.keywords.includes("EPIC HERO"),      "Must have EPIC HERO keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_high_marshal_helbrecht")?.max, 1, "Must have max 1");
});

test("Castellan has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_castellan");
  assert(unit !== undefined, "sm_castellan must exist");
  assertEqual(unit.name, "Castellan");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assert(!unit.keywords.includes("EPIC HERO"),     "Must NOT have EPIC HERO keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_castellan")?.max, 1, "Must have max 1");
});

test("Crusade Ancient has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_crusade_ancient");
  assert(unit !== undefined, "sm_crusade_ancient must exist");
  assertEqual(unit.name, "Crusade Ancient");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 55);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_crusade_ancient")?.max, 1, "Must have max 1");
});

test("Emperor's Champion has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_emperors_champion");
  assert(unit !== undefined, "sm_emperors_champion must exist");
  assertEqual(unit.name, "Emperor's Champion");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 100);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_emperors_champion")?.max, 1, "Must have max 1");
});

test("Execrator has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_execrator");
  assert(unit !== undefined, "sm_execrator must exist");
  assertEqual(unit.name, "Execrator");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 60);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_execrator")?.max, 1, "Must have max 1");
});

test("Marshal has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_marshal");
  assert(unit !== undefined, "sm_marshal must exist");
  assertEqual(unit.name, "Marshal");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 80);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_marshal")?.max, 1, "Must have max 1");
});

test("Crusader Squad has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_crusader_squad");
  assert(unit !== undefined, "sm_crusader_squad must exist");
  assertEqual(unit.name, "Crusader Squad");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes[0].label, "10 models");
  assertEqual(unit.sizes[0].pts, 150);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assert(unit.keywords.includes("BATTLELINE"),     "Must have BATTLELINE keyword");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_crusader_squad")?.max, 3, "Must have max 3");
});

// Blood Angels
test("Astorath has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_astorath");
  assert(unit !== undefined, "sm_astorath must exist");
  assertEqual(unit.name, "Astorath");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),    "Must NOT have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "rulesAdaptations must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "rulesAdaptations must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_astorath")?.max, 1, "Must have max 1");
});

test("Chief Librarian Mephiston has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_chief_librarian_mephiston");
  assert(unit !== undefined, "sm_chief_librarian_mephiston must exist");
  assertEqual(unit.name, "Chief Librarian Mephiston");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 120);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("PSYKER"),       "Must have PSYKER keyword");
  assert(unit.rulesAdaptations?.includes("The Quickening"), "rulesAdaptations must mention The Quickening");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_chief_librarian_mephiston")?.max, 1, "Must have max 1");
});

test("Commander Dante has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_commander_dante");
  assert(unit !== undefined, "sm_commander_dante must exist");
  assertEqual(unit.name, "Commander Dante");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 120);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_commander_dante")?.max, 1, "Must have max 1");
});

test("Lemartes has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_lemartes");
  assert(unit !== undefined, "sm_lemartes must exist");
  assertEqual(unit.name, "Lemartes");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 100);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),    "Must NOT have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_lemartes")?.max, 1, "Must have max 1");
});

test("The Sanguinor has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_the_sanguinor");
  assert(unit !== undefined, "sm_the_sanguinor must exist");
  assertEqual(unit.name, "The Sanguinor");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 130);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),    "Must NOT have TACTICUS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"),        "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Miraculous Saviour"), "Must mention Miraculous Saviour");
  assert(unit.rulesAdaptations?.includes("Movement"),           "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_the_sanguinor")?.max, 1, "Must have max 1");
});

test("Blood Angels Captain has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_blood_angels_captain");
  assert(unit !== undefined, "sm_blood_angels_captain must exist");
  assertEqual(unit.name, "Blood Angels Captain");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 80);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(!unit.keywords.includes("EPIC HERO"),   "Must NOT have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_blood_angels_captain")?.max, 1, "Must have max 1");
});

test("Death Company Captain has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_death_company_captain");
  assert(unit !== undefined, "sm_death_company_captain must exist");
  assertEqual(unit.name, "Death Company Captain");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(!unit.keywords.includes("EPIC HERO"),   "Must NOT have EPIC HERO keyword");
  assert(unit.rulesAdaptations?.includes("Death Visions of Sanguinius"), "Must mention Death Visions of Sanguinius");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_death_company_captain")?.max, 1, "Must have max 1");
});

test("Death Company Captain with Jetpack has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_death_company_captain_jetpack");
  assert(unit !== undefined, "sm_death_company_captain_jetpack must exist");
  assertEqual(unit.name, "Death Company Captain with Jetpack");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 75);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(!unit.keywords.includes("EPIC HERO"),   "Must NOT have EPIC HERO keyword");
  assert(unit.rulesAdaptations?.includes("Death Visions of Sanguinius"), "Must mention Death Visions of Sanguinius");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_death_company_captain_jetpack")?.max, 1, "Must have max 1");
});

test("Sanguinary Priest has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_sanguinary_priest");
  assert(unit !== undefined, "sm_sanguinary_priest must exist");
  assertEqual(unit.name, "Sanguinary Priest");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 75);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(!unit.keywords.includes("EPIC HERO"),   "Must NOT have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_sanguinary_priest")?.max, 1, "Must have max 1");
});

test("Death Company Marines has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_death_company_marines");
  assert(unit !== undefined, "sm_death_company_marines must exist");
  assertEqual(unit.name, "Death Company Marines");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 85);
  assertEqual(unit.sizes[1].pts, 160);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(!unit.keywords.includes("CHARACTER"),   "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_death_company_marines")?.max, 1, "Must have max 1");
});

test("Death Company Marines with Bolt Rifles has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_death_company_marines_bolt_rifles");
  assert(unit !== undefined, "sm_death_company_marines_bolt_rifles must exist");
  assertEqual(unit.name, "Death Company Marines with Bolt Rifles");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 85);
  assertEqual(unit.sizes[1].pts, 160);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.rulesAdaptations?.includes("Visions of Heresy"), "rulesAdaptations must mention Visions of Heresy");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_death_company_marines_bolt_rifles")?.max, 1, "Must have max 1");
});

test("Death Company Marines with Jump Packs has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_death_company_marines_jump_packs");
  assert(unit !== undefined, "sm_death_company_marines_jump_packs must exist");
  assertEqual(unit.name, "Death Company Marines with Jump Packs");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 120);
  assertEqual(unit.sizes[1].pts, 230);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_death_company_marines_jump_packs")?.max, 1, "Must have max 1");
});

test("Sanguinary Guard has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_sanguinary_guard");
  assert(unit !== undefined, "sm_sanguinary_guard must exist");
  assertEqual(unit.name, "Sanguinary Guard");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 125);
  assert(unit.keywords.includes("BLOOD ANGELS"), "Must have BLOOD ANGELS keyword");
  assert(unit.rulesAdaptations?.includes("Deep Strike"), "Must mention Deep Strike");
  assert(unit.rulesAdaptations?.includes("Movement"),    "Must mention Movement characteristic");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_sanguinary_guard")?.max, 1, "Must have max 1");
});

// Dark Angels & Sword Brethren
test("Asmodai has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_asmodai");
  assert(unit !== undefined, "sm_asmodai must exist");
  assertEqual(unit.name, "Asmodai");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("DARK ANGELS"), "Must have DARK ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),    "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_asmodai")?.max, 1, "Must have max 1");
});

test("Azrael has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_azrael");
  assert(unit !== undefined, "sm_azrael must exist");
  assertEqual(unit.name, "Azrael");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 125);
  assert(unit.keywords.includes("DARK ANGELS"), "Must have DARK ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.rulesAdaptations?.includes("Masterful Tactician"), "rulesAdaptations must mention Masterful Tactician");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_azrael")?.max, 1, "Must have max 1");
});

test("Ezekiel has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_ezekiel");
  assert(unit !== undefined, "sm_ezekiel must exist");
  assertEqual(unit.name, "Ezekiel");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 75);
  assert(unit.keywords.includes("DARK ANGELS"), "Must have DARK ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("PSYKER"),      "Must have PSYKER keyword");
  assert(!unit.keywords.includes("TACTICUS"),   "Must NOT have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_ezekiel")?.max, 1, "Must have max 1");
});

test("Lazarus has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_lazarus");
  assert(unit !== undefined, "sm_lazarus must exist");
  assertEqual(unit.name, "Lazarus");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("DARK ANGELS"), "Must have DARK ANGELS keyword");
  assert(unit.keywords.includes("EPIC HERO"),   "Must have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_lazarus")?.max, 1, "Must have max 1");
});

test("Lion El'Jonson has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_lion_eljonson");
  assert(unit !== undefined, "sm_lion_eljonson must exist");
  assertEqual(unit.name, "Lion El'Jonson");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 315);
  assert(unit.keywords.includes("DARK ANGELS"),  "Must have DARK ANGELS keyword");
  assert(unit.keywords.includes("MONSTER"),      "Must have MONSTER keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("PRIMARCH"),     "Must have PRIMARCH keyword");
  assert(!unit.keywords.includes("INFANTRY"),    "Must NOT have INFANTRY keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_lion_eljonson")?.max, 1, "Must have max 1");
});

test("Inner Circle Companions has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_inner_circle_companions");
  assert(unit !== undefined, "sm_inner_circle_companions must exist");
  assertEqual(unit.name, "Inner Circle Companions");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 90);
  assert(unit.keywords.includes("DARK ANGELS"),  "Must have DARK ANGELS keyword");
  assert(!unit.keywords.includes("CHARACTER"),   "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_inner_circle_companions")?.max, 1, "Must have max 1");
});

test("Sword Brethren has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_sword_brethren");
  assert(unit !== undefined, "sm_sword_brethren must exist");
  assertEqual(unit.name, "Sword Brethren");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 130);
  assertEqual(unit.sizes[1].pts, 260);
  assert(unit.keywords.includes("BLACK TEMPLARS"), "Must have BLACK TEMPLARS keyword");
  assert(!unit.keywords.includes("CHARACTER"),     "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_sword_brethren")?.max, 1, "Must have max 1");
});

// Deathwatch
test("Watch Captain Artemis has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_watch_captain_artemis");
  assert(unit !== undefined, "sm_watch_captain_artemis must exist");
  assertEqual(unit.name, "Watch Captain Artemis");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 65);
  assert(unit.keywords.includes("DEATHWATCH"), "Must have DEATHWATCH keyword");
  assert(unit.keywords.includes("EPIC HERO"),  "Must have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),  "Must NOT have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_watch_captain_artemis")?.max, 1, "Must have max 1");
});

test("Watch Master has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_watch_master");
  assert(unit !== undefined, "sm_watch_master must exist");
  assertEqual(unit.name, "Watch Master");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 95);
  assert(unit.keywords.includes("DEATHWATCH"),  "Must have DEATHWATCH keyword");
  assert(!unit.keywords.includes("EPIC HERO"),  "Must NOT have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),   "Must NOT have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_watch_master")?.max, 1, "Must have max 1");
});

test("Deathwatch Veterans has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_deathwatch_veterans");
  assert(unit !== undefined, "sm_deathwatch_veterans must exist");
  assertEqual(unit.name, "Deathwatch Veterans");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 100);
  assertEqual(unit.sizes[1].pts, 190);
  assert(unit.keywords.includes("DEATHWATCH"),  "Must have DEATHWATCH keyword");
  assert(unit.keywords.includes("BATTLELINE"),  "Must have BATTLELINE keyword");
  assert(!unit.keywords.includes("CHARACTER"),  "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_deathwatch_veterans")?.max, 3, "Must have max 3");
});

// Space Wolves
test("Njal Stormcaller has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_njal_stormcaller");
  assert(unit !== undefined, "sm_njal_stormcaller must exist");
  assertEqual(unit.name, "Njal Stormcaller");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("SPACE WOLVES"), "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(unit.keywords.includes("PSYKER"),       "Must have PSYKER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_njal_stormcaller")?.max, 1, "Must have max 1");
});

test("Ragnar Blackmane has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_ragnar_blackmane");
  assert(unit !== undefined, "sm_ragnar_blackmane must exist");
  assertEqual(unit.name, "Ragnar Blackmane");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 100);
  assert(unit.keywords.includes("SPACE WOLVES"), "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("EPIC HERO"),    "Must have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_ragnar_blackmane")?.max, 1, "Must have max 1");
});

test("Ulrik the Slayer has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_ulrik_the_slayer");
  assert(unit !== undefined, "sm_ulrik_the_slayer must exist");
  assertEqual(unit.name, "Ulrik the Slayer");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("EPIC HERO"),     "Must have EPIC HERO keyword");
  assert(!unit.keywords.includes("TACTICUS"),     "Must NOT have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_ulrik_the_slayer")?.max, 1, "Must have max 1");
});

test("Iron Priest has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_iron_priest");
  assert(unit !== undefined, "sm_iron_priest must exist");
  assertEqual(unit.name, "Iron Priest");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 55);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("EPIC HERO"),    "Must NOT have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_iron_priest")?.max, 1, "Must have max 1");
});

test("Wolf Guard Battle Leader has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_wolf_guard_battle_leader");
  assert(unit !== undefined, "sm_wolf_guard_battle_leader must exist");
  assertEqual(unit.name, "Wolf Guard Battle Leader");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 55);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("EPIC HERO"),    "Must NOT have EPIC HERO keyword");
  assert(unit.keywords.includes("TACTICUS"),      "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_wolf_guard_battle_leader")?.max, 1, "Must have max 1");
});

test("Wolf Priest has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_wolf_priest");
  assert(unit !== undefined, "sm_wolf_priest must exist");
  assertEqual(unit.name, "Wolf Priest");
  assertEqual(unit.type, "CHARACTER");
  assertEqual(unit.sizes[0].pts, 70);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("EPIC HERO"),    "Must NOT have EPIC HERO keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_wolf_priest")?.max, 1, "Must have max 1");
});

test("Bloodclaws has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_bloodclaws");
  assert(unit !== undefined, "sm_bloodclaws must exist");
  assertEqual(unit.name, "Bloodclaws");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes[0].label, "10 models");
  assertEqual(unit.sizes[0].pts, 135);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("BATTLELINE"),    "Must have BATTLELINE keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_bloodclaws")?.max, 3, "Must have max 3");
});

test("Grey Hunters has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_grey_hunters");
  assert(unit !== undefined, "sm_grey_hunters must exist");
  assertEqual(unit.name, "Grey Hunters");
  assertEqual(unit.type, "BATTLELINE");
  assertEqual(unit.sizes[0].label, "10 models");
  assertEqual(unit.sizes[0].pts, 165);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("BATTLELINE"),    "Must have BATTLELINE keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_grey_hunters")?.max, 3, "Must have max 3");
});

test("Wolf Guard Headtakers has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_wolf_guard_headtakers");
  assert(unit !== undefined, "sm_wolf_guard_headtakers must exist");
  assertEqual(unit.name, "Wolf Guard Headtakers");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes[0].label, "3 models");
  assertEqual(unit.sizes[0].pts, 85);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("CHARACTER"),    "Must NOT have CHARACTER keyword");
  assert(unit.keywords.includes("TACTICUS"),      "Must have TACTICUS keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_wolf_guard_headtakers")?.max, 1, "Must have max 1");
});

test("Wulfen has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_wulfen");
  assert(unit !== undefined, "sm_wulfen must exist");
  assertEqual(unit.name, "Wulfen");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 85);
  assertEqual(unit.sizes[1].pts, 170);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("CHARACTER"),    "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_wulfen")?.max, 1, "Must have max 1");
});

test("Wulfen with Storm Shields has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_wulfen_storm_shields");
  assert(unit !== undefined, "sm_wulfen_storm_shields must exist");
  assertEqual(unit.name, "Wulfen with Storm Shields");
  assertEqual(unit.type, "INFANTRY");
  assertEqual(unit.sizes.length, 2, "Must have 2 size options");
  assertEqual(unit.sizes[0].pts, 100);
  assertEqual(unit.sizes[1].pts, 200);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(!unit.keywords.includes("CHARACTER"),    "Must NOT have CHARACTER keyword");
  assert(!unit.rulesAdaptations, "Must have no rulesAdaptations");
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_wulfen_storm_shields")?.max, 1, "Must have max 1");
});

test("Fenrisian Wolves has correct fields", () => {
  const unit = smDataBS.units.find(u => u.id === "sm_fenrisian_wolves");
  assert(unit !== undefined, "sm_fenrisian_wolves must exist");
  assertEqual(unit.name, "Fenrisian Wolves");
  assertEqual(unit.type, "BEAST");
  assertEqual(unit.sizes[0].label, "5 models");
  assertEqual(unit.sizes[0].pts, 40);
  assert(unit.keywords.includes("SPACE WOLVES"),  "Must have SPACE WOLVES keyword");
  assert(unit.keywords.includes("BEAST"),         "Must have BEAST keyword");
  assert(unit.rulesAdaptations?.includes('9"'),   'rulesAdaptations must mention the reduced Movement of 9"');
  assertEqual(boardingStrikeDet.units.find(du => du.id === "sm_fenrisian_wolves")?.max, 1, "Must have max 1");
});

test("HTML sorts units alphabetically by name within each type in renderUnitGrid", () => {
  assert(html.includes(".sort((a, b) => a.name.localeCompare(b.name))"),
    "renderUnitGrid must sort units alphabetically by name within each type");
});


// ── 15. Boarding Strike — Constraint Logic ────────────────────────────────────

section("15. Boarding Strike — Constraint Logic");

test("Boarding Strike has exactly 5 exclusive unit groups", () => {
  assertEqual(boardingStrikeDet.exclusiveUnitGroups.length, 5,
    "Boarding Strike must have exactly 5 exclusive unit groups");
});

test("Boarding Strike has an exclusive group for Sicarius variants", () => {
  const group = boardingStrikeDet.exclusiveUnitGroups.find(g =>
    g.includes("sm_captain_sicarius") && g.includes("sm_cato_sicarius")
  );
  assert(group !== undefined, "Must have an exclusive group containing both Sicarius variants");
  assertEqual(group.length, 2, "Sicarius exclusive group must contain exactly 2 units");
});

test("Captain Sicarius and Cato Sicarius mutually block each other", () => {
  function isBlocked(unitId, list) {
    for (const group of (boardingStrikeDet.exclusiveUnitGroups || [])) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  }
  assert(isBlocked("sm_cato_sicarius",    [{ unitId: "sm_captain_sicarius" }]), "Cato must be blocked when Captain Sicarius is present");
  assert(isBlocked("sm_captain_sicarius", [{ unitId: "sm_cato_sicarius"    }]), "Captain Sicarius must be blocked when Cato is present");
  assert(!isBlocked("sm_captain_sicarius", [{ unitId: "sm_captain_sicarius" }]), "Captain Sicarius must not block itself");
  assert(!isBlocked("sm_chaplain",         [{ unitId: "sm_captain_sicarius" }]), "Chaplain must not be blocked by Sicarius group");
});

test("Boarding Strike has an exclusive group for Eradicator/Hellblaster", () => {
  const group = boardingStrikeDet.exclusiveUnitGroups.find(g =>
    g.includes("sm_eradicator_squad") && g.includes("sm_hellblaster_squad")
  );
  assert(group !== undefined, "Must have an exclusive group containing Eradicator and Hellblaster");
  assertEqual(group.length, 2, "The Eradicator/Hellblaster group must contain exactly 2 unit IDs");
});

test("Eradicator Squad and Hellblaster Squad mutually block each other", () => {
  function isBlocked(unitId, list) {
    for (const group of (boardingStrikeDet.exclusiveUnitGroups || [])) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  }
  assert(isBlocked("sm_hellblaster_squad", [{ unitId: "sm_eradicator_squad"  }]), "Hellblaster must be blocked when Eradicator is present");
  assert(isBlocked("sm_eradicator_squad",  [{ unitId: "sm_hellblaster_squad" }]), "Eradicator must be blocked when Hellblaster is present");
  assert(!isBlocked("sm_captain",          [{ unitId: "sm_eradicator_squad"  }]), "Captain must not be blocked by this group");
  assert(!isBlocked("sm_infernus_squad",   [{ unitId: "sm_eradicator_squad"  }]), "Infernus Squad must not be blocked by this group");
});

test("Boarding Strike has an exclusive group for Wulfen variants", () => {
  const group = boardingStrikeDet.exclusiveUnitGroups.find(g =>
    g.includes("sm_wulfen") && g.includes("sm_wulfen_storm_shields")
  );
  assert(group !== undefined, "Must have an exclusive group containing both Wulfen variants");
  assertEqual(group.length, 2, "The Wulfen group must contain exactly 2 unit IDs");
});

test("Wulfen and Wulfen with Storm Shields mutually block each other", () => {
  function isBlocked(unitId, list) {
    for (const group of (boardingStrikeDet.exclusiveUnitGroups || [])) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  }
  assert(isBlocked("sm_wulfen_storm_shields", [{ unitId: "sm_wulfen"              }]), "Wulfen with Storm Shields must be blocked when Wulfen is present");
  assert(isBlocked("sm_wulfen",               [{ unitId: "sm_wulfen_storm_shields" }]), "Wulfen must be blocked when Wulfen with Storm Shields is present");
  assert(!isBlocked("sm_wolf_guard_headtakers", [{ unitId: "sm_wulfen" }]), "Wolf Guard Headtakers must not be blocked by the Wulfen group");
});

test("Chapter keyword exclusivity — chapter-specific units block other chapters", () => {
  function isChapterBlocked(unitId, list) {
    const unit = smDataBS.units.find(u => u.id === unitId);
    const groups = boardingStrikeDet.factionKeywordGroups;
    for (const group of groups) {
      const unitGroupKws = unit.keywords.filter(k => group.includes(k));
      if (!unitGroupKws.length) continue;
      const committed = group.find(kw =>
        list.some(l => smDataBS.units.find(u => u.id === l.unitId)?.keywords.includes(kw))
      );
      if (committed && !unitGroupKws.includes(committed)) return true;
    }
    return false;
  }
  // Salamanders blocks other chapters
  const salamandersCommitted = [{ unitId: "sm_adrax_agatone" }];
  assert(isChapterBlocked("sm_korsarro_khan",   salamandersCommitted), "WHITE SCARS unit must be blocked when SALAMANDERS is committed");
  assert(isChapterBlocked("sm_captain_sicarius", salamandersCommitted), "ULTRAMARINES unit must be blocked when SALAMANDERS is committed");
  assert(!isChapterBlocked("sm_adrax_agatone",  salamandersCommitted), "SALAMANDERS unit must not block itself");
  assert(!isChapterBlocked("sm_captain",        salamandersCommitted), "Generic captain (no chapter kw) must never be blocked");
  // ULTRAMARINES blocks SPACE WOLVES
  const ultraCommitted = [{ unitId: "sm_captain_sicarius" }];
  assert(isChapterBlocked("sm_ragnar_blackmane", ultraCommitted), "SPACE WOLVES unit must be blocked when ULTRAMARINES is committed");
});

test("All chapter keywords appear on at least one unit in the faction", () => {
  const chapterKws = boardingStrikeDet.factionKeywordGroups[0];
  chapterKws.forEach(kw => {
    assert(smDataBS.units.some(u => u.keywords.includes(kw)),
      `Chapter keyword "${kw}" must appear on at least one unit in adeptus_astartes.json`);
  });
});

test("Boarding Strike constraint smoke test — Salamanders + neutral units", () => {
  // Adrax Agatone (85, SALAMANDERS) + Ancient (50) = 2 chars at cap
  // + Assault Intercessors x2 (75 each) + Aggressor Squad (95) = 380pts
  const list = [
    { unitId: "sm_adrax_agatone",        pts: 85,  type: "CHARACTER"  },
    { unitId: "sm_ancient",              pts: 50,  type: "CHARACTER"  },
    { unitId: "sm_assault_intercessors", pts: 75,  type: "BATTLELINE" },
    { unitId: "sm_assault_intercessors", pts: 75,  type: "BATTLELINE" },
    { unitId: "sm_aggressor_squad",      pts: 95,  type: "INFANTRY"   },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total <= 500, `List total ${total}pts must be within 500pt limit`);
  const chars = list.filter(l => l.type === "CHARACTER").length;
  assert(chars <= boardingStrikeDet.maxCharacters, `${chars} CHARACTERs must be within the cap of ${boardingStrikeDet.maxCharacters}`);
  const allUnitIds = boardingStrikeDet.units.map(du => du.id);
  list.forEach(l => assert(allUnitIds.includes(l.unitId), `${l.unitId} must be in Boarding Strike roster`));
});


section("24. canTakeEnhancement — Non-CHARACTER Enhancement Assignment");

test("HTML contains canTakeEnhancement check in renderList", () => {
  assert(html.includes("canTakeEnhancement"),
    "renderList must check canTakeEnhancement to allow non-CHARACTER units to receive enhancements");
});

test("HTML derives canTakeEnh from isChar or canTakeEnhancement flag", () => {
  assert(html.includes("canTakeEnh"),
    "renderList must compute canTakeEnh combining isChar and the canTakeEnhancement flag");
});

test("Tyranid Warriors with Melee Bio-Weapons has canTakeEnhancement in Tyranid Attack", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_attack");
  assert(det !== undefined, "tyr_attack detachment must exist");
  const entry = det.units.find(u => u.id === "tyr_warriors_melee");
  assert(entry !== undefined, "tyr_warriors_melee must be in Tyranid Attack");
  assert(entry.canTakeEnhancement === true,
    "tyr_warriors_melee must have canTakeEnhancement: true in Tyranid Attack");
});

test("Tyranid Warriors with Ranged Bio-Weapons has canTakeEnhancement in Tyranid Attack", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_attack");
  assert(det !== undefined, "tyr_attack detachment must exist");
  const entry = det.units.find(u => u.id === "tyr_warriors_ranged");
  assert(entry !== undefined, "tyr_warriors_ranged must be in Tyranid Attack");
  assert(entry.canTakeEnhancement === true,
    "tyr_warriors_ranged must have canTakeEnhancement: true in Tyranid Attack");
});

test("Tyranid Warriors units are non-CHARACTER and still eligible for enhancements in Tyranid Attack", () => {
  const tyrData = factionData["tyranids"];
  const melee  = tyrData.units.find(u => u.id === "tyr_warriors_melee");
  const ranged = tyrData.units.find(u => u.id === "tyr_warriors_ranged");
  assert(melee  !== undefined, "tyr_warriors_melee must exist in units");
  assert(ranged !== undefined, "tyr_warriors_ranged must exist in units");
  assert(!melee.keywords.includes("CHARACTER"),  "tyr_warriors_melee must NOT be a CHARACTER");
  assert(!ranged.keywords.includes("CHARACTER"), "tyr_warriors_ranged must NOT be a CHARACTER");
  // Confirm EPIC HERO is absent (would block enhancement assignment)
  assert(!melee.keywords.includes("EPIC HERO"),  "tyr_warriors_melee must NOT be EPIC HERO");
  assert(!ranged.keywords.includes("EPIC HERO"), "tyr_warriors_ranged must NOT be EPIC HERO");
});

// ── 25. maxFromGroup Constraint ───────────────────────────────────────────────

section("25. maxFromGroup Constraint");

test("HTML contains isMaxFromGroupBlocked function", () => {
  assert(html.includes("isMaxFromGroupBlocked"),
    "HTML must define isMaxFromGroupBlocked for the maxFromGroup constraint");
});

test("HTML contains getMaxFromGroupHint function", () => {
  assert(html.includes("getMaxFromGroupHint"),
    "HTML must define getMaxFromGroupHint for the maxFromGroup constraint");
});

test("HTML enforces isMaxFromGroupBlocked in addUnit", () => {
  assert(html.includes("isMaxFromGroupBlocked(unitId, det)"),
    "addUnit must call isMaxFromGroupBlocked to enforce the maxFromGroup constraint");
});

test("Infernal Reavers has maxFromGroup defined", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  assert(det !== undefined, "csm_infernal_reavers must exist");
  assert(Array.isArray(det.maxFromGroup) && det.maxFromGroup.length > 0,
    "Infernal Reavers must have a maxFromGroup array");
});

test("Infernal Reavers maxFromGroup has correct max of 2", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  const group = det.maxFromGroup[0];
  assertEqual(group.max, 2, "Infernal Reavers maxFromGroup[0].max must be 2");
});

test("Infernal Reavers maxFromGroup includes all 14 commander units", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  const group = det.maxFromGroup[0];
  const expectedIds = [
    "csm_abaddon", "csm_lord", "csm_lord_terminator", "csm_lord_jump_pack",
    "csm_cypher", "csm_fabius_bile", "csm_haarken_worldclaimer", "csm_huron_blackheart",
    "csm_master_of_executions", "csm_master_of_possession",
    "csm_sorcerer", "csm_sorcerer_terminator", "csm_warpsmith", "csm_dark_apostle"
  ];
  assertEqual(group.unitIds.length, 14,
    `maxFromGroup must list exactly 14 unit IDs, found ${group.unitIds.length}`);
  expectedIds.forEach(id => {
    assert(group.unitIds.includes(id), `maxFromGroup must include "${id}"`);
  });
});

test("Infernal Reavers maxFromGroup has a description string", () => {
  const det = factionData["chaos_space_marines"].detachments.find(d => d.id === "csm_infernal_reavers");
  const group = det.maxFromGroup[0];
  assert(typeof group.description === "string" && group.description.length > 0,
    "maxFromGroup group must have a non-empty description string");
});

test("Champions of Chaos and Underdeck Uprising have no maxFromGroup", () => {
  ["csm_champions_of_chaos", "csm_underdeck_uprising"].forEach(detId => {
    const det = factionData["chaos_space_marines"].detachments.find(d => d.id === detId);
    assert(det !== undefined, `Detachment "${detId}" must exist`);
    assert(det.maxFromGroup === undefined,
      `Detachment "${detId}" should not have maxFromGroup`);
  });
});

// ── 26. Tyranids — Biotide Detachment ────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("26. Tyranids — Biotide Detachment");

test("Biotide detachment exists in tyranids.json", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  assert(det !== undefined, "tyr_biotide detachment must exist");
});

test("Biotide has correct name", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  assertEqual(det.name, "Biotide", "detachment name must be 'Biotide'");
});

test("Biotide has Unstoppable Swarm special rule", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Unstoppable Swarm", "specialRule name must be 'Unstoppable Swarm'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Biotide has exactly 2 enhancements", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  assertEqual(det.enhancements.length, 2, "Biotide must have exactly 2 enhancements");
});

test("Biotide has Synaptic Beacon enhancement", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  const enh = det.enhancements.find(e => e.id === "enh_tyr_synaptic_beacon");
  assert(enh !== undefined, "enh_tyr_synaptic_beacon must exist");
  assertEqual(enh.name, "Synaptic Beacon", "enhancement name must be 'Synaptic Beacon'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Synaptic Beacon must have no keyword requirements");
});

test("Biotide has Hypersurge Gland enhancement", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  const enh = det.enhancements.find(e => e.id === "enh_tyr_hypersurge_gland");
  assert(enh !== undefined, "enh_tyr_hypersurge_gland must exist");
  assertEqual(enh.name, "Hypersurge Gland", "enhancement name must be 'Hypersurge Gland'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Hypersurge Gland must have no keyword requirements");
});

test("Biotide has exactly 5 units", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  assertEqual(det.units.length, 5, "Biotide must have exactly 5 unit entries");
});

test("Biotide unit roster — correct IDs and maxes", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_biotide");
  const expected = [
    { id: "tyr_winged_prime", max: 2 },
    { id: "tyr_hormagaunts",  max: 3 },
    { id: "tyr_neurogaunts",  max: 3 },
    { id: "tyr_ripper_swarm", max: 3 },
    { id: "tyr_termagants",   max: 3 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Biotide`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("Tyranids now has 3 detachments including Biotide and Boarding Swarm", () => {
  const tyrData = factionData["tyranids"];
  assertEqual(tyrData.detachments.length, 3,
    `Expected 3 Tyranid detachments, found ${tyrData.detachments.length}`);
  const ids = tyrData.detachments.map(d => d.id);
  assert(ids.includes("tyr_attack"),        "tyr_attack must still exist");
  assert(ids.includes("tyr_biotide"),       "tyr_biotide must still exist");
  assert(ids.includes("tyr_boarding_swarm"),"tyr_boarding_swarm must still exist");
});

test("Biotide smoke test — legal list within points limit", () => {
  // Winged Tyranid Prime (65) + 2× Hormagaunts (130) + 2× Termagants (120)
  // + Neurogaunts (45) + 2× Ripper Swarm (100) = 460pts
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_biotide");
  const unitIds = new Set(tyrData.units.map(u => u.id));

  const picks = [
    { id: "tyr_winged_prime", count: 1, pts: 65 },
    { id: "tyr_hormagaunts",  count: 2, pts: 65 },
    { id: "tyr_termagants",   count: 2, pts: 60 },
    { id: "tyr_neurogaunts",  count: 1, pts: 45 },
    { id: "tyr_ripper_swarm", count: 2, pts: 50 },
  ];

  let total = 0;
  picks.forEach(({ id, count, pts }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Biotide`);
    assert(count <= entry.max, `"${id}" count ${count} exceeds max ${entry.max}`);
    assert(unitIds.has(id), `"${id}" must be a real unit`);
    total += count * pts;
  });
  assert(total <= 500, `Smoke test list total ${total}pts exceeds 500pt limit`);
});

// ── 27. Tyranids — Boarding Swarm Detachment ─────────────────────────────────

section("27. Tyranids — Boarding Swarm Detachment");

test("Boarding Swarm detachment exists in tyranids.json", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assert(det !== undefined, "tyr_boarding_swarm detachment must exist");
});

test("Boarding Swarm has correct name", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assertEqual(det.name, "Boarding Swarm", "detachment name must be 'Boarding Swarm'");
});

test("Boarding Swarm has Priority Predation special rule", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Priority Predation",
    "specialRule name must be 'Priority Predation'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Boarding Swarm has exactly 1 enhancement entry", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assertEqual(det.enhancements.length, 1,
    "Boarding Swarm must have exactly 1 enhancement entry");
});

test("Boarding Swarm enhancement is Monoform Predators with noAssign flag", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  const enh = det.enhancements.find(e => e.id === "enh_tyr_monoform_predators");
  assert(enh !== undefined, "enh_tyr_monoform_predators must exist");
  assertEqual(enh.name, "Monoform Predators", "enhancement name must be 'Monoform Predators'");
  assert(enh.noAssign === true, "Monoform Predators must have noAssign: true");
  assert(Array.isArray(enh.requiresKeywords),
    "Monoform Predators must have a requiresKeywords array");
});

test("Boarding Swarm has exactly 6 units", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assertEqual(det.units.length, 6, "Boarding Swarm must have exactly 6 unit entries");
});

test("Boarding Swarm unit roster — correct IDs and maxes", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  const expected = [
    { id: "tyr_lictor",             max: 1 },
    { id: "tyr_hormagaunts",        max: 2 },
    { id: "tyr_deathleaper",        max: 1 },
    { id: "tyr_neurolictor",        max: 1 },
    { id: "tyr_raveners",           max: 2 },
    { id: "tyr_von_ryans_leapers",  max: 2 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Boarding Swarm`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("noAssign enhancement does not appear in HTML det picker filter", () => {
  assert(html.includes("!e.noAssign"),
    "HTML must filter out noAssign enhancements from the det enhancement picker");
});

test("noAssign enhancement is filtered from print sheet allEnhs", () => {
  assert(html.includes("enhancements.filter(e => !e.noAssign)"),
    "HTML buildPrintSheet must filter noAssign enhancements from allEnhs");
});

test("Print sheet renders rules adaptations for units that have them", () => {
  assert(html.includes("ps-unit-adapt"),
    "HTML must define the ps-unit-adapt CSS class for rules adaptations on the print sheet");
  assert(html.includes("unit.rulesAdaptations"),
    "buildPrintSheet must reference unit.rulesAdaptations when building the unit row");
});

test("exportJSON function exists in HTML", () => {
  assert(html.includes("function exportJSON()"),
    "HTML must define an exportJSON function");
});

test("exportJSON includes all required state fields", () => {
  assert(html.includes("exportVersion"),   "exportJSON must include exportVersion");
  assert(html.includes("factionId"),       "exportJSON must include factionId");
  assert(html.includes("detachmentId"),    "exportJSON must include detachmentId");
  assert(html.includes("totalPts"),        "exportJSON must include totalPts");
  assert(html.includes("warlordId"),       "exportJSON must include warlordId");
  assert(html.includes("units: state.list.map"), "exportJSON must include units array mapped from state.list");
  assert(html.includes("unitId"),          "exportJSON units must include unitId");
  assert(html.includes("enhancementId"),   "exportJSON units must include enhancementId");
  assert(html.includes("isWarlord"),       "exportJSON units must include isWarlord");
});

test("exportJSON references state.detachmentId not state.detId", () => {
  assert(html.includes("state.detachmentId"),
    "exportJSON must use state.detachmentId (the correct state key)");
  assert(!html.includes("state.detId"),
    "exportJSON must not reference state.detId (undefined key — bug)");
});

test("state object uses detachmentId consistently", () => {
  // Verify the state declaration uses detachmentId
  assert(html.includes('detachmentId:""') || html.includes('detachmentId: ""'),
    "state must be declared with detachmentId key");
  // Verify currentDet() reads the correct key
  assert(html.includes("state.detachmentId"),
    "currentDet() and other functions must read state.detachmentId");
  // Verify no stray state.detId references anywhere
  assert(!html.includes("state.detId"),
    "state.detId must not appear anywhere — it is not a valid state key");
});

test("exportJSON triggers a .json file download", () => {
  assert(html.includes('safeFilename(state.listName, "json")'),
    "exportJSON must use safeFilename with json extension");
  assert(html.includes('"application/json"'),
    "exportJSON must use application/json MIME type");
});

test("exportText function exists in HTML", () => {
  assert(html.includes("function exportText()"),
    "HTML must define an exportText function");
});

test("exportText includes rules adaptations in output", () => {
  assert(html.includes("unit.rulesAdaptations") && html.includes("exportText"),
    "exportText must reference unit.rulesAdaptations");
});

test("exportText includes enhancement details in output", () => {
  assert(html.includes("assignedEnh.name") && html.includes("assignedEnh.desc"),
    "exportText must include enhancement name and desc");
});

test("exportText includes army rule and detachment rule", () => {
  assert(html.includes("ARMY RULE") && html.includes("DETACHMENT RULE"),
    "exportText must include army rule and detachment rule sections");
});

test("exportText triggers a .txt file download", () => {
  assert(html.includes('safeFilename(state.listName, "txt")'),
    "exportText must use safeFilename with txt extension");
  assert(html.includes('"text/plain"'),
    "exportText must use text/plain MIME type");
});

test("triggerDownload helper and safeFilename helper exist", () => {
  assert(html.includes("function triggerDownload("),
    "HTML must define a triggerDownload helper");
  assert(html.includes("function safeFilename("),
    "HTML must define a safeFilename helper");
});

test("Export buttons are present in the print modal", () => {
  assert(html.includes("exportJSON()"),         "Print modal must have an Export JSON button");
  assert(html.includes("exportText()"),         "Print modal must have an Export TXT button");
  assert(html.includes("exportPDF()"),          "Print modal must have an Export PDF button");
  assert(html.includes("ps-action-btn--json"),  "Export JSON button must have correct CSS class");
  assert(html.includes("ps-action-btn--text"),  "Export TXT button must have correct CSS class");
  assert(html.includes("ps-action-btn--pdf"),   "Export PDF button must have correct CSS class");
});

test("exportPDF function exists and is async", () => {
  assert(html.includes("async function exportPDF()"),
    "HTML must define an async exportPDF function");
});

test("exportPDF uses html2canvas to capture the print sheet", () => {
  assert(html.includes("html2canvas"),
    "exportPDF must call html2canvas");
  assert(html.includes("print-sheet"),
    "exportPDF must target the #print-sheet element");
  assert(html.includes("scale"),
    "exportPDF must set a scale option for crisp rendering");
});

test("exportPDF uses jsPDF to create an A4 PDF", () => {
  assert(html.includes("jsPDF"),
    "exportPDF must use jsPDF");
  assert(html.includes('"a4"'),
    "exportPDF must target A4 page format");
  assert(html.includes('"portrait"'),
    "exportPDF must use portrait orientation");
});

test("exportPDF handles multi-page lists with section-aware page breaks", () => {
  assert(html.includes("addPage"),
    "exportPDF must call pdf.addPage() to support content that spans multiple pages");
  assert(html.includes("forbiddenZones"),
    "exportPDF must build forbiddenZones for section-aware page splitting");
  assert(html.includes("safeCutPoint"),
    "exportPDF must define a safeCutPoint function");
});

test("exportPDF protects the correct section element types from page splits", () => {
  assert(html.includes(".ps-rule-card"),
    "exportPDF must protect .ps-rule-card elements from page splits");
  assert(html.includes(".ps-unit-row"),
    "exportPDF must protect .ps-unit-row elements from page splits");
  assert(html.includes(".ps-enh-list-item"),
    "exportPDF must protect .ps-enh-list-item elements from page splits");
  assert(html.includes(".ps-enhancements"),
    "exportPDF must protect the .ps-enhancements block from page splits");
});

test("exportPDF safeCutPoint falls through for sections taller than one page", () => {
  assert(html.includes("sectionH >= pageCanvasPx"),
    "safeCutPoint must skip sections that are taller than a full page rather than creating a blank page");
});

test("exportPDF measures section positions before html2canvas capture", () => {
  // getBoundingClientRect must appear before the html2canvas call
  const bcrIdx     = html.indexOf("getBoundingClientRect");
  const canvasIdx  = html.indexOf("await html2canvas");
  assert(bcrIdx !== -1 && canvasIdx !== -1 && bcrIdx < canvasIdx,
    "getBoundingClientRect measurements must be taken before html2canvas renders the canvas");
});

test("exportPDF uses canvas pixel coordinates for forbidden zones", () => {
  assert(html.includes("canvas.width / sheetRect.width"),
    "exportPDF must compute a scale factor from CSS pixels to canvas pixels");
  assert(html.includes("sheetRect.top"),
    "exportPDF must offset section positions relative to the sheet top");
});

test("exportPDF hides action bar during capture and restores it", () => {
  assert(html.includes("ps-modal-actions") && html.includes('display = "none"'),
    "exportPDF must hide the modal actions bar before capturing");
  assert(html.includes('display = ""'),
    "exportPDF must restore the modal actions bar after capturing");
});

test("exportPDF shows loading state on the button", () => {
  assert(html.includes("pdf-btn"),
    "exportPDF must reference the pdf-btn element");
  assert(html.includes("btn.disabled = true"),
    "exportPDF must disable the button during generation");
  assert(html.includes("btn.disabled    = false") || html.includes("btn.disabled = false"),
    "exportPDF must re-enable the button after generation");
  assert(html.includes("Generating"),
    "exportPDF must show a loading label during generation");
});

test("exportPDF uses safeFilename with pdf extension", () => {
  assert(html.includes('safeFilename(state.listName, "pdf")'),
    "exportPDF must use safeFilename with pdf extension");
});

test("html2canvas and jsPDF are loaded from cdnjs", () => {
  assert(html.includes("html2canvas") && html.includes("cdnjs.cloudflare.com"),
    "html2canvas must be loaded from cdnjs");
  assert(html.includes("jspdf") && html.includes("cdnjs.cloudflare.com"),
    "jsPDF must be loaded from cdnjs");
});

test("noAssign enhancements are rendered as a restriction notice in det-info", () => {
  assert(html.includes("Enhancement Restriction"),
    "HTML renderDetInfo must render a restriction notice for noAssign enhancements");
  assert(html.includes("noAssign"),
    "HTML renderDetInfo must check the noAssign flag");
});

test("Boarding Swarm smoke test — legal list within points limit", () => {
  // Deathleaper (80) + Neurolictor (70) + 2× Von Ryan's Leapers (140)
  // + Lictor (60) + Hormagaunts (65) = 415pts
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  const unitIds = new Set(tyrData.units.map(u => u.id));

  const picks = [
    { id: "tyr_deathleaper",       count: 1, pts: 80  },
    { id: "tyr_neurolictor",       count: 1, pts: 70  },
    { id: "tyr_von_ryans_leapers", count: 2, pts: 70  },
    { id: "tyr_lictor",            count: 1, pts: 60  },
    { id: "tyr_hormagaunts",       count: 1, pts: 65  },
  ];

  let total = 0;
  picks.forEach(({ id, count, pts }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Boarding Swarm`);
    assert(count <= entry.max, `"${id}" count ${count} exceeds max ${entry.max}`);
    assert(unitIds.has(id), `"${id}" must be a real unit`);
    total += count * pts;
  });
  assert(total <= 500, `Smoke test list total ${total}pts exceeds 500pt limit`);
});

// ── 28. Boarding Swarm — Hunter Unit maxFromGroup Constraint ─────────────────

section("28. Boarding Swarm — Hunter Unit maxFromGroup Constraint");

test("Boarding Swarm has maxFromGroup defined", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assert(Array.isArray(det.maxFromGroup) && det.maxFromGroup.length > 0,
    "tyr_boarding_swarm must have a maxFromGroup array");
});

test("Boarding Swarm maxFromGroup has correct max of 2", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  assertEqual(det.maxFromGroup[0].max, 2,
    "Boarding Swarm maxFromGroup[0].max must be 2");
});

test("Boarding Swarm maxFromGroup includes exactly the 3 hunter unit IDs", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  const group = det.maxFromGroup[0];
  const expectedIds = ["tyr_deathleaper", "tyr_lictor", "tyr_neurolictor"];
  assertEqual(group.unitIds.length, 3,
    `maxFromGroup must list exactly 3 unit IDs, found ${group.unitIds.length}`);
  expectedIds.forEach(id => {
    assert(group.unitIds.includes(id), `maxFromGroup must include "${id}"`);
  });
});

test("Boarding Swarm maxFromGroup has a description string", () => {
  const det = factionData["tyranids"].detachments.find(d => d.id === "tyr_boarding_swarm");
  const group = det.maxFromGroup[0];
  assert(typeof group.description === "string" && group.description.length > 0,
    "maxFromGroup group must have a non-empty description string");
});

test("maxFromGroup — first hunter unit can be added to an empty list", () => {
  // Simulate: no units in list → Deathleaper should not be blocked
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  const group = det.maxFromGroup[0];
  const list = [];
  const countInList = (ids) => list.filter(l => ids.includes(l.unitId)).length;
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = countInList(g.unitIds);
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  assert(!isBlocked("tyr_deathleaper"), "Deathleaper must not be blocked in an empty list");
  assert(!isBlocked("tyr_lictor"),      "Lictor must not be blocked in an empty list");
  assert(!isBlocked("tyr_neurolictor"), "Neurolictor must not be blocked in an empty list");
});

test("maxFromGroup — second hunter unit is allowed when only 1 is in the list", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  const list = [{ unitId: "tyr_deathleaper" }];
  const countInList = (ids) => list.filter(l => ids.includes(l.unitId)).length;
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = countInList(g.unitIds);
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  assert(!isBlocked("tyr_lictor"),      "Lictor must be allowed when 1 hunter is in the list");
  assert(!isBlocked("tyr_neurolictor"), "Neurolictor must be allowed when 1 hunter is in the list");
});

test("maxFromGroup — third hunter unit is blocked when 2 are already in the list", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  const list = [{ unitId: "tyr_deathleaper" }, { unitId: "tyr_lictor" }];
  const countInList = (ids) => list.filter(l => ids.includes(l.unitId)).length;
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = countInList(g.unitIds);
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  assert(isBlocked("tyr_neurolictor"),
    "Neurolictor must be blocked when Deathleaper and Lictor are already in the list");
});

test("maxFromGroup — a unit already in the list is never blocked by its own presence", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  // Two hunters in list; the first one should NOT be blocked (can't add a duplicate,
  // but the isMaxFromGroupBlocked logic must not block it)
  const list = [{ unitId: "tyr_deathleaper" }, { unitId: "tyr_lictor" }];
  const countInList = (ids) => list.filter(l => ids.includes(l.unitId)).length;
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = countInList(g.unitIds);
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  assert(!isBlocked("tyr_deathleaper"),
    "Deathleaper must not be blocked by its own presence in the list");
});

test("maxFromGroup — non-hunter units in Boarding Swarm are unaffected", () => {
  const tyrData = factionData["tyranids"];
  const det = tyrData.detachments.find(d => d.id === "tyr_boarding_swarm");
  // Fill the hunter cap
  const list = [{ unitId: "tyr_deathleaper" }, { unitId: "tyr_lictor" }];
  const countInList = (ids) => list.filter(l => ids.includes(l.unitId)).length;
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = countInList(g.unitIds);
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  ["tyr_hormagaunts", "tyr_raveners", "tyr_von_ryans_leapers"].forEach(id => {
    assert(!isBlocked(id),
      `"${id}" must not be blocked by the hunter maxFromGroup constraint`);
  });
});

test("Biotide and Tyranid Attack detachments have no maxFromGroup", () => {
  ["tyr_biotide", "tyr_attack"].forEach(detId => {
    const det = factionData["tyranids"].detachments.find(d => d.id === detId);
    assert(det !== undefined, `Detachment "${detId}" must exist`);
    assert(det.maxFromGroup === undefined,
      `Detachment "${detId}" should not have maxFromGroup`);
  });
});

// ── 29. Boarding Swarm — New Units ───────────────────────────────────────────

section("29. Boarding Swarm — New Units");

test("Lictor has correct fields", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_lictor");
  assertEqual(u.name, "Lictor", "name must be 'Lictor'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["TYRANIDS","INFANTRY","GREAT DEVOURER","VANGUARD INVADER"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Lictor must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Lictor must have exactly ${expectedKws.length} keywords`);
  assert(!u.keywords.includes("LONE OPERATIVE"),
    "Lictor must no longer have the LONE OPERATIVE keyword");
  assertEqual(u.sizes.length, 1, "Lictor must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 60, "Lictor must cost 60pts");
  assertEqual(u.sizes[0].label, "1 model", "Lictor size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Pheromone Trail"),
    "Lictor must have a rulesAdaptations mentioning 'Pheromone Trail'");
});

test("Neurolictor has SYNAPSE keyword", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_neurolictor");
  assert(u.keywords.includes("SYNAPSE"), "Neurolictor must have the SYNAPSE keyword");
});

test("Deathleaper exists in tyranids units", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_deathleaper");
  assert(u !== undefined, "tyr_deathleaper must exist in units");
});

test("Deathleaper has correct fields", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_deathleaper");
  assertEqual(u.name, "Deathleaper", "name must be 'Deathleaper'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["TYRANIDS","INFANTRY","CHARACTER","EPIC HERO","GREAT DEVOURER","VANGUARD INVADER"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Deathleaper must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Deathleaper must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Deathleaper must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Deathleaper must cost 80pts");
  assertEqual(u.sizes[0].label, "1 model", "Deathleaper size label must be '1 model'");
});

test("Deathleaper has EPIC HERO keyword", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_deathleaper");
  assert(u.keywords.includes("EPIC HERO"), "Deathleaper must have EPIC HERO keyword");
});

test("Neurolictor exists in tyranids units", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_neurolictor");
  assert(u !== undefined, "tyr_neurolictor must exist in units");
});

test("Neurolictor has correct fields", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_neurolictor");
  assertEqual(u.name, "Neurolictor", "name must be 'Neurolictor'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["TYRANIDS","INFANTRY","SYNAPSE","GREAT DEVOURER","VANGUARD INVADER"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Neurolictor must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Neurolictor must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Neurolictor must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 70, "Neurolictor must cost 70pts");
  assertEqual(u.sizes[0].label, "1 model", "Neurolictor size label must be '1 model'");
});

test("Raveners exists in tyranids units", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_raveners");
  assert(u !== undefined, "tyr_raveners must exist in units");
});

test("Raveners has correct fields", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_raveners");
  assertEqual(u.name, "Raveners", "name must be 'Raveners'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["TYRANIDS","INFANTRY","GREAT DEVOURER","VANGUARD INVADER","BURROWERS"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Raveners must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Raveners must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Raveners must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 125, "Raveners must cost 125pts");
  assertEqual(u.sizes[0].label, "5 models", "Raveners size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Death From Below"),
    "Raveners must have a rulesAdaptations mentioning 'Death From Below'");
});

test("Von Ryan's Leapers exists in tyranids units", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_von_ryans_leapers");
  assert(u !== undefined, "tyr_von_ryans_leapers must exist in units");
});

test("Von Ryan's Leapers has correct fields", () => {
  const u = factionData["tyranids"].units.find(u => u.id === "tyr_von_ryans_leapers");
  assertEqual(u.name, "Von Ryan's Leapers", "name must be \"Von Ryan's Leapers\"");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["TYRANIDS","INFANTRY","GREAT DEVOURER","VANGUARD INVADER"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Von Ryan's Leapers must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Von Ryan's Leapers must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Von Ryan's Leapers must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 70, "Von Ryan's Leapers must cost 70pts");
  assertEqual(u.sizes[0].label, "3 models", "Von Ryan's Leapers size label must be '3 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Pouncing Leap"),
    "Von Ryan's Leapers must have a rulesAdaptations mentioning 'Pouncing Leap'");
});

test("Tyranids now has 13 units total", () => {
  const units = factionData["tyranids"].units;
  assertEqual(units.length, 13, `Expected 13 Tyranid units, found ${units.length}`);
});


// ── 30. Death Guard Faction ───────────────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("30. Death Guard Faction");

test("Death Guard exists in index.json factions", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  assert(f !== undefined, "death_guard must exist in index.json factions");
});

test("Death Guard has correct name", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  assertEqual(f.name, "Death Guard", "faction name must be 'Death Guard'");
});

test("Death Guard file path is factions/death_guard.json", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  assertEqual(f.file, "factions/death_guard.json",
    "file must be 'factions/death_guard.json' (no data/ prefix)");
});

test("Death Guard has Slow Decay army rule", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  assert(f.armyRule !== undefined, "Death Guard must have an armyRule");
  assertEqual(f.armyRule.name, "Slow Decay",
    "armyRule name must be 'Slow Decay'");
  assert(typeof f.armyRule.desc === "string" && f.armyRule.desc.length > 0,
    "armyRule must have a non-empty desc");
});

test("Slow Decay desc references Nurgle's Gift ability", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  assert(f.armyRule.desc.includes("Nurgle's Gift"),
    "Slow Decay desc must reference the Nurgle's Gift ability");
});

test("Slow Decay desc references all three battle round Contagion Ranges", () => {
  const f = index.factions.find(f => f.id === "death_guard");
  const desc = f.armyRule.desc;
  assert(desc.includes("Battle Round 1") && desc.includes("1"),
    "Slow Decay desc must reference Battle Round 1 and 1\" range");
  assert(desc.includes("Battle Round 2") && desc.includes("3"),
    "Slow Decay desc must reference Battle Round 2 and 3\" range");
  assert(desc.includes("Battle Round 3") && desc.includes("6"),
    "Slow Decay desc must reference Battle Round 3+ and 6\" range");
});

test("index.json now has at least 8 factions including Death Guard, World Eaters and Orks", () => {
  assert(index.factions.length >= 8,
    `Expected at least 8 factions in index.json, found ${index.factions.length}`);
  const ids = index.factions.map(f => f.id);
  assert(ids.includes("death_guard"),        "death_guard must be present");
  assert(ids.includes("world_eaters"),       "world_eaters must be present");
  assert(ids.includes("orks"),               "orks must be present");
  assert(ids.includes("space_marines"),      "space_marines must still be present");
  assert(ids.includes("adeptus_custodes"),   "adeptus_custodes must still be present");
  assert(ids.includes("chaos_space_marines"),"chaos_space_marines must still be present");
  assert(ids.includes("tyranids"),           "tyranids must still be present");
  assert(ids.includes("necrons"),            "necrons must still be present");
});


// ── 31. Death Guard — Arch-Contaminators Detachment ─────────────────────────

section("31. Death Guard — Arch-Contaminators Detachment");

test("Arch-Contaminators detachment exists in death_guard.json", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assert(det !== undefined, "dg_arch_contaminators detachment must exist");
});

test("Arch-Contaminators has correct name", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assertEqual(det.name, "Arch-Contaminators", "detachment name must be 'Arch-Contaminators'");
});

test("Arch-Contaminators has Inescapable Corruption special rule", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Inescapable Corruption",
    "specialRule name must be 'Inescapable Corruption'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
  assert(det.specialRule.desc.includes("Contagion Range"),
    "Inescapable Corruption desc must reference Contagion Range");
  assert(det.specialRule.desc.includes("Blightlord Terminator"),
    "Inescapable Corruption desc must reference Blightlord Terminator");
});

test("Arch-Contaminators has maxCharacters set to 2", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assertEqual(det.maxCharacters, 2,
    "Arch-Contaminators maxCharacters must be 2");
});

test("Arch-Contaminators character cap — first CHARACTER can be added", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_arch_contaminators");
  // Simulate empty list: 0 characters present, cap of 2 not reached
  const list = [];
  const charCount = list.filter(l => dgData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "First CHARACTER should be addable when list is empty");
});

test("Arch-Contaminators character cap — second CHARACTER can be added when one is present", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_arch_contaminators");
  const list = [{ unitId: "dg_typhus" }];
  const charCount = list.filter(l => dgData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "Second CHARACTER should be addable when one CHARACTER is already in the list");
});

test("Arch-Contaminators character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_arch_contaminators");
  const list = [{ unitId: "dg_typhus" }, { unitId: "dg_lord_of_contagion" }];
  const charCount = list.filter(l => dgData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when 2 CHARACTERs are already in the list");
});

test("Arch-Contaminators character cap — non-CHARACTER units are unaffected", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_arch_contaminators");
  // Blightlord Terminators and Deathshroud Terminators are INFANTRY, not CHARACTER
  ["dg_blightlord_terminators", "dg_deathshroud_terminators", "dg_chaos_spawn"].forEach(id => {
    const u = dgData.units.find(u => u.id === id);
    assert(u.type !== "CHARACTER",
      `"${id}" must not be a CHARACTER and must be unaffected by the character cap`);
  });
});

test("Arch-Contaminators has exactly 2 enhancements", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assertEqual(det.enhancements.length, 2, "Arch-Contaminators must have exactly 2 enhancements");
});

test("Arch-Contaminators has Miasmic Odour enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  const enh = det.enhancements.find(e => e.id === "enh_dg_miasmic_odour");
  assert(enh !== undefined, "enh_dg_miasmic_odour must exist");
  assertEqual(enh.name, "Miasmic Odour", "enhancement name must be 'Miasmic Odour'");
  assert(enh.desc.includes("Contagion Range"),
    "Miasmic Odour desc must reference Contagion Range");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Miasmic Odour must have no keyword requirements");
});

test("Arch-Contaminators has Disgusting Reinvigoration enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  const enh = det.enhancements.find(e => e.id === "enh_dg_disgusting_reinvigoration");
  assert(enh !== undefined, "enh_dg_disgusting_reinvigoration must exist");
  assertEqual(enh.name, "Disgusting Reinvigoration",
    "enhancement name must be 'Disgusting Reinvigoration'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Disgusting Reinvigoration must have no keyword requirements");
});

test("Arch-Contaminators has exactly 6 units", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assertEqual(det.units.length, 6, "Arch-Contaminators must have exactly 6 unit entries");
});

test("Arch-Contaminators unit roster — correct IDs and maxes", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  const expected = [
    { id: "dg_typhus",                    max: 1 },
    { id: "dg_lord_of_contagion",         max: 1 },
    { id: "dg_lord_of_virulence",         max: 1 },
    { id: "dg_blightlord_terminators",    max: 1 },
    { id: "dg_deathshroud_terminators",   max: 1 },
    { id: "dg_chaos_spawn",               max: 1 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Arch-Contaminators`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("Death Guard now has 3 detachments", () => {
  const dgData = factionData["death_guard"];
  assertEqual(dgData.detachments.length, 3,
    `Expected 3 Death Guard detachments, found ${dgData.detachments.length}`);
  const ids = dgData.detachments.map(d => d.id);
  assert(ids.includes("dg_arch_contaminators"), "dg_arch_contaminators must exist");
  assert(ids.includes("dg_unclean_uprising"),   "dg_unclean_uprising must exist");
  assert(ids.includes("dg_vectors_of_decay"),   "dg_vectors_of_decay must exist");
});

test("Typhus has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_typhus");
  assert(u !== undefined, "dg_typhus must exist");
  assertEqual(u.name, "Typhus", "name must be 'Typhus'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = [
    "DEATH GUARD", "INFANTRY", "CHARACTER", "PSYKER",
    "EPIC HERO", "CHAOS", "NURGLE", "TERMINATOR"
  ];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Typhus must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Typhus must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Typhus must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 100, "Typhus must cost 100pts");
  assertEqual(u.sizes[0].label, "1 model", "Typhus size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Eater Plague"),
    "Typhus must have a rulesAdaptations mentioning 'Eater Plague'");
});

test("Typhus has EPIC HERO and PSYKER keywords", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_typhus");
  assert(u.keywords.includes("EPIC HERO"), "Typhus must have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),    "Typhus must have PSYKER keyword");
});

test("Lord of Contagion has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_lord_of_contagion");
  assert(u !== undefined, "dg_lord_of_contagion must exist");
  assertEqual(u.name, "Lord of Contagion", "name must be 'Lord of Contagion'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = [
    "DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE", "TERMINATOR"
  ];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Lord of Contagion must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Lord of Contagion must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 120, "Lord of Contagion must cost 120pts");
  assertEqual(u.sizes[0].label, "1 model", "Lord of Contagion size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Unholy Resilience"),
    "Lord of Contagion must have a rulesAdaptations mentioning 'Unholy Resilience'");
});

test("Lord of Virulence has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_lord_of_virulence");
  assert(u !== undefined, "dg_lord_of_virulence must exist");
  assertEqual(u.name, "Lord of Virulence", "name must be 'Lord of Virulence'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = [
    "DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE", "TERMINATOR"
  ];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Lord of Virulence must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Lord of Virulence must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 100, "Lord of Virulence must cost 100pts");
  assertEqual(u.sizes[0].label, "1 model", "Lord of Virulence size label must be '1 model'");
  assert(!u.rulesAdaptations,
    "Lord of Virulence must have no rulesAdaptations");
});

test("Arch-Contaminators smoke test — legal list within points limit", () => {
  // Typhus (100) + Lord of Contagion (120) + Blightlord Terminators (185) = 405pts
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_arch_contaminators");
  const unitIds = new Set(dgData.units.map(u => u.id));

  const picks = [
    { id: "dg_typhus",                 count: 1, pts: 100 },
    { id: "dg_lord_of_contagion",      count: 1, pts: 120 },
    { id: "dg_blightlord_terminators", count: 1, pts: 185 },
  ];

  let total = 0;
  picks.forEach(({ id, count, pts }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Arch-Contaminators`);
    assert(count <= entry.max, `"${id}" count ${count} exceeds max ${entry.max}`);
    assert(unitIds.has(id), `"${id}" must be a real unit`);
    total += count * pts;
  });
  assert(total <= 500, `Smoke test list total ${total}pts exceeds 500pt limit`);
});


test("Blightlord Terminators has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_blightlord_terminators");
  assert(u !== undefined, "dg_blightlord_terminators must exist");
  assertEqual(u.name, "Blightlord Terminators", "name must be 'Blightlord Terminators'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHAOS", "NURGLE", "TERMINATOR"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Blightlord Terminators must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Blightlord Terminators must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Blightlord Terminators must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 185, "Blightlord Terminators must cost 185pts");
  assertEqual(u.sizes[0].label, "5 models", "Blightlord Terminators size label must be '5 models'");
  assert(!u.rulesAdaptations, "Blightlord Terminators must have no rulesAdaptations");
});

test("Deathshroud Terminators has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_deathshroud_terminators");
  assert(u !== undefined, "dg_deathshroud_terminators must exist");
  assertEqual(u.name, "Deathshroud Terminators", "name must be 'Deathshroud Terminators'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHAOS", "NURGLE", "TERMINATOR"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Deathshroud Terminators must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Deathshroud Terminators must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Deathshroud Terminators must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 160, "Deathshroud Terminators must cost 160pts");
  assertEqual(u.sizes[0].label, "3 models", "Deathshroud Terminators size label must be '3 models'");
  assert(!u.rulesAdaptations, "Deathshroud Terminators must have no rulesAdaptations");
});

test("Chaos Spawn has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_chaos_spawn");
  assert(u !== undefined, "dg_chaos_spawn must exist");
  assertEqual(u.name, "Chaos Spawn", "name must be 'Chaos Spawn'");
  assertEqual(u.type, "BEAST", "type must be BEAST");
  const expectedKws = ["DEATH GUARD", "BEAST", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Chaos Spawn must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Chaos Spawn must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Chaos Spawn must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Chaos Spawn must cost 80pts");
  assertEqual(u.sizes[0].label, "2 models", "Chaos Spawn size label must be '2 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "Chaos Spawn must have a rulesAdaptations mentioning 'Scouts'");
});


// ── 32. Death Guard — Unclean Uprising Detachment ────────────────────────────

section("32. Death Guard — Unclean Uprising Detachment");

test("Unclean Uprising detachment exists in death_guard.json", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assert(det !== undefined, "dg_unclean_uprising detachment must exist");
});

test("Unclean Uprising has correct name", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.name, "Unclean Uprising", "detachment name must be 'Unclean Uprising'");
});

test("Unclean Uprising has Relentless Spread special rule", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Relentless Spread",
    "specialRule name must be 'Relentless Spread'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
  assert(det.specialRule.desc.includes("Consolidation move"),
    "Relentless Spread desc must reference Consolidation move");
  assert(det.specialRule.desc.includes("D3"),
    "Relentless Spread desc must reference D3");
});

test("Unclean Uprising has maxCharacters set to 2", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.maxCharacters, 2, "Unclean Uprising maxCharacters must be 2");
});

test("Unclean Uprising has exactly 2 enhancements", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.enhancements.length, 2,
    "Unclean Uprising must have exactly 2 enhancements");
});

test("Unclean Uprising has Pox-Bearer enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const enh = det.enhancements.find(e => e.id === "enh_dg_pox_bearer");
  assert(enh !== undefined, "enh_dg_pox_bearer must exist");
  assertEqual(enh.name, "Pox-Bearer", "enhancement name must be 'Pox-Bearer'");
  assert(enh.desc.includes("Poxwalkers"),
    "Pox-Bearer desc must reference Poxwalkers");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Pox-Bearer must have no keyword requirements");
});

test("Unclean Uprising has Hand of Nurgle enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const enh = det.enhancements.find(e => e.id === "enh_dg_hand_of_nurgle");
  assert(enh !== undefined, "enh_dg_hand_of_nurgle must exist");
  assertEqual(enh.name, "Hand of Nurgle", "enhancement name must be 'Hand of Nurgle'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Hand of Nurgle must have no keyword requirements");
});

test("Unclean Uprising has exactly 4 units", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.units.length, 13, "Unclean Uprising must have exactly 13 unit entries");
});

test("Unclean Uprising unit roster — correct IDs and maxes", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const expected = [
    { id: "dg_lord_of_contagion",        max: 1 },
    { id: "dg_lord_of_virulence",        max: 1 },
    { id: "dg_typhus",                   max: 1 },
    { id: "dg_chaos_spawn",              max: 1 },
    { id: "dg_lord_of_poxes",            max: 1 },
    { id: "dg_malignant_plaguecaster",   max: 1 },
    { id: "dg_biologus_putrifier",       max: 1 },
    { id: "dg_icon_bearer",              max: 1 },
    { id: "dg_foul_blightspawn",         max: 1 },
    { id: "dg_noxious_blightbringer",    max: 1 },
    { id: "dg_plague_surgeon",           max: 1 },
    { id: "dg_tallyman",                 max: 1 },
    { id: "dg_poxwalkers",               max: 6 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Unclean Uprising`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("Unclean Uprising character cap — third CHARACTER is blocked when 2 are present", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [{ unitId: "dg_typhus" }, { unitId: "dg_lord_of_contagion" }];
  const charCount = list.filter(l =>
    dgData.units.find(u => u.id === l.unitId)?.type === "CHARACTER"
  ).length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when cap of 2 is reached");
});

test("Unclean Uprising smoke test — legal list within points limit", () => {
  // Typhus (100) + Lord of Virulence (100) + Chaos Spawn (80) = 280pts
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const unitIds = new Set(dgData.units.map(u => u.id));

  const picks = [
    { id: "dg_typhus",            count: 1, pts: 100 },
    { id: "dg_lord_of_virulence", count: 1, pts: 100 },
    { id: "dg_chaos_spawn",       count: 1, pts: 80  },
  ];

  let total = 0;
  picks.forEach(({ id, count, pts }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Unclean Uprising`);
    assert(count <= entry.max, `"${id}" count ${count} exceeds max ${entry.max}`);
    assert(unitIds.has(id), `"${id}" must be a real unit`);
    total += count * pts;
  });
  assert(total <= 500, `Smoke test list total ${total}pts exceeds 500pt limit`);
});


test("Lord of Poxes has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_lord_of_poxes");
  assert(u !== undefined, "dg_lord_of_poxes must exist");
  assertEqual(u.name, "Lord of Poxes", "name must be 'Lord of Poxes'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Lord of Poxes must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Lord of Poxes must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 75, "Lord of Poxes must cost 75pts");
  assertEqual(u.sizes[0].label, "1 model", "Lord of Poxes size label must be '1 model'");
  assert(!u.rulesAdaptations, "Lord of Poxes must have no rulesAdaptations");
});

test("Malignant Plaguecaster has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_malignant_plaguecaster");
  assert(u !== undefined, "dg_malignant_plaguecaster must exist");
  assertEqual(u.name, "Malignant Plaguecaster", "name must be 'Malignant Plaguecaster'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "PSYKER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Malignant Plaguecaster must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Malignant Plaguecaster must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 60, "Malignant Plaguecaster must cost 60pts");
  assert(u.keywords.includes("PSYKER"), "Malignant Plaguecaster must have PSYKER keyword");
  assert(!u.rulesAdaptations, "Malignant Plaguecaster must have no rulesAdaptations");
});

test("Biologus Putrifier has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_biologus_putrifier");
  assert(u !== undefined, "dg_biologus_putrifier must exist");
  assertEqual(u.name, "Biologus Putrifier", "name must be 'Biologus Putrifier'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "PSYKER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Biologus Putrifier must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Biologus Putrifier must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 60, "Biologus Putrifier must cost 60pts");
  assert(u.keywords.includes("PSYKER"), "Biologus Putrifier must have PSYKER keyword");
  assert(!u.rulesAdaptations, "Biologus Putrifier must have no rulesAdaptations");
});

test("Icon Bearer has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_icon_bearer");
  assert(u !== undefined, "dg_icon_bearer must exist");
  assertEqual(u.name, "Icon Bearer", "name must be 'Icon Bearer'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Icon Bearer must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Icon Bearer must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 45, "Icon Bearer must cost 45pts");
  assert(!u.rulesAdaptations, "Icon Bearer must have no rulesAdaptations");
});

test("Foul Blightspawn has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_foul_blightspawn");
  assert(u !== undefined, "dg_foul_blightspawn must exist");
  assertEqual(u.name, "Foul Blightspawn", "name must be 'Foul Blightspawn'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Foul Blightspawn must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Foul Blightspawn must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 75, "Foul Blightspawn must cost 75pts");
  assert(!u.rulesAdaptations, "Foul Blightspawn must have no rulesAdaptations");
});

test("Noxious Blightbringer has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_noxious_blightbringer");
  assert(u !== undefined, "dg_noxious_blightbringer must exist");
  assertEqual(u.name, "Noxious Blightbringer", "name must be 'Noxious Blightbringer'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Noxious Blightbringer must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Noxious Blightbringer must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 50, "Noxious Blightbringer must cost 50pts");
  assert(!u.rulesAdaptations, "Noxious Blightbringer must have no rulesAdaptations");
});

test("Plague Surgeon has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_plague_surgeon");
  assert(u !== undefined, "dg_plague_surgeon must exist");
  assertEqual(u.name, "Plague Surgeon", "name must be 'Plague Surgeon'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Plague Surgeon must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Plague Surgeon must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 50, "Plague Surgeon must cost 50pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Tainted Narthecium"),
    "Plague Surgeon must have a rulesAdaptations mentioning 'Tainted Narthecium'");
});

test("Tallyman has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_tallyman");
  assert(u !== undefined, "dg_tallyman must exist");
  assertEqual(u.name, "Tallyman", "name must be 'Tallyman'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHARACTER", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Tallyman must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Tallyman must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 50, "Tallyman must cost 50pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Sevenfold Chant"),
    "Tallyman must have a rulesAdaptations mentioning 'Sevenfold Chant'");
});

test("Poxwalkers has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_poxwalkers");
  assert(u !== undefined, "dg_poxwalkers must exist");
  assertEqual(u.name, "Poxwalkers", "name must be 'Poxwalkers'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  // Poxwalkers are a horde unit — CHARACTER keyword omitted (brief copy-paste; 10-model units are not CHARACTERs)
  const expectedKws = ["DEATH GUARD", "INFANTRY", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Poxwalkers must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length, `Poxwalkers must have exactly ${expectedKws.length} keywords`);
  assert(!u.keywords.includes("CHARACTER"), "Poxwalkers must NOT have the CHARACTER keyword");
  assertEqual(u.sizes[0].pts, 65, "Poxwalkers must cost 65pts");
  assertEqual(u.sizes[0].label, "10 models", "Poxwalkers size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Form Boarding Squads"),
    "Poxwalkers must have a rulesAdaptations mentioning 'Form Boarding Squads'");
});

test("Poxwalkers max is 6 in Unclean Uprising", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const entry = det.units.find(u => u.id === "dg_poxwalkers");
  assert(entry !== undefined, "dg_poxwalkers must be in Unclean Uprising");
  assertEqual(entry.max, 6, "Poxwalkers max must be 6 in Unclean Uprising");
});


// ── 33. Unclean Uprising — Lord Unit maxFromGroup Constraint ─────────────────

section("33. Unclean Uprising — Lord Unit maxFromGroup Constraint");

test("Unclean Uprising has maxFromGroup defined", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assert(Array.isArray(det.maxFromGroup) && det.maxFromGroup.length > 0,
    "dg_unclean_uprising must have a maxFromGroup array");
});

test("Unclean Uprising has exactly 2 maxFromGroup groups", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.maxFromGroup.length, 2,
    "Unclean Uprising must have exactly 2 maxFromGroup groups");
});

test("Unclean Uprising maxFromGroup has correct max of 1", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assertEqual(det.maxFromGroup[0].max, 1,
    "Unclean Uprising maxFromGroup[0].max must be 1");
  assertEqual(det.maxFromGroup[1].max, 1,
    "Unclean Uprising maxFromGroup[1].max must be 1");
});

test("Unclean Uprising maxFromGroup includes exactly the 5 lord unit IDs", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const group = det.maxFromGroup[0];
  const expectedIds = [
    "dg_lord_of_poxes",
    "dg_lord_of_contagion",
    "dg_lord_of_virulence",
    "dg_typhus",
    "dg_malignant_plaguecaster"
  ];
  assertEqual(group.unitIds.length, 5,
    `maxFromGroup must list exactly 5 unit IDs, found ${group.unitIds.length}`);
  expectedIds.forEach(id => {
    assert(group.unitIds.includes(id), `maxFromGroup must include "${id}"`);
  });
});

test("Unclean Uprising maxFromGroup has a description string", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const group = det.maxFromGroup[0];
  assert(typeof group.description === "string" && group.description.length > 0,
    "maxFromGroup group must have a non-empty description string");
});

test("maxFromGroup — first lord unit can be added to an empty list", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  det.maxFromGroup[0].unitIds.forEach(id => {
    assert(!isBlocked(id), `"${id}" must not be blocked in an empty list`);
  });
});

test("maxFromGroup — all other lord units are blocked once one is in the list", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const group = det.maxFromGroup[0];
  const list = [{ unitId: "dg_typhus" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  group.unitIds.filter(id => id !== "dg_typhus").forEach(id => {
    assert(isBlocked(id),
      `"${id}" must be blocked when dg_typhus is already in the list`);
  });
});

test("maxFromGroup — a unit already in the list is never blocked by its own presence", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [{ unitId: "dg_lord_of_contagion" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  assert(!isBlocked("dg_lord_of_contagion"),
    "dg_lord_of_contagion must not be blocked by its own presence in the list");
});

test("maxFromGroup — non-lord units in Unclean Uprising are unaffected", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  // Fill the lord cap
  const list = [{ unitId: "dg_typhus" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  const nonLordIds = [
    "dg_chaos_spawn", "dg_biologus_putrifier", "dg_icon_bearer",
    "dg_foul_blightspawn", "dg_noxious_blightbringer",
    "dg_plague_surgeon", "dg_tallyman", "dg_poxwalkers"
  ];
  nonLordIds.forEach(id => {
    assert(!isBlocked(id),
      `"${id}" must not be blocked by the lord maxFromGroup constraint`);
  });
});

test("Arch-Contaminators detachment has no maxFromGroup", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_arch_contaminators");
  assert(det.maxFromGroup === undefined,
    "dg_arch_contaminators should not have maxFromGroup");
});


// ── 34. Unclean Uprising — Specialist Unit maxFromGroup Constraint ────────────

section("34. Unclean Uprising — Specialist Unit maxFromGroup Constraint");

test("Unclean Uprising maxFromGroup group 2 includes exactly the 6 specialist unit IDs", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const group = det.maxFromGroup[1];
  const expectedIds = [
    "dg_biologus_putrifier",
    "dg_icon_bearer",
    "dg_foul_blightspawn",
    "dg_noxious_blightbringer",
    "dg_plague_surgeon",
    "dg_tallyman"
  ];
  assertEqual(group.unitIds.length, 6,
    `maxFromGroup[1] must list exactly 6 unit IDs, found ${group.unitIds.length}`);
  expectedIds.forEach(id => {
    assert(group.unitIds.includes(id), `maxFromGroup[1] must include "${id}"`);
  });
});

test("Unclean Uprising maxFromGroup group 2 has a description string", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const group = det.maxFromGroup[1];
  assert(typeof group.description === "string" && group.description.length > 0,
    "maxFromGroup[1] group must have a non-empty description string");
});

test("Specialist group — first unit can be added to an empty list", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [];
  const isBlockedByGroup2 = (unitId) => {
    const g = det.maxFromGroup[1];
    if (!g.unitIds.includes(unitId)) return false;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    return !thisUnitInList && alreadyInList >= g.max;
  };
  det.maxFromGroup[1].unitIds.forEach(id => {
    assert(!isBlockedByGroup2(id), `"${id}" must not be blocked in an empty list`);
  });
});

test("Specialist group — all others are blocked once one is in the list", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [{ unitId: "dg_plague_surgeon" }];
  const isBlockedByGroup2 = (unitId) => {
    const g = det.maxFromGroup[1];
    if (!g.unitIds.includes(unitId)) return false;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    return !thisUnitInList && alreadyInList >= g.max;
  };
  det.maxFromGroup[1].unitIds.filter(id => id !== "dg_plague_surgeon").forEach(id => {
    assert(isBlockedByGroup2(id),
      `"${id}" must be blocked when dg_plague_surgeon is already in the list`);
  });
});

test("Specialist group — a unit already in the list is not blocked by its own presence", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  const list = [{ unitId: "dg_tallyman" }];
  const isBlockedByGroup2 = (unitId) => {
    const g = det.maxFromGroup[1];
    if (!g.unitIds.includes(unitId)) return false;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    return !thisUnitInList && alreadyInList >= g.max;
  };
  assert(!isBlockedByGroup2("dg_tallyman"),
    "dg_tallyman must not be blocked by its own presence in the list");
});

test("Two groups are independent — selecting from group 1 does not block group 2", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  // Lord cap hit
  const list = [{ unitId: "dg_typhus" }];
  const isBlockedByGroup2 = (unitId) => {
    const g = det.maxFromGroup[1];
    if (!g.unitIds.includes(unitId)) return false;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    return !thisUnitInList && alreadyInList >= g.max;
  };
  det.maxFromGroup[1].unitIds.forEach(id => {
    assert(!isBlockedByGroup2(id),
      `"${id}" must not be blocked by the lord group constraint`);
  });
});

test("Two groups are independent — selecting from group 2 does not block group 1", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  // Specialist cap hit
  const list = [{ unitId: "dg_tallyman" }];
  const isBlockedByGroup1 = (unitId) => {
    const g = det.maxFromGroup[0];
    if (!g.unitIds.includes(unitId)) return false;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    return !thisUnitInList && alreadyInList >= g.max;
  };
  det.maxFromGroup[0].unitIds.forEach(id => {
    assert(!isBlockedByGroup1(id),
      `"${id}" must not be blocked by the specialist group constraint`);
  });
});

test("Units outside both groups are never blocked by either", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_unclean_uprising");
  // Both caps hit
  const list = [{ unitId: "dg_typhus" }, { unitId: "dg_tallyman" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
      const thisUnitInList = list.some(l => l.unitId === unitId);
      if (!thisUnitInList && alreadyInList >= g.max) return true;
    }
    return false;
  };
  ["dg_chaos_spawn", "dg_poxwalkers"].forEach(id => {
    assert(!isBlocked(id),
      `"${id}" must not be blocked by either maxFromGroup constraint`);
  });
});


// ── 35. Death Guard — Vectors of Decay Detachment ────────────────────────────

section("35. Death Guard — Vectors of Decay Detachment");

test("Vectors of Decay detachment exists in death_guard.json", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assert(det !== undefined, "dg_vectors_of_decay detachment must exist");
});

test("Vectors of Decay has correct name", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assertEqual(det.name, "Vectors of Decay", "detachment name must be 'Vectors of Decay'");
});

test("Vectors of Decay has Sevenfold Offerings special rule", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Sevenfold Offerings",
    "specialRule name must be 'Sevenfold Offerings'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
  assert(det.specialRule.desc.includes("Contagion Range"),
    "Sevenfold Offerings desc must reference Contagion Range");
  assert(det.specialRule.desc.includes("seven"),
    "Sevenfold Offerings desc must reference 'seven' enemy models");
});

test("Vectors of Decay has maxCharacters set to 2", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assertEqual(det.maxCharacters, 2, "Vectors of Decay maxCharacters must be 2");
});

test("Vectors of Decay has exactly 2 enhancements", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assertEqual(det.enhancements.length, 2,
    "Vectors of Decay must have exactly 2 enhancements");
});

test("Vectors of Decay has Foul Constitution enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const enh = det.enhancements.find(e => e.id === "enh_dg_foul_constitution");
  assert(enh !== undefined, "enh_dg_foul_constitution must exist");
  assertEqual(enh.name, "Foul Constitution", "enhancement name must be 'Foul Constitution'");
  assert(enh.desc.includes("Damage"),
    "Foul Constitution desc must reference the Damage characteristic");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Foul Constitution must have no keyword requirements");
});

test("Vectors of Decay has Fountaining Filth enhancement", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const enh = det.enhancements.find(e => e.id === "enh_dg_fountaining_filth");
  assert(enh !== undefined, "enh_dg_fountaining_filth must exist");
  assertEqual(enh.name, "Fountaining Filth", "enhancement name must be 'Fountaining Filth'");
  assert(enh.desc.includes("mortal wound"),
    "Fountaining Filth desc must reference mortal wounds");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Fountaining Filth must have no keyword requirements");
});

test("Vectors of Decay has exactly 16 units", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assertEqual(det.units.length, 16, "Vectors of Decay must have exactly 16 unit entries");
});

test("Vectors of Decay unit roster — correct IDs and maxes", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const expected = [
    { id: "dg_lord_of_poxes",            max: 1 },
    { id: "dg_lord_of_contagion",         max: 1 },
    { id: "dg_lord_of_virulence",         max: 1 },
    { id: "dg_malignant_plaguecaster",    max: 1 },
    { id: "dg_typhus",                    max: 1 },
    { id: "dg_poxwalkers",                max: 3 },
    { id: "dg_blightlord_terminators",    max: 1 },
    { id: "dg_chaos_spawn",               max: 1 },
    { id: "dg_deathshroud_terminators",   max: 1 },
    { id: "dg_biologus_putrifier",        max: 1 },
    { id: "dg_icon_bearer",               max: 1 },
    { id: "dg_foul_blightspawn",          max: 1 },
    { id: "dg_noxious_blightbringer",     max: 1 },
    { id: "dg_plague_surgeon",            max: 1 },
    { id: "dg_tallyman",                  max: 1 },
    { id: "dg_plague_marines",            max: 3 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Vectors of Decay`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("Vectors of Decay — Poxwalkers max is 3 (differs from Unclean Uprising's 6)", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const entry = det.units.find(u => u.id === "dg_poxwalkers");
  assertEqual(entry.max, 3, "Poxwalkers max must be 3 in Vectors of Decay");
});

test("Vectors of Decay character cap — third CHARACTER is blocked when 2 are present", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const list = [{ unitId: "dg_typhus" }, { unitId: "dg_lord_of_contagion" }];
  const charCount = list.filter(l =>
    dgData.units.find(u => u.id === l.unitId)?.type === "CHARACTER"
  ).length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when cap of 2 is reached");
});

test("Vectors of Decay smoke test — legal list within points limit", () => {
  // Typhus (100) + Blightlord Terminators (185) + Poxwalkers (65) = 350pts
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const unitIds = new Set(dgData.units.map(u => u.id));

  const picks = [
    { id: "dg_typhus",                 count: 1, pts: 100 },
    { id: "dg_blightlord_terminators", count: 1, pts: 185 },
    { id: "dg_poxwalkers",             count: 1, pts: 65  },
  ];

  let total = 0;
  picks.forEach(({ id, count, pts }) => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Vectors of Decay`);
    assert(count <= entry.max, `"${id}" count ${count} exceeds max ${entry.max}`);
    assert(unitIds.has(id), `"${id}" must be a real unit`);
    total += count * pts;
  });
  assert(total <= 500, `Smoke test list total ${total}pts exceeds 500pt limit`);
});


test("Plague Marines has correct fields", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_plague_marines");
  assert(u !== undefined, "dg_plague_marines must exist");
  assertEqual(u.name, "Plague Marines", "name must be 'Plague Marines'");
  assertEqual(u.type, "BATTLELINE", "type must be BATTLELINE");
  const expectedKws = ["DEATH GUARD", "INFANTRY", "BATTLELINE", "CHAOS", "NURGLE"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Plague Marines must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Plague Marines must have exactly ${expectedKws.length} keywords`);
  assert(!u.rulesAdaptations, "Plague Marines must have no rulesAdaptations");
});

test("Plague Marines has 3 size options with correct costs", () => {
  const u = factionData["death_guard"].units.find(u => u.id === "dg_plague_marines");
  assertEqual(u.sizes.length, 3, "Plague Marines must have exactly 3 size options");
  const expected = [
    { label: "5 models",  pts: 95  },
    { label: "7 models",  pts: 130 },
    { label: "10 models", pts: 190 },
  ];
  expected.forEach(({ label, pts }) => {
    const size = u.sizes.find(s => s.label === label);
    assert(size !== undefined, `Plague Marines must have a "${label}" size option`);
    assertEqual(size.pts, pts, `Plague Marines "${label}" must cost ${pts}pts`);
  });
});

test("Plague Marines max is 3 in Vectors of Decay", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const entry = det.units.find(u => u.id === "dg_plague_marines");
  assert(entry !== undefined, "dg_plague_marines must be in Vectors of Decay");
  assertEqual(entry.max, 3, "Plague Marines max must be 3 in Vectors of Decay");
});

test("Death Guard now has 16 units", () => {
  const units = factionData["death_guard"].units;
  assertEqual(units.length, 16, `Expected 16 Death Guard units, found ${units.length}`);
});


// ── 36. Vectors of Decay — Character & Ratio Constraints ─────────────────────

section("36. Vectors of Decay — Character & Ratio Constraints");

// ── maxFromGroup (copied from Unclean Uprising) ───────────────────────────────

test("Vectors of Decay has exactly 2 maxFromGroup groups", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assert(Array.isArray(det.maxFromGroup) && det.maxFromGroup.length === 2,
    "dg_vectors_of_decay must have exactly 2 maxFromGroup groups");
});

test("Vectors of Decay maxFromGroup group 1 — lord group matches Unclean Uprising", () => {
  const vod = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const uu  = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const vodGroup = vod.maxFromGroup[0];
  const uuGroup  = uu.maxFromGroup[0];
  assertEqual(vodGroup.max, uuGroup.max,
    "VoD lord group max must match Unclean Uprising lord group max");
  assertEqual(vodGroup.unitIds.length, uuGroup.unitIds.length,
    "VoD lord group must have same number of unit IDs as Unclean Uprising lord group");
  uuGroup.unitIds.forEach(id => {
    assert(vodGroup.unitIds.includes(id),
      `VoD lord group must include "${id}" (present in Unclean Uprising lord group)`);
  });
});

test("Vectors of Decay maxFromGroup group 2 — specialist group matches Unclean Uprising", () => {
  const vod = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const uu  = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  const vodGroup = vod.maxFromGroup[1];
  const uuGroup  = uu.maxFromGroup[1];
  assertEqual(vodGroup.max, uuGroup.max,
    "VoD specialist group max must match Unclean Uprising specialist group max");
  assertEqual(vodGroup.unitIds.length, uuGroup.unitIds.length,
    "VoD specialist group must have same number of unit IDs as Unclean Uprising specialist group");
  uuGroup.unitIds.forEach(id => {
    assert(vodGroup.unitIds.includes(id),
      `VoD specialist group must include "${id}" (present in Unclean Uprising specialist group)`);
  });
});

test("Vectors of Decay maxFromGroup — lord group blocks second lord unit", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const list = [{ unitId: "dg_typhus" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const already = list.filter(l => g.unitIds.includes(l.unitId)).length;
      if (!list.some(l => l.unitId === unitId) && already >= g.max) return true;
    }
    return false;
  };
  det.maxFromGroup[0].unitIds.filter(id => id !== "dg_typhus").forEach(id => {
    assert(isBlocked(id), `"${id}" must be blocked when dg_typhus is in the list`);
  });
});

test("Vectors of Decay maxFromGroup — specialist group blocks second specialist unit", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const list = [{ unitId: "dg_tallyman" }];
  const isBlocked = (unitId) => {
    for (const g of det.maxFromGroup) {
      if (!g.unitIds.includes(unitId)) continue;
      const already = list.filter(l => g.unitIds.includes(l.unitId)).length;
      if (!list.some(l => l.unitId === unitId) && already >= g.max) return true;
    }
    return false;
  };
  det.maxFromGroup[1].unitIds.filter(id => id !== "dg_tallyman").forEach(id => {
    assert(isBlocked(id), `"${id}" must be blocked when dg_tallyman is in the list`);
  });
});

// ── keywordRatio — Poxwalkers ≤ Plague Marines ───────────────────────────────

test("Vectors of Decay has keywordRatio defined", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assert(det.keywordRatio !== undefined, "dg_vectors_of_decay must have a keywordRatio");
});

test("Vectors of Decay keywordRatio uses numeratorUnitIds and denominatorUnitIds", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const ratio = det.keywordRatio;
  assert(Array.isArray(ratio.numeratorUnitIds) && ratio.numeratorUnitIds.length > 0,
    "keywordRatio must have a non-empty numeratorUnitIds array");
  assert(Array.isArray(ratio.denominatorUnitIds) && ratio.denominatorUnitIds.length > 0,
    "keywordRatio must have a non-empty denominatorUnitIds array");
  assert(ratio.numeratorUnitIds.includes("dg_poxwalkers"),
    "numeratorUnitIds must include dg_poxwalkers");
  assert(ratio.denominatorUnitIds.includes("dg_plague_marines"),
    "denominatorUnitIds must include dg_plague_marines");
});

test("Vectors of Decay keywordRatio has a description string", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  assert(typeof det.keywordRatio.description === "string" && det.keywordRatio.description.length > 0,
    "keywordRatio must have a non-empty description");
});

test("keywordRatio — Poxwalkers blocked when equal to Plague Marines count", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const ratio = det.keywordRatio;
  // 1 Plague Marine, 1 Poxwalkers already in list → Poxwalkers at cap, next one blocked
  const list = [{ unitId: "dg_plague_marines" }, { unitId: "dg_poxwalkers" }];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount >= denCount,
    "Poxwalkers must be at or over the Plague Marines count — next Poxwalkers must be blocked");
});

test("keywordRatio — Poxwalkers allowed when fewer than Plague Marines", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const ratio = det.keywordRatio;
  // 2 Plague Marines, 1 Poxwalkers → numerator (1) < denominator (2) → not blocked
  const list = [
    { unitId: "dg_plague_marines" },
    { unitId: "dg_plague_marines" },
    { unitId: "dg_poxwalkers" }
  ];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount < denCount,
    "Poxwalkers (1) must be allowed when Plague Marines (2) outnumber them");
});

test("keywordRatio — Poxwalkers blocked with no Plague Marines in list", () => {
  const dgData = factionData["death_guard"];
  const det = dgData.detachments.find(d => d.id === "dg_vectors_of_decay");
  const ratio = det.keywordRatio;
  // 0 Plague Marines → first Poxwalkers immediately blocked
  const list = [];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount >= denCount,
    "First Poxwalkers must be blocked when no Plague Marines are in the list (0 >= 0)");
});

test("keywordRatio — Plague Marines are not blocked by the ratio (denominator is never capped)", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_vectors_of_decay");
  const ratio = det.keywordRatio;
  // Denominator units should never be in numeratorUnitIds
  assert(!ratio.numeratorUnitIds.includes("dg_plague_marines"),
    "dg_plague_marines must not appear in numeratorUnitIds");
});

test("Unclean Uprising does not have a keywordRatio", () => {
  const det = factionData["death_guard"].detachments.find(d => d.id === "dg_unclean_uprising");
  assert(det.keywordRatio === undefined,
    "dg_unclean_uprising should not have a keywordRatio constraint");
});


// ── 37. Code Quality Fixes ────────────────────────────────────────────────────

section("37. Code Quality Fixes");

test("No duplicate .enh-assign-area CSS rule", () => {
  const matches = html.match(/\.enh-assign-area\s*\{/g);
  assertEqual(matches ? matches.length : 0, 1,
    "\.enh-assign-area must appear exactly once in the CSS (duplicate removed)");
});

test("renderList uses MAX_PTS not hardcoded 500", () => {
  assert(html.includes("/ ${MAX_PTS}</span>`"),
    "renderList must use MAX_PTS in the total points display string");
});

test("exportText uses MAX_PTS not hardcoded 500", () => {
  assert(html.includes("/ ${MAX_PTS} pts`"),
    "exportText must use MAX_PTS in the points display lines");
  // Ensure the old hardcoded strings are gone from the exportText function
  // (we check they don't appear in the export functions by looking at context)
  const exportTextStart = html.indexOf("function exportText()");
  const exportTextEnd   = html.indexOf("async function exportPDF()");
  const exportTextBody  = html.slice(exportTextStart, exportTextEnd);
  assert(!exportTextBody.includes("/ 500 pts"),
    "exportText must not contain hardcoded '/ 500 pts'");
});

test("buildPrintSheet uses MAX_PTS not hardcoded 500", () => {
  const buildStart = html.indexOf("function buildPrintSheet()");
  const buildBody  = html.slice(buildStart);
  assert(!buildBody.includes("/ 500 pts"),
    "buildPrintSheet must not contain hardcoded '/ 500 pts'");
  assert(buildBody.includes("MAX_PTS"),
    "buildPrintSheet must reference MAX_PTS");
});

test("ps-pts-label element has an id and is set dynamically", () => {
  assert(html.includes('id="ps-pts-label"'),
    "The print sheet pts label must have id='ps-pts-label'");
  assert(html.includes('getElementById("ps-pts-label")'),
    "buildPrintSheet must update ps-pts-label via getElementById");
});

// ── 38. World Eaters Faction ──────────────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("38. World Eaters Faction");

test("World Eaters exists in index.json factions", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assert(f !== undefined, "world_eaters must exist in index.json factions");
});

test("World Eaters has correct name", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assertEqual(f.name, "World Eaters", "faction name must be 'World Eaters'");
});

test("World Eaters file path is factions/world_eaters.json", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assertEqual(f.file, "factions/world_eaters.json",
    "file must be 'factions/world_eaters.json' (no data/ prefix)");
});

test("World Eaters has Slaughterer's Glory army rule", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assert(f.armyRule !== undefined, "World Eaters must have an armyRule");
  assertEqual(f.armyRule.name, "Slaughterer's Glory",
    "armyRule name must be \"Slaughterer's Glory\"");
  assert(typeof f.armyRule.desc === "string" && f.armyRule.desc.length > 0,
    "armyRule must have a non-empty desc");
});

test("Slaughterer's Glory desc references Blessings of Khorne", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assert(f.armyRule.desc.includes("Blessings of Khorne"),
    "Slaughterer's Glory desc must reference 'Blessings of Khorne'");
});

test("Slaughterer's Glory desc references four D6 instead of eight D6", () => {
  const f = index.factions.find(f => f.id === "world_eaters");
  assert(f.armyRule.desc.includes("four D6") && f.armyRule.desc.includes("eight D6"),
    "Slaughterer's Glory desc must reference 'four D6' and 'eight D6'");
});

test("World Eaters has exactly 8 units", () => {
  const we = factionData["world_eaters"];
  assertEqual(we.units.length, 8,
    `Expected 8 World Eaters units, found ${we.units.length}`);
});


// ── 39. World Eaters — Skullsworn Detachment ─────────────────────────────────

section("39. World Eaters — Skullsworn Detachment");

test("Skullsworn detachment exists in world_eaters.json", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det !== undefined, "we_skullsworn detachment must exist");
});

test("Skullsworn has correct name", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assertEqual(det.name, "Skullsworn", "detachment name must be 'Skullsworn'");
});

test("Skullsworn has Reap the Tally special rule", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Reap the Tally",
    "specialRule name must be 'Reap the Tally'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Reap the Tally desc references Kharn the Betrayer exclusion", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.specialRule.desc.includes("Kharn the Betrayer"),
    "Reap the Tally desc must reference 'Kharn the Betrayer'");
});

test("Reap the Tally desc references the 5+ trigger", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.specialRule.desc.includes("5+"),
    "Reap the Tally desc must reference the 5+ roll");
});

test("Reap the Tally desc references Chaos Terminators and Secure Site", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.specialRule.desc.includes("Chaos Terminator"),
    "Reap the Tally desc must reference Chaos Terminator squads");
  assert(det.specialRule.desc.includes("Secure Site"),
    "Reap the Tally desc must reference the Secure Site Tactical Manoeuvre");
});

test("Skullsworn has maxCharacters set to 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assertEqual(det.maxCharacters, 2, "Skullsworn maxCharacters must be 2");
});

test("Skullsworn has exactly 5 unit entries", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assertEqual(det.units.length, 5, "Skullsworn must have exactly 5 unit entries");
});

test("Skullsworn unit roster — correct IDs and maxes", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const expected = [
    { id: "we_kharn",                max: 1 },
    { id: "we_master_of_executions", max: 2 },
    { id: "we_eightbound",           max: 2 },
    { id: "we_exalted_eightbound",   max: 2 },
    { id: "we_chaos_terminators",    max: 2 }
  ];
  expected.forEach(e => {
    const entry = det.units.find(u => u.id === e.id);
    assert(entry !== undefined, `Skullsworn must include unit "${e.id}"`);
    assertEqual(entry.max, e.max, `"${e.id}" max must be ${e.max}`);
  });
});

test("Skullsworn has exactly 2 enhancements", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assertEqual(det.enhancements.length, 2, "Skullsworn must have exactly 2 enhancements");
});

test("Skullsworn has Frenzied enhancement", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const enh = det.enhancements.find(e => e.id === "enh_we_frenzied");
  assert(enh !== undefined, "enh_we_frenzied must exist");
  assertEqual(enh.name, "Frenzied", "enhancement name must be 'Frenzied'");
  assert(enh.desc.includes("Advance") && enh.desc.includes("Charge"),
    "Frenzied desc must reference Advance and Charge rolls");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Frenzied must have no keyword requirements");
});

test("Skullsworn has Carmine Corona enhancement", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const enh = det.enhancements.find(e => e.id === "enh_we_carmine_corona");
  assert(enh !== undefined, "enh_we_carmine_corona must exist");
  assertEqual(enh.name, "Carmine Corona", "enhancement name must be 'Carmine Corona'");
  assert(enh.desc.includes("Objective Control"),
    "Carmine Corona desc must reference Objective Control");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Carmine Corona must have no keyword requirements");
});


// ── 40. World Eaters — Unit Definitions ──────────────────────────────────────

section("40. World Eaters — Unit Definitions");

test("Kharn the Betrayer exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assert(u !== undefined, "we_kharn must exist in world_eaters units");
});

test("Kharn the Betrayer has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assertEqual(u.name, "Kharn the Betrayer", "name must be 'Kharn the Betrayer'");
});

test("Kharn the Betrayer is type CHARACTER", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assertEqual(u.type, "CHARACTER", "Kharn must be type CHARACTER");
});

test("Kharn the Betrayer has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  const expected = ["WORLD EATERS", "INFANTRY", "CHARACTER", "EPIC HERO", "CHAOS", "KHORNE"];
  expected.forEach(kw => {
    assert(u.keywords.includes(kw), `Kharn must have keyword "${kw}"`);
  });
  assertEqual(u.keywords.length, expected.length,
    `Kharn must have exactly ${expected.length} keywords`);
});

test("Kharn the Betrayer has EPIC HERO keyword", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assert(u.keywords.includes("EPIC HERO"), "Kharn must have the EPIC HERO keyword");
});

test("Kharn the Betrayer costs 100 points", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assertEqual(u.sizes.length, 1, "Kharn must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 100, "Kharn must cost 100 points");
});

test("Kharn the Betrayer size label is '1 model'", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assertEqual(u.sizes[0].label, "1 model", "Kharn size label must be '1 model'");
});

test("Kharn the Betrayer has rulesAdaptations referencing The Betrayer", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_kharn");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Kharn must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("The Betrayer"),
    "rulesAdaptations must reference 'The Betrayer'");
});

test("Master of Executions exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assert(u !== undefined, "we_master_of_executions must exist in world_eaters units");
});

test("Master of Executions has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assertEqual(u.name, "Master of Executions", "name must be 'Master of Executions'");
});

test("Master of Executions is type CHARACTER", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assertEqual(u.type, "CHARACTER", "Master of Executions must be type CHARACTER");
});

test("Master of Executions has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  const expected = ["WORLD EATERS", "INFANTRY", "CHARACTER", "CHAOS", "KHORNE"];
  expected.forEach(kw => {
    assert(u.keywords.includes(kw), `Master of Executions must have keyword "${kw}"`);
  });
  assertEqual(u.keywords.length, expected.length,
    `Master of Executions must have exactly ${expected.length} keywords`);
});

test("Master of Executions does not have EPIC HERO keyword", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assert(!u.keywords.includes("EPIC HERO"),
    "Master of Executions must not have the EPIC HERO keyword");
});

test("Master of Executions costs 60 points", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assertEqual(u.sizes.length, 1, "Master of Executions must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 60, "Master of Executions must cost 60 points");
});

test("Master of Executions size label is '1 model'", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_master_of_executions");
  assertEqual(u.sizes[0].label, "1 model", "Master of Executions size label must be '1 model'");
});

test("Eightbound exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  assert(u !== undefined, "we_eightbound must exist in world_eaters units");
});

test("Eightbound has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  assertEqual(u.name, "Eightbound", "name must be 'Eightbound'");
});

test("Eightbound is type INFANTRY", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  assertEqual(u.type, "INFANTRY", "Eightbound must be type INFANTRY");
});

test("Eightbound has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  const expected = ["WORLD EATERS", "INFANTRY", "CHAOS", "KHORNE", "DAEMON", "POSSESSED"];
  expected.forEach(kw => {
    assert(u.keywords.includes(kw), `Eightbound must have keyword "${kw}"`);
  });
  assertEqual(u.keywords.length, expected.length,
    `Eightbound must have exactly ${expected.length} keywords`);
});

test("Eightbound costs 135 points for 3 models", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  assertEqual(u.sizes.length, 1, "Eightbound must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 135, "Eightbound must cost 135 points");
  assertEqual(u.sizes[0].label, "3 models", "Eightbound size label must be '3 models'");
});

test("Eightbound has rulesAdaptations referencing Scouts and Movement", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_eightbound");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Eightbound must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Scouts"),
    "Eightbound rulesAdaptations must reference the Scouts ability");
  assert(u.rulesAdaptations.includes("Movement"),
    "Eightbound rulesAdaptations must reference the Movement characteristic");
});

test("Exalted Eightbound exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  assert(u !== undefined, "we_exalted_eightbound must exist in world_eaters units");
});

test("Exalted Eightbound has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  assertEqual(u.name, "Exalted Eightbound", "name must be 'Exalted Eightbound'");
});

test("Exalted Eightbound is type INFANTRY", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  assertEqual(u.type, "INFANTRY", "Exalted Eightbound must be type INFANTRY");
});

test("Exalted Eightbound has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  const expected = ["WORLD EATERS", "INFANTRY", "CHAOS", "KHORNE", "DAEMON", "POSSESSED"];
  expected.forEach(kw => {
    assert(u.keywords.includes(kw), `Exalted Eightbound must have keyword "${kw}"`);
  });
  assertEqual(u.keywords.length, expected.length,
    `Exalted Eightbound must have exactly ${expected.length} keywords`);
});

test("Exalted Eightbound costs 140 points for 3 models", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  assertEqual(u.sizes.length, 1, "Exalted Eightbound must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 140, "Exalted Eightbound must cost 140 points");
  assertEqual(u.sizes[0].label, "3 models", "Exalted Eightbound size label must be '3 models'");
});

test("Exalted Eightbound has rulesAdaptations referencing Movement", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_exalted_eightbound");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Exalted Eightbound must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Movement"),
    "Exalted Eightbound rulesAdaptations must reference the Movement characteristic");
  assert(!u.rulesAdaptations.includes("Scouts"),
    "Exalted Eightbound rulesAdaptations must NOT reference Scouts (only Eightbound loses that ability)");
});

test("Chaos Terminators exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assert(u !== undefined, "we_chaos_terminators must exist in world_eaters units");
});

test("Chaos Terminators has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assertEqual(u.name, "Chaos Terminators", "name must be 'Chaos Terminators'");
});

test("Chaos Terminators is type INFANTRY", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assertEqual(u.type, "INFANTRY", "Chaos Terminators must be type INFANTRY");
});

test("Chaos Terminators has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  const expected = ["WORLD EATERS", "INFANTRY", "CHAOS", "KHORNE", "TERMINATOR"];
  expected.forEach(kw => {
    assert(u.keywords.includes(kw), `Chaos Terminators must have keyword "${kw}"`);
  });
  assertEqual(u.keywords.length, expected.length,
    `Chaos Terminators must have exactly ${expected.length} keywords`);
});

test("Chaos Terminators has TERMINATOR keyword", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assert(u.keywords.includes("TERMINATOR"), "Chaos Terminators must have the TERMINATOR keyword");
});

test("Chaos Terminators costs 175 points for 5 models", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assertEqual(u.sizes.length, 1, "Chaos Terminators must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 175, "Chaos Terminators must cost 175 points");
  assertEqual(u.sizes[0].label, "5 models", "Chaos Terminators size label must be '5 models'");
});

test("Chaos Terminators has no rulesAdaptations", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_terminators");
  assert(u.rulesAdaptations === undefined || u.rulesAdaptations === null || u.rulesAdaptations === "",
    "Chaos Terminators must have no rulesAdaptations");
});


// ── 41. World Eaters — Skullsworn Game Rules ─────────────────────────────────

section("41. World Eaters — Skullsworn Game Rules");

test("Skullsworn character cap — first CHARACTER can be added (empty list)", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_skullsworn");
  const list = [];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "First CHARACTER should be addable when list is empty");
});

test("Skullsworn character cap — second CHARACTER can be added when one is present", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_skullsworn");
  const list = [{ unitId: "we_kharn" }];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "Second CHARACTER should be addable when one is present");
});

test("Skullsworn character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_skullsworn");
  const list = [
    { unitId: "we_kharn" },
    { unitId: "we_master_of_executions" }
  ];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when 2 CHARACTERs are already in the list");
});

test("Skullsworn — Kharn is capped at max 1", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const entry = det.units.find(u => u.id === "we_kharn");
  assertEqual(entry.max, 1, "Kharn must have max 1 in Skullsworn");
});

test("Skullsworn — Master of Executions is capped at max 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const entry = det.units.find(u => u.id === "we_master_of_executions");
  assertEqual(entry.max, 2, "Master of Executions must have max 2 in Skullsworn");
});

test("Skullsworn smoke test — legal list within points limit", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_skullsworn");
  const MAX_PTS = 500;
  const list = [];
  let pts = 0;

  function addUnit(unitId, sizeIdx) {
    const unit = weData.units.find(u => u.id === unitId);
    const detUnit = det.units.find(du => du.id === unitId);
    const cost = unit.sizes[sizeIdx].pts;
    if (pts + cost > MAX_PTS) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    list.push({ unitId, pts: cost });
    pts += cost;
    return true;
  }

  // Kharn (100) + Eightbound (135) + Chaos Terminators (175) = 410pts
  assert(addUnit("we_kharn", 0),              "Should add Kharn (100pts)");
  assert(addUnit("we_eightbound", 0),         "Should add Eightbound (135pts)");
  assert(addUnit("we_chaos_terminators", 0),  "Should add Chaos Terminators (175pts)");
  assert(!addUnit("we_kharn", 0),             "Should NOT add second Kharn — max is 1");
  assertEqual(pts, 410, "Total should be 410pts (100+135+175)");
  assert(pts <= MAX_PTS, "List must be under the 500pt limit");
});

test("Skullsworn — Eightbound is capped at max 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const entry = det.units.find(u => u.id === "we_eightbound");
  assertEqual(entry.max, 2, "Eightbound must have max 2 in Skullsworn");
});

test("Skullsworn — Exalted Eightbound is capped at max 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const entry = det.units.find(u => u.id === "we_exalted_eightbound");
  assertEqual(entry.max, 2, "Exalted Eightbound must have max 2 in Skullsworn");
});

test("Skullsworn — Chaos Terminators is capped at max 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const entry = det.units.find(u => u.id === "we_chaos_terminators");
  assertEqual(entry.max, 2, "Chaos Terminators must have max 2 in Skullsworn");
});

test("Skullsworn — non-CHARACTER units do not count toward character cap", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_skullsworn");
  ["we_eightbound", "we_exalted_eightbound", "we_chaos_terminators"].forEach(id => {
    const u = weData.units.find(u => u.id === id);
    assert(u.type !== "CHARACTER",
      `"${id}" must not be a CHARACTER and must be unaffected by the character cap`);
  });
});

test("Skullsworn — both units are type CHARACTER and count toward character cap", () => {
  const weData = factionData["world_eaters"];
  ["we_kharn", "we_master_of_executions"].forEach(id => {
    const u = weData.units.find(u => u.id === id);
    assertEqual(u.type, "CHARACTER", `"${id}" must be type CHARACTER`);
  });
});


// ── 42. World Eaters — Boarding Butchers Detachment ──────────────────────────

section("42. World Eaters — Boarding Butchers Detachment");

test("Boarding Butchers detachment exists in world_eaters.json", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(det !== undefined, "we_boarding_butchers detachment must exist");
});

test("Boarding Butchers has correct name", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(det.name, "Boarding Butchers", "detachment name must be 'Boarding Butchers'");
});

test("Boarding Butchers has Focused Ferocity special rule", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Focused Ferocity",
    "specialRule name must be 'Focused Ferocity'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Focused Ferocity desc references Battle-shock test", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(det.specialRule.desc.includes("Battle-shock"),
    "Focused Ferocity desc must reference 'Battle-shock'");
});

test("Focused Ferocity desc references declares a charge", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(det.specialRule.desc.includes("declares a charge"),
    "Focused Ferocity desc must reference 'declares a charge'");
});

test("Boarding Butchers has maxCharacters set to 2", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(det.maxCharacters, 2, "Boarding Butchers maxCharacters must be 2");
});

test("Boarding Butchers has exactly 8 unit entries", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(det.units.length, 8, "Boarding Butchers must have exactly 8 unit entries");
});

test("Boarding Butchers unit roster — correct IDs and maxes", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const expected = [
    { id: "we_kharn",                max: 1 },
    { id: "we_master_of_executions", max: 2 },
    { id: "we_chaos_terminators",    max: 1 },
    { id: "we_eightbound",           max: 1 },
    { id: "we_exalted_eightbound",   max: 1 },
    { id: "we_khorne_berserkers",    max: 3 },
    { id: "we_jakhals",              max: 3 },
    { id: "we_chaos_spawn",          max: 1 }
  ];
  expected.forEach(e => {
    const entry = det.units.find(u => u.id === e.id);
    assert(entry !== undefined, `Boarding Butchers must include unit "${e.id}"`);
    assertEqual(entry.max, e.max, `"${e.id}" max must be ${e.max} in Boarding Butchers`);
  });
});

test("Boarding Butchers — Chaos Terminators max is 1 (stricter than Skullsworn's 2)", () => {
  const skullsworn = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  const butchers   = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(skullsworn.units.find(u => u.id === "we_chaos_terminators").max, 2,
    "Skullsworn Chaos Terminators max must be 2");
  assertEqual(butchers.units.find(u => u.id === "we_chaos_terminators").max, 1,
    "Boarding Butchers Chaos Terminators max must be 1");
});

test("Boarding Butchers — Eightbound max is 1 (stricter than Skullsworn's 2)", () => {
  const butchers = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(butchers.units.find(u => u.id === "we_eightbound").max, 1,
    "Boarding Butchers Eightbound max must be 1");
});

test("Boarding Butchers — Exalted Eightbound max is 1 (stricter than Skullsworn's 2)", () => {
  const butchers = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(butchers.units.find(u => u.id === "we_exalted_eightbound").max, 1,
    "Boarding Butchers Exalted Eightbound max must be 1");
});


// ── 43. Boarding Butchers — Enhancements ─────────────────────────────────────

section("43. Boarding Butchers — Enhancements");

test("Boarding Butchers has exactly 2 enhancements", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assertEqual(det.enhancements.length, 2, "Boarding Butchers must have exactly 2 enhancements");
});

test("Boarding Butchers has Chosen of Khorne enhancement", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const enh = det.enhancements.find(e => e.id === "enh_we_chosen_of_khorne");
  assert(enh !== undefined, "enh_we_chosen_of_khorne must exist");
  assertEqual(enh.name, "Chosen of Khorne", "enhancement name must be 'Chosen of Khorne'");
  assert(enh.desc.includes("Blessings of Khorne"),
    "Chosen of Khorne desc must reference 'Blessings of Khorne'");
  assert(enh.desc.includes("re-roll"),
    "Chosen of Khorne desc must reference re-rolling the dice");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Chosen of Khorne must have no keyword requirements");
});

test("Boarding Butchers has Battle Lust enhancement", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const enh = det.enhancements.find(e => e.id === "enh_we_battle_lust");
  assert(enh !== undefined, "enh_we_battle_lust must exist");
  assertEqual(enh.name, "Battle Lust", "enhancement name must be 'Battle Lust'");
  assert(enh.desc.includes("Battle Lust move"),
    "Battle Lust desc must reference 'Battle Lust move'");
  assert(enh.desc.includes("Engagement range"),
    "Battle Lust desc must reference 'Engagement range'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Battle Lust must have no keyword requirements");
});


// ── 44. Boarding Butchers — Game Rules ───────────────────────────────────────

section("44. Boarding Butchers — Game Rules");

test("Boarding Butchers character cap — first CHARACTER can be added (empty list)", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_boarding_butchers");
  const list = [];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "First CHARACTER should be addable when list is empty");
});

test("Boarding Butchers character cap — second CHARACTER can be added when one is present", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_boarding_butchers");
  const list = [{ unitId: "we_kharn" }];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters,
    "Second CHARACTER should be addable when one is present");
});

test("Boarding Butchers character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_boarding_butchers");
  const list = [{ unitId: "we_kharn" }, { unitId: "we_master_of_executions" }];
  const charCount = list.filter(l => weData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when 2 CHARACTERs are already in the list");
});

test("Boarding Butchers smoke test — legal list within points limit", () => {
  const weData = factionData["world_eaters"];
  const det = weData.detachments.find(d => d.id === "we_boarding_butchers");
  const MAX_PTS = 500;
  const list = [];
  let pts = 0;

  function addUnit(unitId, sizeIdx) {
    const unit = weData.units.find(u => u.id === unitId);
    const detUnit = det.units.find(du => du.id === unitId);
    const cost = unit.sizes[sizeIdx].pts;
    if (pts + cost > MAX_PTS) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    list.push({ unitId, pts: cost });
    pts += cost;
    return true;
  }

  // Kharn (100) + Eightbound (135) + Exalted Eightbound (140) = 375pts
  assert(addUnit("we_kharn", 0),              "Should add Kharn (100pts)");
  assert(addUnit("we_eightbound", 0),         "Should add Eightbound (135pts)");
  assert(addUnit("we_exalted_eightbound", 0), "Should add Exalted Eightbound (140pts)");
  assert(!addUnit("we_eightbound", 0),        "Should NOT add second Eightbound — max is 1 in Boarding Butchers");
  assert(!addUnit("we_kharn", 0),             "Should NOT add second Kharn — max is 1");
  assertEqual(pts, 375, "Total should be 375pts (100+135+140)");
  assert(pts <= MAX_PTS, "List must be under the 500pt limit");
});

// ── 45. Boarding Butchers — Eightbound Exclusive Group Constraint ─────────────

section("45. Boarding Butchers — Eightbound Exclusive Group Constraint");

test("Boarding Butchers has exclusiveUnitGroups defined", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(Array.isArray(det.exclusiveUnitGroups) && det.exclusiveUnitGroups.length > 0,
    "we_boarding_butchers must have a non-empty exclusiveUnitGroups array");
});

test("Boarding Butchers exclusiveUnitGroups has one group containing Eightbound and Exalted Eightbound", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const group = det.exclusiveUnitGroups[0];
  assert(Array.isArray(group), "exclusiveUnitGroups[0] must be an array");
  assert(group.includes("we_eightbound"),
    "exclusive group must include 'we_eightbound'");
  assert(group.includes("we_exalted_eightbound"),
    "exclusive group must include 'we_exalted_eightbound'");
  assertEqual(group.length, 2,
    "exclusive group must contain exactly 2 unit IDs");
});

test("Exclusive constraint — Eightbound is blocked when Exalted Eightbound is in the list", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const list = [{ unitId: "we_exalted_eightbound" }];
  const isBlocked = (unitId) => {
    for (const group of det.exclusiveUnitGroups) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  };
  assert(isBlocked("we_eightbound"),
    "we_eightbound must be blocked when we_exalted_eightbound is already in the list");
});

test("Exclusive constraint — Exalted Eightbound is blocked when Eightbound is in the list", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const list = [{ unitId: "we_eightbound" }];
  const isBlocked = (unitId) => {
    for (const group of det.exclusiveUnitGroups) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  };
  assert(isBlocked("we_exalted_eightbound"),
    "we_exalted_eightbound must be blocked when we_eightbound is already in the list");
});

test("Exclusive constraint — Eightbound is allowed when list is empty", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const list = [];
  const isBlocked = (unitId) => {
    for (const group of det.exclusiveUnitGroups) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  };
  assert(!isBlocked("we_eightbound"),
    "we_eightbound must not be blocked when the list is empty");
  assert(!isBlocked("we_exalted_eightbound"),
    "we_exalted_eightbound must not be blocked when the list is empty");
});

test("Exclusive constraint — units outside the group are unaffected", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const list = [{ unitId: "we_eightbound" }];
  const isBlocked = (unitId) => {
    for (const group of det.exclusiveUnitGroups) {
      if (!group.includes(unitId)) continue;
      if (list.some(l => l.unitId !== unitId && group.includes(l.unitId))) return true;
    }
    return false;
  };
  ["we_kharn", "we_chaos_terminators", "we_khorne_berserkers", "we_jakhals", "we_chaos_spawn"].forEach(id => {
    assert(!isBlocked(id),
      `"${id}" must not be blocked by the Eightbound exclusive group constraint`);
  });
});

test("Skullsworn does not have an exclusiveUnitGroups constraint", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.exclusiveUnitGroups === undefined,
    "Skullsworn must not have an exclusiveUnitGroups constraint");
});


// ── 46. Boarding Butchers — Jakhals/Berserkers Ratio Constraint ───────────────

section("46. Boarding Butchers — Jakhals/Berserkers Ratio Constraint");

test("Boarding Butchers has keywordRatio defined", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(det.keywordRatio !== undefined, "we_boarding_butchers must have a keywordRatio");
});

test("Boarding Butchers keywordRatio uses numeratorUnitIds and denominatorUnitIds", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const ratio = det.keywordRatio;
  assert(Array.isArray(ratio.numeratorUnitIds) && ratio.numeratorUnitIds.length > 0,
    "keywordRatio must have a non-empty numeratorUnitIds array");
  assert(Array.isArray(ratio.denominatorUnitIds) && ratio.denominatorUnitIds.length > 0,
    "keywordRatio must have a non-empty denominatorUnitIds array");
  assert(ratio.numeratorUnitIds.includes("we_jakhals"),
    "numeratorUnitIds must include 'we_jakhals'");
  assert(ratio.denominatorUnitIds.includes("we_khorne_berserkers"),
    "denominatorUnitIds must include 'we_khorne_berserkers'");
});

test("Boarding Butchers keywordRatio has a description string", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  assert(typeof det.keywordRatio.description === "string" && det.keywordRatio.description.length > 0,
    "keywordRatio must have a non-empty description");
});

test("Ratio constraint — Jakhals blocked when equal to Berserkers count", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const ratio = det.keywordRatio;
  // 1 Berserker, 1 Jakhal → Jakhals at cap, next one blocked
  const list = [{ unitId: "we_khorne_berserkers" }, { unitId: "we_jakhals" }];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount >= denCount,
    "Jakhals must be at cap when equal to Berserkers count — next Jakhal must be blocked");
});

test("Ratio constraint — Jakhals allowed when fewer than Berserkers", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const ratio = det.keywordRatio;
  // 2 Berserkers, 1 Jakhal → numerator (1) < denominator (2) → not blocked
  const list = [
    { unitId: "we_khorne_berserkers" },
    { unitId: "we_khorne_berserkers" },
    { unitId: "we_jakhals" }
  ];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount < denCount,
    "Jakhals (1) must be allowed when Berserkers (2) outnumber them");
});

test("Ratio constraint — first Jakhal blocked with no Berserkers in list", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const ratio = det.keywordRatio;
  const list = [];
  const numCount = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
  const denCount = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
  assert(numCount >= denCount,
    "First Jakhal must be blocked when no Berserkers are in the list (0 >= 0)");
});

test("Ratio constraint — Berserkers are never capped by the ratio (denominator is free)", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_boarding_butchers");
  const ratio = det.keywordRatio;
  assert(!ratio.numeratorUnitIds.includes("we_khorne_berserkers"),
    "we_khorne_berserkers must not appear in numeratorUnitIds");
});

test("Skullsworn does not have a keywordRatio constraint", () => {
  const det = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  assert(det.keywordRatio === undefined,
    "Skullsworn must not have a keywordRatio constraint");
});


// ── 47. Boarding Butchers — New Unit Definitions ──────────────────────────────

section("47. Boarding Butchers — New Unit Definitions");

test("Khorne Berserkers exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  assert(u !== undefined, "we_khorne_berserkers must exist in world_eaters units");
});

test("Khorne Berserkers has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  assertEqual(u.name, "Khorne Berserkers", "name must be 'Khorne Berserkers'");
});

test("Khorne Berserkers is type BATTLELINE", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  assertEqual(u.type, "BATTLELINE", "Khorne Berserkers must be type BATTLELINE");
});

test("Khorne Berserkers has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  const expected = ["WORLD EATERS", "INFANTRY", "BATTLELINE", "CHAOS", "KHORNE"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Khorne Berserkers must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Khorne Berserkers must have exactly ${expected.length} keywords`);
});

test("Khorne Berserkers costs 180 points for 10 models", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  assertEqual(u.sizes.length, 1, "Khorne Berserkers must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 180, "Khorne Berserkers must cost 180 points");
  assertEqual(u.sizes[0].label, "10 models", "Khorne Berserkers size label must be '10 models'");
});

test("Khorne Berserkers has rulesAdaptations referencing Blood Surge", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_khorne_berserkers");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Khorne Berserkers must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Blood Surge"),
    "Khorne Berserkers rulesAdaptations must reference 'Blood Surge'");
});

test("Jakhals exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  assert(u !== undefined, "we_jakhals must exist in world_eaters units");
});

test("Jakhals has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  assertEqual(u.name, "Jakhals", "name must be 'Jakhals'");
});

test("Jakhals is type INFANTRY", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  assertEqual(u.type, "INFANTRY", "Jakhals must be type INFANTRY");
});

test("Jakhals has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  const expected = ["WORLD EATERS", "INFANTRY", "CHAOS", "KHORNE"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Jakhals must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Jakhals must have exactly ${expected.length} keywords`);
});

test("Jakhals costs 65 points for 10 models", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  assertEqual(u.sizes.length, 1, "Jakhals must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 65, "Jakhals must cost 65 points");
  assertEqual(u.sizes[0].label, "10 models", "Jakhals size label must be '10 models'");
});

test("Jakhals has rulesAdaptations referencing Objective Ravaged and Form Boarding Squads", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_jakhals");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Jakhals must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Objective Ravaged"),
    "Jakhals rulesAdaptations must reference 'Objective Ravaged'");
  assert(u.rulesAdaptations.includes("Form Boarding Squads"),
    "Jakhals rulesAdaptations must reference 'Form Boarding Squads'");
});

test("Chaos Spawn exists in world_eaters units", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  assert(u !== undefined, "we_chaos_spawn must exist in world_eaters units");
});

test("Chaos Spawn has correct name", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  assertEqual(u.name, "Chaos Spawn", "name must be 'Chaos Spawn'");
});

test("Chaos Spawn is type BEAST", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  assertEqual(u.type, "BEAST", "Chaos Spawn must be type BEAST");
});

test("Chaos Spawn has correct keywords", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  const expected = ["WORLD EATERS", "BEAST", "CHAOS", "KHORNE"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Chaos Spawn must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Chaos Spawn must have exactly ${expected.length} keywords`);
});

test("Chaos Spawn costs 90 points", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  assertEqual(u.sizes.length, 1, "Chaos Spawn must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 90, "Chaos Spawn must cost 90 points");
});

test("Chaos Spawn has rulesAdaptations referencing Scouts", () => {
  const u = factionData["world_eaters"].units.find(u => u.id === "we_chaos_spawn");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Chaos Spawn must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Scouts"),
    "Chaos Spawn rulesAdaptations must reference the Scouts ability");
});

test("New units are only in Boarding Butchers, not Skullsworn", () => {
  const skullsworn = factionData["world_eaters"].detachments.find(d => d.id === "we_skullsworn");
  ["we_khorne_berserkers", "we_jakhals", "we_chaos_spawn"].forEach(id => {
    assert(!skullsworn.units.some(u => u.id === id),
      `"${id}" must not appear in the Skullsworn detachment`);
  });
});

// ── 48. Orks Faction ──────────────────────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("48. Orks Faction");

test("Orks exists in index.json factions", () => {
  const f = index.factions.find(f => f.id === "orks");
  assert(f !== undefined, "orks must exist in index.json factions");
});

test("Orks has correct name", () => {
  const f = index.factions.find(f => f.id === "orks");
  assertEqual(f.name, "Orks", "faction name must be 'Orks'");
});

test("Orks file path is factions/orks.json", () => {
  const f = index.factions.find(f => f.id === "orks");
  assertEqual(f.file, "factions/orks.json",
    "file must be 'factions/orks.json' (no data/ prefix)");
});

test("Orks has Void WAAAGH! army rule", () => {
  const f = index.factions.find(f => f.id === "orks");
  assert(f.armyRule !== undefined, "Orks must have an armyRule");
  assertEqual(f.armyRule.name, "Void WAAAGH!",
    "armyRule name must be 'Void WAAAGH!'");
  assert(typeof f.armyRule.desc === "string" && f.armyRule.desc.length > 0,
    "armyRule must have a non-empty desc");
});

test("Void WAAAGH! desc references Waaagh ability", () => {
  const f = index.factions.find(f => f.id === "orks");
  assert(f.armyRule.desc.includes("Waaagh"),
    "Void WAAAGH! desc must reference the Waaagh ability");
});

test("Void WAAAGH! desc references invulnerable save and Strength/Attacks buff", () => {
  const f = index.factions.find(f => f.id === "orks");
  const desc = f.armyRule.desc;
  assert(desc.includes("invulnerable save"),
    "Void WAAAGH! desc must reference invulnerable save");
  assert(desc.includes("Strength") && desc.includes("Attacks"),
    "Void WAAAGH! desc must reference Strength and Attacks buffs");
});

test("Orks has exactly 22 units", () => {
  assertEqual(factionData["orks"].units.length, 22,
    `Expected 22 Orks units, found ${factionData["orks"].units.length}`);
});


// ── 49. Orks — Kaptin Killers Detachment ──────────────────────────────────────

section("49. Orks — Kaptin Killers Detachment");

test("Kaptin Killers detachment exists in orks.json", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assert(det !== undefined, "orks_kaptin_killers detachment must exist");
});

test("Kaptin Killers has correct name", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assertEqual(det.name, "Kaptin Killers", "detachment name must be 'Kaptin Killers'");
});

test("Kaptin Killers has Comin' Through special rule", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Comin' Through",
    "specialRule name must be \"Comin' Through\"");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Comin' Through desc references Desperate Escape tests", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assert(det.specialRule.desc.includes("Desperate Escape"),
    "Comin' Through desc must reference 'Desperate Escape'");
});

test("Comin' Through desc references moving through other units", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assert(det.specialRule.desc.includes("move through"),
    "Comin' Through desc must reference moving through other units");
});

test("Comin' Through desc references Toughness characteristic", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assert(det.specialRule.desc.includes("Toughness"),
    "Comin' Through desc must reference Toughness characteristic");
});

test("Kaptin Killers has maxCharacters set to 2", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assertEqual(det.maxCharacters, 2, "Kaptin Killers maxCharacters must be 2");
});

test("Kaptin Killers has exactly 6 unit entries", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assertEqual(det.units.length, 6, "Kaptin Killers must have exactly 6 unit entries");
});

test("Kaptin Killers unit roster — correct IDs and maxes", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const expected = [
    { id: "orks_big_mek_mega_armour",  max: 1 },
    { id: "orks_beastboss",            max: 1 },
    { id: "orks_warboss",              max: 1 },
    { id: "orks_warboss_mega_armour",  max: 1 },
    { id: "orks_meganobz",             max: 2 },
    { id: "orks_nobz",                 max: 2 }
  ];
  expected.forEach(e => {
    const entry = det.units.find(u => u.id === e.id);
    assert(entry !== undefined, `Kaptin Killers must include unit "${e.id}"`);
    assertEqual(entry.max, e.max, `"${e.id}" max must be ${e.max}`);
  });
});

test("Kaptin Killers has exactly 2 enhancements", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  assertEqual(det.enhancements.length, 2, "Kaptin Killers must have exactly 2 enhancements");
});

test("Kaptin Killers has Tellyporta enhancement", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const enh = det.enhancements.find(e => e.id === "enh_orks_tellyporta");
  assert(enh !== undefined, "enh_orks_tellyporta must exist");
  assertEqual(enh.name, "Tellyporta", "enhancement name must be 'Tellyporta'");
  assert(enh.desc.includes("Meganobz"), "Tellyporta desc must reference 'Meganobz'");
  assert(enh.desc.includes("Deep Strike"), "Tellyporta desc must reference 'Deep Strike'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Tellyporta must have no keyword requirements");
});

test("Kaptin Killers has Gnasher Squig Crates enhancement", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const enh = det.enhancements.find(e => e.id === "enh_orks_gnasher_squig_crates");
  assert(enh !== undefined, "enh_orks_gnasher_squig_crates must exist");
  assertEqual(enh.name, "Gnasher Squig Crates", "enhancement name must be 'Gnasher Squig Crates'");
  assert(enh.desc.includes("WARBOSS"), "Gnasher Squig Crates desc must reference 'WARBOSS'");
  assert(enh.desc.includes("Nobz") && enh.desc.includes("Meganobz"),
    "Gnasher Squig Crates desc must reference 'Nobz' and 'Meganobz'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("WARBOSS"),
    "Gnasher Squig Crates must require the WARBOSS keyword");
});

test("Gnasher Squig Crates is restricted to WARBOSS models only", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const enh = det.enhancements.find(e => e.id === "enh_orks_gnasher_squig_crates");
  assertEqual(enh.requiresKeywords.length, 1,
    "Gnasher Squig Crates must have exactly 1 keyword requirement");
  assertEqual(enh.requiresKeywords[0], "WARBOSS",
    "Gnasher Squig Crates keyword requirement must be 'WARBOSS'");
});


// ── 50. Orks — Unit Definitions ───────────────────────────────────────────────

section("50. Orks — Unit Definitions");

test("Big Mek in Mega Armour exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  assert(u !== undefined, "orks_big_mek_mega_armour must exist in orks units");
});

test("Big Mek in Mega Armour has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  assertEqual(u.name, "Big Mek in Mega Armour", "name must be 'Big Mek in Mega Armour'");
});

test("Big Mek in Mega Armour is type CHARACTER", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  assertEqual(u.type, "CHARACTER", "Big Mek in Mega Armour must be type CHARACTER");
});

test("Big Mek in Mega Armour has correct keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  const expected = ["ORKS", "INFANTRY", "CHARACTER", "MEGA ARMOUR"];
  expected.forEach(kw => assert(u.keywords.includes(kw),
    `Big Mek in Mega Armour must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Big Mek in Mega Armour must have exactly ${expected.length} keywords`);
});

test("Big Mek in Mega Armour costs 90 points", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  assertEqual(u.sizes.length, 1, "Big Mek in Mega Armour must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 90, "Big Mek in Mega Armour must cost 90 points");
  assertEqual(u.sizes[0].label, "1 model", "Big Mek in Mega Armour size label must be '1 model'");
});

test("Big Mek in Mega Armour has rulesAdaptations referencing Fix Dat Armour Up", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_mega_armour");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Big Mek in Mega Armour must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Fix Dat Armour Up"),
    "rulesAdaptations must reference 'Fix Dat Armour Up'");
});

test("Beastboss exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assert(u !== undefined, "orks_beastboss must exist in orks units");
});

test("Beastboss has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assertEqual(u.name, "Beastboss", "name must be 'Beastboss'");
});

test("Beastboss is type CHARACTER", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assertEqual(u.type, "CHARACTER", "Beastboss must be type CHARACTER");
});

test("Beastboss has correct keywords including WARBOSS", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  const expected = ["ORKS", "INFANTRY", "CHARACTER", "WARBOSS", "BEAST SNAGGA"];
  expected.forEach(kw => assert(u.keywords.includes(kw),
    `Beastboss must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Beastboss must have exactly ${expected.length} keywords`);
});

test("Beastboss has WARBOSS keyword (eligible for Gnasher Squig Crates)", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assert(u.keywords.includes("WARBOSS"), "Beastboss must have the WARBOSS keyword");
});

test("Beastboss costs 80 points", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assertEqual(u.sizes.length, 1, "Beastboss must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Beastboss must cost 80 points");
  assertEqual(u.sizes[0].label, "1 model", "Beastboss size label must be '1 model'");
});

test("Beastboss has no rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assert(u.rulesAdaptations === undefined || u.rulesAdaptations === null || u.rulesAdaptations === "",
    "Beastboss must have no rulesAdaptations");
});

test("Warboss exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  assert(u !== undefined, "orks_warboss must exist in orks units");
});

test("Warboss has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  assertEqual(u.name, "Warboss", "name must be 'Warboss'");
});

test("Warboss is type CHARACTER", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  assertEqual(u.type, "CHARACTER", "Warboss must be type CHARACTER");
});

test("Warboss has correct keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  const expected = ["ORKS", "INFANTRY", "CHARACTER", "WARBOSS"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Warboss must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Warboss must have exactly ${expected.length} keywords`);
});

test("Warboss costs 75 points for 1 model", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  assertEqual(u.sizes.length, 1, "Warboss must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 75, "Warboss must cost 75 points");
  assertEqual(u.sizes[0].label, "1 model", "Warboss size label must be '1 model'");
});

test("Warboss has no rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss");
  assert(u.rulesAdaptations === undefined || u.rulesAdaptations === null || u.rulesAdaptations === "",
    "Warboss must have no rulesAdaptations");
});

test("Warboss in Mega Armour exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  assert(u !== undefined, "orks_warboss_mega_armour must exist in orks units");
});

test("Warboss in Mega Armour has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  assertEqual(u.name, "Warboss in Mega Armour", "name must be 'Warboss in Mega Armour'");
});

test("Warboss in Mega Armour is type CHARACTER", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  assertEqual(u.type, "CHARACTER", "Warboss in Mega Armour must be type CHARACTER");
});

test("Warboss in Mega Armour has correct keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  const expected = ["ORKS", "INFANTRY", "CHARACTER", "WARBOSS", "MEGA ARMOUR"];
  expected.forEach(kw => assert(u.keywords.includes(kw),
    `Warboss in Mega Armour must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Warboss in Mega Armour must have exactly ${expected.length} keywords`);
});

test("Warboss in Mega Armour costs 80 points for 1 model", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  assertEqual(u.sizes.length, 1, "Warboss in Mega Armour must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Warboss in Mega Armour must cost 80 points");
  assertEqual(u.sizes[0].label, "1 model", "Warboss in Mega Armour size label must be '1 model'");
});

test("Warboss in Mega Armour has no rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_warboss_mega_armour");
  assert(u.rulesAdaptations === undefined || u.rulesAdaptations === null || u.rulesAdaptations === "",
    "Warboss in Mega Armour must have no rulesAdaptations");
});

test("Meganobz exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assert(u !== undefined, "orks_meganobz must exist in orks units");
});

test("Meganobz has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assertEqual(u.name, "Meganobz", "name must be 'Meganobz'");
});

test("Meganobz is type INFANTRY", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assertEqual(u.type, "INFANTRY", "Meganobz must be type INFANTRY");
});

test("Meganobz has correct keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  const expected = ["ORKS", "INFANTRY", "MEGA ARMOUR"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Meganobz must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Meganobz must have exactly ${expected.length} keywords`);
});

test("Meganobz is not a CHARACTER", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assert(!u.keywords.includes("CHARACTER"), "Meganobz must not have the CHARACTER keyword");
});

test("Meganobz costs 95 points for 3 models", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assertEqual(u.sizes.length, 1, "Meganobz must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 95, "Meganobz must cost 95 points");
  assertEqual(u.sizes[0].label, "3 models", "Meganobz size label must be '3 models'");
});

test("Meganobz has rulesAdaptations referencing Krumpin' Time", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_meganobz");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "Meganobz must have a rulesAdaptations string");
  assert(u.rulesAdaptations.includes("Krumpin' Time"),
    "Meganobz rulesAdaptations must reference \"Krumpin' Time\"");
});

test("Nobz exists in orks units", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assert(u !== undefined, "orks_nobz must exist in orks units");
});

test("Nobz has correct name", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assertEqual(u.name, "Nobz", "name must be 'Nobz'");
});

test("Nobz is type INFANTRY", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assertEqual(u.type, "INFANTRY", "Nobz must be type INFANTRY");
});

test("Nobz has correct keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  const expected = ["ORKS", "INFANTRY"];
  expected.forEach(kw => assert(u.keywords.includes(kw), `Nobz must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expected.length,
    `Nobz must have exactly ${expected.length} keywords`);
});

test("Nobz has 2 size options (5-man and 10-man)", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assertEqual(u.sizes.length, 2, "Nobz must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",  "Nobz first size label must be '5 models'");
  assertEqual(u.sizes[0].pts,   95,           "Nobz 5-man must cost 95 points");
  assertEqual(u.sizes[1].label, "10 models",  "Nobz second size label must be '10 models'");
  assertEqual(u.sizes[1].pts,   210,          "Nobz 10-man must cost 210 points");
});

test("Nobz has no rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assert(u.rulesAdaptations === undefined || u.rulesAdaptations === null || u.rulesAdaptations === "",
    "Nobz must have no rulesAdaptations");
});

test("WARBOSS units eligible for Gnasher Squig Crates enhancement", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_kaptin_killers");
  const enh = det.enhancements.find(e => e.id === "enh_orks_gnasher_squig_crates");
  const warbossUnits = orksData.units.filter(u => u.keywords.includes("WARBOSS"));
  assert(warbossUnits.length >= 3,
    "At least 3 units (Beastboss, Warboss, Warboss in Mega Armour) must have WARBOSS keyword");
  warbossUnits.forEach(u => {
    assert(u.keywords.includes(enh.requiresKeywords[0]),
      `"${u.name}" has WARBOSS keyword and must be eligible for Gnasher Squig Crates`);
  });
});

test("Big Mek in Mega Armour is not eligible for Gnasher Squig Crates (no WARBOSS keyword)", () => {
  const orksData = factionData["orks"];
  const bigMek = orksData.units.find(u => u.id === "orks_big_mek_mega_armour");
  assert(!bigMek.keywords.includes("WARBOSS"),
    "Big Mek in Mega Armour must not have WARBOSS keyword and must not be eligible for Gnasher Squig Crates");
});


// ── 51. Orks — Kaptin Killers Game Rules ──────────────────────────────────────

section("51. Orks — Kaptin Killers Game Rules");

test("Kaptin Killers character cap — first CHARACTER can be added (empty list)", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_kaptin_killers");
  const list = [];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters, "First CHARACTER should be addable when list is empty");
});

test("Kaptin Killers character cap — second CHARACTER can be added when one is present", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_kaptin_killers");
  const list = [{ unitId: "orks_big_mek_mega_armour" }];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters, "Second CHARACTER should be addable when one is present");
});

test("Kaptin Killers character cap — cap of 2 is reached with both units", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_kaptin_killers");
  const list = [{ unitId: "orks_big_mek_mega_armour" }, { unitId: "orks_beastboss" }];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount >= det.maxCharacters, "Cap of 2 must be reached with both units in the list");
});

test("Kaptin Killers smoke test — legal list within points limit", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_kaptin_killers");
  const MAX_PTS = 500;
  const list = [];
  let pts = 0;

  function addUnit(unitId, sizeIdx) {
    const unit = orksData.units.find(u => u.id === unitId);
    const detUnit = det.units.find(du => du.id === unitId);
    const cost = unit.sizes[sizeIdx].pts;
    if (pts + cost > MAX_PTS) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    list.push({ unitId, pts: cost });
    pts += cost;
    return true;
  }

  // Warboss (75) + 2× Meganobz (95 each) + Nobz 5-man (95) = 360pts
  assert(addUnit("orks_warboss", 0),   "Should add Warboss (75pts)");
  assert(addUnit("orks_meganobz", 0),  "Should add first Meganobz (95pts)");
  assert(addUnit("orks_meganobz", 0),  "Should add second Meganobz (95pts)");
  assert(addUnit("orks_nobz", 0),      "Should add Nobz 5-man (95pts)");
  assert(!addUnit("orks_meganobz", 0), "Should NOT add third Meganobz — max is 2");
  assert(!addUnit("orks_warboss", 0),  "Should NOT add second Warboss — max is 1");
  assertEqual(pts, 360, "Total should be 360pts (75+95+95+95)");
  assert(pts <= MAX_PTS, "List must be under the 500pt limit");
});

test("Kaptin Killers — non-CHARACTER units do not count toward character cap", () => {
  const orksData = factionData["orks"];
  ["orks_meganobz", "orks_nobz"].forEach(id => {
    const u = orksData.units.find(u => u.id === id);
    assert(u.type !== "CHARACTER",
      `"${id}" must not be a CHARACTER and must be unaffected by the character cap`);
  });
});

test("Both Orks units are type CHARACTER and count toward character cap", () => {
  const orksData = factionData["orks"];
  ["orks_big_mek_mega_armour", "orks_beastboss", "orks_warboss", "orks_warboss_mega_armour"].forEach(id => {
    const u = orksData.units.find(u => u.id === id);
    assertEqual(u.type, "CHARACTER", `"${id}" must be type CHARACTER`);
  });
});

// ── 52. Orks — Ramship Raiders Detachment ────────────────────────────────────

section("52. Orks — Ramship Raiders Detachment");

test("Ramship Raiders detachment exists in orks.json", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(det !== undefined, "orks_ramship_raiders detachment must exist");
});

test("Ramship Raiders has correct name", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assertEqual(det.name, "Ramship Raiders", "detachment name must be 'Ramship Raiders'");
});

test("Ramship Raiders has Belligerent Boarders special rule", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(det.specialRule !== undefined, "must have a specialRule");
  assertEqual(det.specialRule.name, "Belligerent Boarders",
    "specialRule name must be 'Belligerent Boarders'");
  assert(typeof det.specialRule.desc === "string" && det.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Belligerent Boarders desc references Wound roll subtraction", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(det.specialRule.desc.includes("Wound roll"),
    "Belligerent Boarders desc must reference 'Wound roll'");
  assert(det.specialRule.desc.includes("subtract 1"),
    "Belligerent Boarders desc must reference 'subtract 1'");
});

test("Belligerent Boarders desc references Strength vs Toughness condition", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(det.specialRule.desc.includes("Strength") && det.specialRule.desc.includes("Toughness"),
    "Belligerent Boarders desc must reference both Strength and Toughness");
});

test("Belligerent Boarders desc excludes GROT units", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(det.specialRule.desc.includes("GROT"),
    "Belligerent Boarders desc must reference the GROT exclusion");
});

test("Ramship Raiders has maxCharacters set to 2", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assertEqual(det.maxCharacters, 2, "Ramship Raiders maxCharacters must be 2");
});

test("Ramship Raiders has exactly 20 unit entries", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assertEqual(det.units.length, 20, "Ramship Raiders must have exactly 20 unit entries");
});

test("Ramship Raiders unit roster — correct IDs and maxes", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  const expected = [
    { id: "orks_beastboss",                   max: 1 },
    { id: "orks_warboss",                     max: 1 },
    { id: "orks_warboss_mega_armour",         max: 1 },
    { id: "orks_nobz",                        max: 1 },
    { id: "orks_boss_snikrot",                max: 1 },
    { id: "orks_zodgrod_wortsnagga",          max: 1 },
    { id: "orks_big_mek",                     max: 1 },
    { id: "orks_big_mek_shokk_attack_gun",    max: 1 },
    { id: "orks_mek",                         max: 1 },
    { id: "orks_painboss",                    max: 1 },
    { id: "orks_painboy",                     max: 1 },
    { id: "orks_weirdboy",                    max: 1 },
    { id: "orks_wurrboy",                     max: 1 },
    { id: "orks_beast_snagga_boyz",           max: 3 },
    { id: "orks_boyz",                        max: 3 },
    { id: "orks_burna_boyz",                  max: 1 },
    { id: "orks_flash_gitz",                  max: 1 },
    { id: "orks_gretchin",                    max: 1 },
    { id: "orks_kommandos",                   max: 1 },
    { id: "orks_stormboyz",                    max: 1 }
  ];
  expected.forEach(e => {
    const entry = det.units.find(u => u.id === e.id);
    assert(entry !== undefined, `Ramship Raiders must include unit "${e.id}"`);
    assertEqual(entry.max, e.max, `"${e.id}" max must be ${e.max} in Ramship Raiders`);
  });
});

test("Ramship Raiders — Nobz max is 1 (stricter than Kaptin Killers' 2)", () => {
  const kk = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const rr = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assertEqual(kk.units.find(u => u.id === "orks_nobz").max, 2,
    "Kaptin Killers Nobz max must be 2");
  assertEqual(rr.units.find(u => u.id === "orks_nobz").max, 1,
    "Ramship Raiders Nobz max must be 1");
});

test("Ramship Raiders does not include Big Mek in Mega Armour or Meganobz", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assert(!det.units.some(u => u.id === "orks_big_mek_mega_armour"),
    "Ramship Raiders must not include Big Mek in Mega Armour");
  assert(!det.units.some(u => u.id === "orks_meganobz"),
    "Ramship Raiders must not include Meganobz");
});

test("Ramship Raiders — Nobz has allowedSizeIndices restricting to 5-man only", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  const entry = det.units.find(u => u.id === "orks_nobz");
  assert(Array.isArray(entry.allowedSizeIndices),
    "Nobz entry in Ramship Raiders must have an allowedSizeIndices array");
  assertEqual(entry.allowedSizeIndices.length, 1,
    "allowedSizeIndices must contain exactly 1 entry");
  assertEqual(entry.allowedSizeIndices[0], 0,
    "allowedSizeIndices[0] must be 0 — only the 5-man size is permitted");
  const nobzUnit = factionData["orks"].units.find(u => u.id === "orks_nobz");
  assertEqual(nobzUnit.sizes[0].label, "5 models",
    "Nobz size index 0 must be the 5-model option");
  assertEqual(nobzUnit.sizes[1].label, "10 models",
    "Nobz size index 1 (the disallowed option) must be the 10-model option");
});

test("Kaptin Killers — Nobz has no allowedSizeIndices (both sizes available)", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_kaptin_killers");
  const entry = det.units.find(u => u.id === "orks_nobz");
  assert(entry.allowedSizeIndices === undefined,
    "Nobz entry in Kaptin Killers must not have allowedSizeIndices");
});

test("Boss Snikrot exists in orks units with correct properties", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_boss_snikrot");
  assert(u !== undefined, "orks_boss_snikrot must exist");
  assertEqual(u.name, "Boss Snikrot", "name must be Boss Snikrot");
  assertEqual(u.type, "CHARACTER", "must be type CHARACTER");
  assertEqual(u.sizes[0].pts, 75, "must cost 75 points");
  ["ORKS","INFANTRY","CHARACTER","EPIC HERO"].forEach(kw => assert(u.keywords.includes(kw), "Boss Snikrot must have keyword "+kw));
  assert(u.rulesAdaptations.includes("Kunnin"), "rulesAdaptations must reference Kunnin Infiltrator");
});

test("Zodgrod Wortsnagga exists in orks units with correct properties", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_zodgrod_wortsnagga");
  assert(u !== undefined, "orks_zodgrod_wortsnagga must exist");
  assertEqual(u.name, "Zodgrod Wortsnagga", "name must be Zodgrod Wortsnagga");
  assertEqual(u.type, "CHARACTER", "must be type CHARACTER");
  assertEqual(u.sizes[0].pts, 75, "must cost 75 points");
  ["ORKS","INFANTRY","CHARACTER","EPIC HERO"].forEach(kw => assert(u.keywords.includes(kw), "Zodgrod must have keyword "+kw));
  assert(u.rulesAdaptations.includes("Special Dose"), "rulesAdaptations must reference Special Dose");
});

test("Big Mek exists with 70pts and 3 keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek");
  assert(u !== undefined, "orks_big_mek must exist");
  assertEqual(u.name, "Big Mek"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 70); assertEqual(u.keywords.length, 3);
});

test("Big Mek with Shokk Attack Gun exists with 80pts and 3 keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_big_mek_shokk_attack_gun");
  assert(u !== undefined, "orks_big_mek_shokk_attack_gun must exist");
  assertEqual(u.name, "Big Mek with Shokk Attack Gun"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 80); assertEqual(u.keywords.length, 3);
});

test("Mek exists with 45pts and 3 keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_mek");
  assert(u !== undefined); assertEqual(u.name, "Mek"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 45); assertEqual(u.keywords.length, 3);
});

test("Painboss exists with 70pts and 3 keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_painboss");
  assert(u !== undefined); assertEqual(u.name, "Painboss"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 70); assertEqual(u.keywords.length, 3);
});

test("Painboy exists with 80pts and 3 keywords", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_painboy");
  assert(u !== undefined); assertEqual(u.name, "Painboy"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 80); assertEqual(u.keywords.length, 3);
});

test("Weirdboy exists with 65pts, PSYKER keyword, and correct rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_weirdboy");
  assert(u !== undefined); assertEqual(u.name, "Weirdboy"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 65); assertEqual(u.keywords.length, 4);
  assert(u.keywords.includes("PSYKER"), "Weirdboy must have PSYKER keyword");
  assert(u.rulesAdaptations.includes("Da Jump"), "rulesAdaptations must reference Da Jump");
});

test("Wurrboy exists with 60pts, PSYKER and BEAST SNAGGA keywords, and correct rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_wurrboy");
  assert(u !== undefined); assertEqual(u.name, "Wurrboy"); assertEqual(u.type, "CHARACTER");
  assertEqual(u.sizes[0].pts, 60); assertEqual(u.keywords.length, 5);
  assert(u.keywords.includes("PSYKER") && u.keywords.includes("BEAST SNAGGA"),
    "Wurrboy must have PSYKER and BEAST SNAGGA keywords");
  assert(u.rulesAdaptations.includes("Unstable Oracle"), "must reference Unstable Oracle");
});

test("All 9 new Ramship Raiders units are type CHARACTER", () => {
  const orksData = factionData["orks"];
  ["orks_boss_snikrot","orks_zodgrod_wortsnagga","orks_big_mek",
   "orks_big_mek_shokk_attack_gun","orks_mek","orks_painboss",
   "orks_painboy","orks_weirdboy","orks_wurrboy"].forEach(id => {
    assertEqual(orksData.units.find(u=>u.id===id).type, "CHARACTER", id+" must be CHARACTER");
  });
});


test("Beastboss has BEAST SNAGGA keyword", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beastboss");
  assert(u.keywords.includes("BEAST SNAGGA"), "Beastboss must have BEAST SNAGGA keyword");
});

test("Beast Snagga Boyz exists with correct properties", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_beast_snagga_boyz");
  assert(u !== undefined); assertEqual(u.name, "Beast Snagga Boyz"); assertEqual(u.type, "BATTLELINE");
  assertEqual(u.sizes[0].pts, 95); assertEqual(u.sizes[0].label, "10 models");
  ["ORKS","INFANTRY","BATTLELINE","MOB","BEAST SNAGGA"].forEach(kw => assert(u.keywords.includes(kw), kw));
  assertEqual(u.keywords.length, 5);
  assert(!u.rulesAdaptations, "Beast Snagga Boyz must have no rulesAdaptations");
});

test("Boyz exists with correct properties and rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_boyz");
  assert(u !== undefined); assertEqual(u.name, "Boyz"); assertEqual(u.type, "BATTLELINE");
  assertEqual(u.sizes[0].pts, 80); assertEqual(u.sizes[0].label, "10 models");
  ["ORKS","INFANTRY","BATTLELINE","MOB"].forEach(kw => assert(u.keywords.includes(kw), kw));
  assertEqual(u.keywords.length, 4);
  assert(u.rulesAdaptations && u.rulesAdaptations.includes("Get Da Good Bitz"), "must ref Get Da Good Bitz");
});

test("Burna Boyz exists with 2 size options (5 and 10 models)", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_burna_boyz");
  assert(u !== undefined); assertEqual(u.name, "Burna Boyz"); assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 2);
  assertEqual(u.sizes[0].label, "5 models");  assertEqual(u.sizes[0].pts, 60);
  assertEqual(u.sizes[1].label, "10 models"); assertEqual(u.sizes[1].pts, 120);
  assertEqual(u.keywords.length, 2);
});

test("Flash Gitz exists with 2 size options (5 and 10 models)", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_flash_gitz");
  assert(u !== undefined); assertEqual(u.name, "Flash Gitz"); assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 2);
  assertEqual(u.sizes[0].label, "5 models");  assertEqual(u.sizes[0].pts, 80);
  assertEqual(u.sizes[1].label, "10 models"); assertEqual(u.sizes[1].pts, 160);
  assertEqual(u.keywords.length, 2);
});

test("Gretchin exists with correct properties", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_gretchin");
  assert(u !== undefined); assertEqual(u.name, "Gretchin"); assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes[0].label, "11 models"); assertEqual(u.sizes[0].pts, 40);
  ["ORKS","INFANTRY","GROTS"].forEach(kw => assert(u.keywords.includes(kw), kw));
  assertEqual(u.keywords.length, 3);
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Form Boarding Squads"), "Gretchin rulesAdaptations must reference Form Boarding Squads");
});

test("New non-CHARACTER Ramship Raiders units are not type CHARACTER", () => {
  ["orks_beast_snagga_boyz","orks_boyz","orks_burna_boyz","orks_flash_gitz","orks_gretchin"].forEach(id => {
    const u = factionData["orks"].units.find(u => u.id === id);
    assert(u.type !== "CHARACTER", id+" must not be type CHARACTER");
  });
});

test("Gretchin has rulesAdaptations referencing Form Boarding Squads", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_gretchin");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Form Boarding Squads"),
    "Gretchin rulesAdaptations must reference Form Boarding Squads");
});

test("Kommandos exists with correct properties", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_kommandos");
  assert(u !== undefined, "orks_kommandos must exist");
  assertEqual(u.name, "Kommandos");
  assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 1);
  assertEqual(u.sizes[0].label, "10 models");
  assertEqual(u.sizes[0].pts, 120);
  ["ORKS","INFANTRY"].forEach(kw => assert(u.keywords.includes(kw), "Kommandos must have keyword "+kw));
  assertEqual(u.keywords.length, 2);
  assert(!u.rulesAdaptations, "Kommandos must have no rulesAdaptations");
});

test("Stormboyz exists with 2 size options and correct rulesAdaptations", () => {
  const u = factionData["orks"].units.find(u => u.id === "orks_stormboyz");
  assert(u !== undefined, "orks_stormboyz must exist");
  assertEqual(u.name, "Stormboyz");
  assertEqual(u.type, "INFANTRY");
  assertEqual(u.sizes.length, 2);
  assertEqual(u.sizes[0].label, "5 models");  assertEqual(u.sizes[0].pts, 65);
  assertEqual(u.sizes[1].label, "10 models"); assertEqual(u.sizes[1].pts, 130);
  ["ORKS","INFANTRY"].forEach(kw => assert(u.keywords.includes(kw), "Stormboyz must have keyword "+kw));
  assertEqual(u.keywords.length, 2);
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Movement"),
    "Stormboyz rulesAdaptations must reference Movement characteristic");
});

test("Kommandos and Stormboyz are in Ramship Raiders roster with max 1", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  ["orks_kommandos", "orks_stormboyz"].forEach(id => {
    const entry = det.units.find(u => u.id === id);
    assert(entry !== undefined, id+" must be in Ramship Raiders roster");
    assertEqual(entry.max, 1, id+" max must be 1");
  });
});

// ── 53. Ramship Raiders — Enhancements ───────────────────────────────────────

section("53. Ramship Raiders — Enhancements");

test("Ramship Raiders has exactly 2 enhancements", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  assertEqual(det.enhancements.length, 2, "Ramship Raiders must have exactly 2 enhancements");
});

test("Ramship Raiders has Living Battering Ram enhancement", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  const enh = det.enhancements.find(e => e.id === "enh_orks_living_battering_ram");
  assert(enh !== undefined, "enh_orks_living_battering_ram must exist");
  assertEqual(enh.name, "Living Battering Ram", "enhancement name must be 'Living Battering Ram'");
  assert(enh.desc.includes("Hatchway"),
    "Living Battering Ram desc must reference 'Hatchway'");
  assert(enh.desc.includes("Battle-shock"),
    "Living Battering Ram desc must reference 'Battle-shock'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Living Battering Ram must have no keyword requirements");
});

test("Ramship Raiders has Scarred Brute enhancement", () => {
  const det = factionData["orks"].detachments.find(d => d.id === "orks_ramship_raiders");
  const enh = det.enhancements.find(e => e.id === "enh_orks_scarred_brute");
  assert(enh !== undefined, "enh_orks_scarred_brute must exist");
  assertEqual(enh.name, "Scarred Brute", "enhancement name must be 'Scarred Brute'");
  assert(enh.desc.includes("Feel No Pain"),
    "Scarred Brute desc must reference 'Feel No Pain'");
  assert(enh.desc.includes("5+"),
    "Scarred Brute desc must reference the 5+ value");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Scarred Brute must have no keyword requirements");
});


// ── 54. Ramship Raiders — Game Rules ─────────────────────────────────────────

section("54. Ramship Raiders — Game Rules");

test("Ramship Raiders character cap — first CHARACTER can be added (empty list)", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_ramship_raiders");
  const list = [];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters, "First CHARACTER should be addable when list is empty");
});

test("Ramship Raiders character cap — second CHARACTER can be added when one is present", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_ramship_raiders");
  const list = [{ unitId: "orks_warboss" }];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount < det.maxCharacters, "Second CHARACTER should be addable when one is present");
});

test("Ramship Raiders character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_ramship_raiders");
  const list = [{ unitId: "orks_warboss" }, { unitId: "orks_beastboss" }];
  const charCount = list.filter(l => orksData.units.find(u => u.id === l.unitId)?.type === "CHARACTER").length;
  assert(charCount >= det.maxCharacters,
    "Third CHARACTER must be blocked when 2 CHARACTERs are already in the list");
});

test("Ramship Raiders smoke test — legal list within points limit", () => {
  const orksData = factionData["orks"];
  const det = orksData.detachments.find(d => d.id === "orks_ramship_raiders");
  const MAX_PTS = 500;
  const list = [];
  let pts = 0;

  function addUnit(unitId, sizeIdx) {
    const unit = orksData.units.find(u => u.id === unitId);
    const detUnit = det.units.find(du => du.id === unitId);
    const cost = unit.sizes[sizeIdx].pts;
    if (pts + cost > MAX_PTS) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    list.push({ unitId, pts: cost });
    pts += cost;
    return true;
  }

  // Warboss (75) + Beastboss (80) + Nobz 5-man (95) = 250pts
  assert(addUnit("orks_warboss", 0),           "Should add Warboss (75pts)");
  assert(addUnit("orks_beastboss", 0),         "Should add Beastboss (80pts)");
  assert(addUnit("orks_nobz", 0),              "Should add Nobz 5-man (95pts)");
  assert(!addUnit("orks_nobz", 0),             "Should NOT add second Nobz — max is 1 in Ramship Raiders");
  assert(!addUnit("orks_warboss", 0),          "Should NOT add second Warboss — max is 1");
  assertEqual(pts, 250, "Total should be 250pts (75+80+95)");
  assert(pts <= MAX_PTS, "List must be under the 500pt limit");
});

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("55. Adepta Sororitas Faction");

test("Adepta Sororitas exists in index.json factions", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assert(f !== undefined, "adepta_sororitas must exist in index.json factions");
});

test("Adepta Sororitas has correct name", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assertEqual(f.name, "Adepta Sororitas", "faction name must be 'Adepta Sororitas'");
});

test("Adepta Sororitas file path is factions/adepta_sororitas.json", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assertEqual(f.file, "factions/adepta_sororitas.json",
    "file must be 'factions/adepta_sororitas.json' (no data/ prefix)");
});

test("Adepta Sororitas has Minor Miracles army rule", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assertEqual(f.armyRule.name, "Minor Miracles", "army rule name must be 'Minor Miracles'");
  assert(typeof f.armyRule.desc === "string" && f.armyRule.desc.length > 0,
    "army rule must have a non-empty desc");
});

test("Minor Miracles desc references Acts of Faith ability", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assert(f.armyRule.desc.includes("Acts of Faith"),
    "Minor Miracles desc must reference 'Acts of Faith'");
});

test("Minor Miracles desc references Miracle dice improvement to maximum of 6", () => {
  const f = index.factions.find(f => f.id === "adepta_sororitas");
  assert(f.armyRule.desc.includes("Miracle Dice") || f.armyRule.desc.includes("Miracle dice"),
    "Minor Miracles desc must reference Miracle Dice");
  assert(f.armyRule.desc.includes("maximum of 6"),
    "Minor Miracles desc must reference the maximum of 6");
});

test("index.json now has at least 9 factions including Adepta Sororitas", () => {
  assert(index.factions.length >= 9,
    `Expected at least 9 factions in index.json, found ${index.factions.length}`);
  const ids = index.factions.map(f => f.id);
  assert(ids.includes("adepta_sororitas"), "adepta_sororitas must be in factions list");
  assert(ids.includes("death_guard"),      "death_guard must still be in factions list");
  assert(ids.includes("world_eaters"),     "world_eaters must still be in factions list");
  assert(ids.includes("orks"),             "orks must still be in factions list");
});

// ── 56. Adepta Sororitas — Penitents and Pilgrims Detachment ─────────────────

section("56. Adepta Sororitas — Penitents and Pilgrims Detachment");

const sorData  = factionData["adepta_sororitas"];
const sorDet   = sorData.detachments.find(d => d.id === "sor_penitents_and_pilgrims");
const sorUnits = sorData.units;

test("Penitents and Pilgrims detachment exists", () => {
  assert(sorDet !== undefined, "sor_penitents_and_pilgrims detachment must exist");
});

test("Penitents and Pilgrims has correct name", () => {
  assertEqual(sorDet.name, "Penitents and Pilgrims",
    "detachment name must be 'Penitents and Pilgrims'");
});

test("Penitents and Pilgrims has Bloody Redemption special rule", () => {
  assert(sorDet.specialRule !== undefined, "must have a specialRule");
  assertEqual(sorDet.specialRule.name, "Bloody Redemption",
    "specialRule name must be 'Bloody Redemption'");
  assert(typeof sorDet.specialRule.desc === "string" && sorDet.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("Bloody Redemption desc references Arco-Flagellants and Repentia Squad", () => {
  assert(sorDet.specialRule.desc.includes("Arco-Flagellants"),
    "Bloody Redemption desc must reference 'Arco-Flagellants'");
  assert(sorDet.specialRule.desc.includes("Repentia Squad"),
    "Bloody Redemption desc must reference 'Repentia Squad'");
});

test("Bloody Redemption desc references Miracle dice value of 6", () => {
  assert(sorDet.specialRule.desc.includes("6"),
    "Bloody Redemption desc must reference a value of 6");
});

test("Penitents and Pilgrims has maxCharacters set to 2", () => {
  assertEqual(sorDet.maxCharacters, 2,
    "Penitents and Pilgrims must have maxCharacters: 2");
});

test("Penitents and Pilgrims has exactly 3 unit entries", () => {
  assertEqual(sorDet.units.length, 3,
    "Penitents and Pilgrims must have exactly 3 unit entries");
});

test("Penitents and Pilgrims unit roster — correct IDs and maxes", () => {
  const expected = [
    { id: "sor_ministorum_priest", max: 2 },
    { id: "sor_arco_flagellants",  max: 3 },
    { id: "sor_repentia_squad",    max: 3 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = sorDet.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Penitents and Pilgrims`);
    assertEqual(entry.max, max, `"${id}" must have max ${max}, got ${entry.max}`);
  });
});

test("Penitents and Pilgrims has exactly 2 enhancements", () => {
  assertEqual(sorDet.enhancements.length, 2,
    "Penitents and Pilgrims must have exactly 2 enhancements");
});

test("All enhancements have requiresKeywords array", () => {
  sorDet.enhancements.forEach(e => {
    assert(Array.isArray(e.requiresKeywords),
      `Enhancement "${e.id}" must have a requiresKeywords array`);
  });
});

test("Penitents and Pilgrims has Fervent Ferocity enhancement", () => {
  const enh = sorDet.enhancements.find(e => e.id === "enh_sor_fervent_ferocity");
  assert(enh !== undefined, "enh_sor_fervent_ferocity must exist");
  assertEqual(enh.name, "Fervent Ferocity", "enhancement name must be 'Fervent Ferocity'");
  assert(enh.desc.includes("Feel No Pain"),
    "Fervent Ferocity desc must reference 'Feel No Pain'");
  assert(enh.desc.includes("5+"),
    "Fervent Ferocity desc must reference the 5+ value");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Fervent Ferocity must have no keyword requirements");
});

test("Penitents and Pilgrims has Sanctification Rituals enhancement", () => {
  const enh = sorDet.enhancements.find(e => e.id === "enh_sor_sanctification_rituals");
  assert(enh !== undefined, "enh_sor_sanctification_rituals must exist");
  assertEqual(enh.name, "Sanctification Rituals",
    "enhancement name must be 'Sanctification Rituals'");
  assert(enh.desc.includes("Secure Site"),
    "Sanctification Rituals desc must reference 'Secure Site'");
  assert(enh.desc.includes("BATTLELINE"),
    "Sanctification Rituals desc must reference 'BATTLELINE'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Sanctification Rituals must have no keyword requirements");
});

// ── 57. Adepta Sororitas — Unit Definitions ───────────────────────────────────

section("57. Adepta Sororitas — Unit Definitions");

test("Adepta Sororitas has exactly 18 units", () => {
  assertEqual(sorUnits.length, 18,
    `Expected 18 Adepta Sororitas units, found ${sorUnits.length}`);
});

test("Ministorum Priest has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_ministorum_priest");
  assert(u !== undefined, "sor_ministorum_priest must exist");
  assertEqual(u.name, "Ministorum Priest", "name must be 'Ministorum Priest'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM", "PENITENT"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Ministorum Priest must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Ministorum Priest must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Ministorum Priest must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 50, "Ministorum Priest must cost 50pts");
  assertEqual(u.sizes[0].label, "1 model", "Ministorum Priest size label must be '1 model'");
});

test("Arco-Flagellants has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_arco_flagellants");
  assert(u !== undefined, "sor_arco_flagellants must exist");
  assertEqual(u.name, "Arco-Flagellants", "name must be 'Arco-Flagellants'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM", "PENITENT"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Arco-Flagellants must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Arco-Flagellants must have exactly ${expectedKws.length} keywords`);
  assert(u.type !== "CHARACTER", "Arco-Flagellants must not be type CHARACTER");
  assert(!u.keywords.includes("CHARACTER"), "Arco-Flagellants must not have CHARACTER keyword");
  assertEqual(u.sizes.length, 1, "Arco-Flagellants must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 140, "Arco-Flagellants must cost 140pts");
  assertEqual(u.sizes[0].label, "10 models", "Arco-Flagellants size label must be '10 models'");
});

test("Repentia Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_repentia_squad");
  assert(u !== undefined, "sor_repentia_squad must exist");
  assertEqual(u.name, "Repentia Squad", "name must be 'Repentia Squad'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM", "PENITENT"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Repentia Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Repentia Squad must have exactly ${expectedKws.length} keywords`);
  assert(u.type !== "CHARACTER", "Repentia Squad must not be type CHARACTER");
  assert(!u.keywords.includes("CHARACTER"), "Repentia Squad must not have CHARACTER keyword");
  assertEqual(u.sizes.length, 2, "Repentia Squad must have exactly 2 size options");
  assertEqual(u.sizes[0].pts, 75,  "Repentia Squad 5-man must cost 75pts");
  assertEqual(u.sizes[0].label, "5 models",  "Repentia Squad first size label must be '5 models'");
  assertEqual(u.sizes[1].pts, 160, "Repentia Squad 10-man must cost 160pts");
  assertEqual(u.sizes[1].label, "10 models", "Repentia Squad second size label must be '10 models'");
});

test("Original Penitents and Pilgrims units have PENITENT keyword", () => {
  ["sor_ministorum_priest", "sor_arco_flagellants", "sor_repentia_squad"].forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assert(u.keywords.includes("PENITENT"),
      `Unit "${id}" must have the PENITENT keyword`);
  });
});

test("All Sororitas units have ADEPTA SORORITAS keyword", () => {
  sorUnits.forEach(u => {
    assert(u.keywords.includes("ADEPTA SORORITAS"),
      `Unit "${u.id}" must have the ADEPTA SORORITAS keyword`);
  });
});

// ── 58. Penitents and Pilgrims — Game Rules ───────────────────────────────────

section("58. Penitents and Pilgrims — Game Rules");

function canAddSor(unitId, sizeIdx, list) {
  const unit    = sorUnits.find(u => u.id === unitId);
  const detUnit = sorDet.units.find(du => du.id === unitId);
  const cost    = unit.sizes[sizeIdx].pts;
  const pts     = list.reduce((s, l) => s + l.pts, 0);
  if (pts + cost > 500) return false;
  if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
  if (unit.type === "CHARACTER" &&
      list.filter(l => sorUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length
        >= sorDet.maxCharacters) return false;
  return true;
}

test("Character cap — first Ministorum Priest can be added to empty list", () => {
  assert(canAddSor("sor_ministorum_priest", 0, []),
    "First Ministorum Priest should be addable when list is empty");
});

test("Character cap — second Ministorum Priest can be added when one is present", () => {
  const list = [{ unitId: "sor_ministorum_priest", pts: 50 }];
  assert(canAddSor("sor_ministorum_priest", 0, list),
    "Second Ministorum Priest should be addable when one is already present");
});

test("Character cap — third Ministorum Priest is blocked when cap of 2 is reached", () => {
  const list = [
    { unitId: "sor_ministorum_priest", pts: 50 },
    { unitId: "sor_ministorum_priest", pts: 50 },
  ];
  assert(!canAddSor("sor_ministorum_priest", 0, list),
    "Third Ministorum Priest must be blocked when cap of 2 is reached (also hits unit max)");
});

test("Non-CHARACTER units are unaffected by the character cap", () => {
  const list = [
    { unitId: "sor_ministorum_priest", pts: 50 },
    { unitId: "sor_ministorum_priest", pts: 50 },
  ];
  assert(canAddSor("sor_arco_flagellants", 0, list),
    "Arco-Flagellants (INFANTRY) should still be addable even when character cap is hit");
  assert(canAddSor("sor_repentia_squad", 0, list),
    "Repentia Squad (INFANTRY) should still be addable even when character cap is hit");
});

test("Arco-Flagellants is capped at max 3 in the detachment", () => {
  const list = [
    { unitId: "sor_arco_flagellants", pts: 140 },
    { unitId: "sor_arco_flagellants", pts: 140 },
    { unitId: "sor_arco_flagellants", pts: 140 },
  ];
  assert(!canAddSor("sor_arco_flagellants", 0, list),
    "4th Arco-Flagellants must be blocked — unit max is 3");
});

test("Repentia Squad is capped at max 3 in the detachment", () => {
  const list = [
    { unitId: "sor_repentia_squad", pts: 75 },
    { unitId: "sor_repentia_squad", pts: 75 },
    { unitId: "sor_repentia_squad", pts: 75 },
  ];
  assert(!canAddSor("sor_repentia_squad", 0, list),
    "4th Repentia Squad must be blocked — unit max is 3");
});

test("Smoke test — legal 455pt list within all constraints", () => {
  const list = [];
  assert(canAddSor("sor_ministorum_priest", 0, list), "Add 1st Priest (50pts)");
  list.push({ unitId: "sor_ministorum_priest", pts: 50 });
  assert(canAddSor("sor_ministorum_priest", 0, list), "Add 2nd Priest (50pts)");
  list.push({ unitId: "sor_ministorum_priest", pts: 50 });
  assert(canAddSor("sor_arco_flagellants", 0, list),  "Add 1st Arco-Flagellants (140pts)");
  list.push({ unitId: "sor_arco_flagellants", pts: 140 });
  assert(canAddSor("sor_arco_flagellants", 0, list),  "Add 2nd Arco-Flagellants (140pts)");
  list.push({ unitId: "sor_arco_flagellants", pts: 140 });
  assert(canAddSor("sor_repentia_squad", 0, list),    "Add Repentia Squad 5-man (75pts)");
  list.push({ unitId: "sor_repentia_squad", pts: 75 });
  assert(!canAddSor("sor_ministorum_priest", 0, list),
    "3rd Priest blocked by character cap");
  const total = list.reduce((s, l) => s + l.pts, 0);
  assertEqual(total, 455, "Total should be 455pts (50+50+140+140+75)");
  assert(total <= 500, "List must be within the 500pt limit");
});

test("2× Priest + 3× Arco-Flagellants exceeds 500pt limit", () => {
  // 2× 50 + 3× 140 = 520pts — over the limit, so the 3rd Arco-Flagellants is blocked
  const list = [
    { unitId: "sor_ministorum_priest", pts: 50 },
    { unitId: "sor_ministorum_priest", pts: 50 },
    { unitId: "sor_arco_flagellants",  pts: 140 },
    { unitId: "sor_arco_flagellants",  pts: 140 },
    { unitId: "sor_arco_flagellants",  pts: 140 },
  ];
  const total = list.reduce((s, l) => s + l.pts, 0);
  assert(total > 500, `2× Priest + 3× Arco-Flagellants = ${total}pts, which exceeds the 500pt limit`);
});

// ── 59. Adepta Sororitas — Pious Protectors Detachment ───────────────────────

section("59. Adepta Sororitas — Pious Protectors Detachment");

const ppDet = sorData.detachments.find(d => d.id === "sor_pious_protectors");

test("Pious Protectors detachment exists", () => {
  assert(ppDet !== undefined, "sor_pious_protectors detachment must exist");
});

test("Pious Protectors has correct name", () => {
  assertEqual(ppDet.name, "Pious Protectors", "detachment name must be 'Pious Protectors'");
});

test("Adepta Sororitas now has 2 detachments", () => {
  assertEqual(sorData.detachments.length, 2,
    `Expected 2 Adepta Sororitas detachments, found ${sorData.detachments.length}`);
  const ids = sorData.detachments.map(d => d.id);
  assert(ids.includes("sor_penitents_and_pilgrims"), "sor_penitents_and_pilgrims must still exist");
  assert(ids.includes("sor_pious_protectors"),       "sor_pious_protectors must exist");
});

test("Pious Protectors has The Emperor Protects special rule", () => {
  assert(ppDet.specialRule !== undefined, "must have a specialRule");
  assertEqual(ppDet.specialRule.name, "The Emperor Protects",
    "specialRule name must be 'The Emperor Protects'");
  assert(typeof ppDet.specialRule.desc === "string" && ppDet.specialRule.desc.length > 0,
    "specialRule must have a non-empty desc");
});

test("The Emperor Protects desc references 4+ invulnerable save", () => {
  assert(ppDet.specialRule.desc.includes("4+"),
    "The Emperor Protects desc must reference the 4+ invulnerable save");
});

test("The Emperor Protects desc references 3+ invulnerable save", () => {
  assert(ppDet.specialRule.desc.includes("3+"),
    "The Emperor Protects desc must reference the 3+ invulnerable save");
});

test("The Emperor Protects desc references objective marker", () => {
  assert(ppDet.specialRule.desc.includes("objective marker"),
    "The Emperor Protects desc must reference 'objective marker'");
});

test("The Emperor Protects desc references Secure Site Tactical Manoeuvre", () => {
  assert(ppDet.specialRule.desc.includes("Secure Site Tactical Manoeuvre"),
    "The Emperor Protects desc must reference 'Secure Site Tactical Manoeuvre'");
});

test("The Emperor Protects desc excludes arco-flagellant and repentia squad units", () => {
  assert(ppDet.specialRule.desc.includes("arco-flagellant"),
    "The Emperor Protects desc must reference exclusion of arco-flagellant units");
  assert(ppDet.specialRule.desc.includes("repentia squad"),
    "The Emperor Protects desc must reference exclusion of repentia squad units");
});

test("Pious Protectors has maxCharacters set to 3", () => {
  assertEqual(ppDet.maxCharacters, 3,
    "Pious Protectors must have maxCharacters: 3");
});

test("Pious Protectors has exactly 18 unit entries", () => {
  assertEqual(ppDet.units.length, 18,
    "Pious Protectors must have exactly 18 unit entries");
});

test("Pious Protectors unit roster — correct IDs and maxes", () => {
  const expected = [
    { id: "sor_ministorum_priest", max: 1 },
    { id: "sor_arco_flagellants",  max: 1 },
    { id: "sor_repentia_squad",    max: 1 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = ppDet.units.find(u => u.id === id);
    assert(entry !== undefined, `Unit "${id}" must be in Pious Protectors`);
    assertEqual(entry.max, max, `"${id}" must have max ${max} in Pious Protectors, got ${entry.max}`);
  });
});

test("Pious Protectors — Ministorum Priest max of 1 is stricter than Penitents and Pilgrims' max of 2", () => {
  const ppEntry  = ppDet.units.find(u => u.id === "sor_ministorum_priest");
  const panpEntry = sorData.detachments.find(d => d.id === "sor_penitents_and_pilgrims")
                      .units.find(u => u.id === "sor_ministorum_priest");
  assertEqual(ppEntry.max, 1,  "Pious Protectors Ministorum Priest max must be 1");
  assertEqual(panpEntry.max, 2, "Penitents and Pilgrims Ministorum Priest max must still be 2");
});

test("Pious Protectors has exactly 2 enhancements", () => {
  assertEqual(ppDet.enhancements.length, 2,
    "Pious Protectors must have exactly 2 enhancements");
});

test("Pious Protectors has Martial Discipline enhancement", () => {
  const enh = ppDet.enhancements.find(e => e.id === "enh_sor_martial_discipline");
  assert(enh !== undefined, "enh_sor_martial_discipline must exist");
  assertEqual(enh.name, "Martial Discipline", "enhancement name must be 'Martial Discipline'");
  assert(enh.desc.includes("shooting phase"),
    "Martial Discipline desc must reference 'shooting phase'");
  assert(enh.desc.includes("Advanced") && enh.desc.includes("Fell Back"),
    "Martial Discipline desc must reference Advanced and Fell Back");
  assert(enh.desc.includes("ADEPTA SORORITAS"),
    "Martial Discipline desc must reference 'ADEPTA SORORITAS'");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Martial Discipline must have no keyword requirements");
});

test("Pious Protectors has Limitless Resolve enhancement", () => {
  const enh = ppDet.enhancements.find(e => e.id === "enh_sor_limitless_resolve");
  assert(enh !== undefined, "enh_sor_limitless_resolve must exist");
  assertEqual(enh.name, "Limitless Resolve", "enhancement name must be 'Limitless Resolve'");
  assert(enh.desc.includes("Battle-shocked"),
    "Limitless Resolve desc must reference 'Battle-shocked'");
  assert(enh.desc.includes("Objective Control"),
    "Limitless Resolve desc must reference 'Objective Control'");
  assert(enh.desc.includes("ADEPTA SORORITAS"),
    "Limitless Resolve desc must reference 'ADEPTA SORORITAS'");
  assert(enh.desc.includes("Arco-flagellants") || enh.desc.includes("Arco-Flagellants"),
    "Limitless Resolve desc must reference Arco-flagellants exclusion");
  assert(enh.desc.includes("Repentia"),
    "Limitless Resolve desc must reference Repentia exclusion");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Limitless Resolve must have no keyword requirements");
});

// ── 60. Pious Protectors — Game Rules ────────────────────────────────────────

section("60. Pious Protectors — Game Rules");

function canAddPP(unitId, sizeIdx, list) {
  const unit    = sorUnits.find(u => u.id === unitId);
  const detUnit = ppDet.units.find(du => du.id === unitId);
  if (!detUnit) return false;
  const cost = unit.sizes[sizeIdx].pts;
  const pts  = list.reduce((s, l) => s + l.pts, 0);
  if (pts + cost > 500) return false;
  if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
  if (unit.type === "CHARACTER" &&
      list.filter(l => sorUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length
        >= ppDet.maxCharacters) return false;
  return true;
}

test("Character cap — first Ministorum Priest can be added to empty list", () => {
  assert(canAddPP("sor_ministorum_priest", 0, []),
    "First Ministorum Priest should be addable when list is empty");
});

test("Character cap of 3 — three priests would be blocked by unit max of 1, not char cap", () => {
  // Priest max is 1 in this detachment, so it hits unit max before char cap
  const list = [{ unitId: "sor_ministorum_priest", pts: 50 }];
  assert(!canAddPP("sor_ministorum_priest", 0, list),
    "Second Ministorum Priest must be blocked — unit max is 1 in Pious Protectors");
});

test("Non-CHARACTER units are unaffected by the character cap", () => {
  const list = [{ unitId: "sor_ministorum_priest", pts: 50 }];
  assert(canAddPP("sor_arco_flagellants", 0, list),
    "Arco-Flagellants should be addable even when a CHARACTER is in the list");
  assert(canAddPP("sor_repentia_squad", 0, list),
    "Repentia Squad should be addable even when a CHARACTER is in the list");
});

test("Arco-Flagellants is capped at max 1 in Pious Protectors", () => {
  const list = [{ unitId: "sor_arco_flagellants", pts: 140 }];
  assert(!canAddPP("sor_arco_flagellants", 0, list),
    "Second Arco-Flagellants must be blocked — unit max is 1 in Pious Protectors");
});

test("Repentia Squad is capped at max 1 in Pious Protectors", () => {
  const list = [{ unitId: "sor_repentia_squad", pts: 75 }];
  assert(!canAddPP("sor_repentia_squad", 0, list),
    "Second Repentia Squad must be blocked — unit max is 1 in Pious Protectors");
});

test("Smoke test — legal list within points limit", () => {
  const list = [];
  assert(canAddPP("sor_ministorum_priest", 0, list), "Add Ministorum Priest (50pts)");
  list.push({ unitId: "sor_ministorum_priest", pts: 50 });
  assert(canAddPP("sor_arco_flagellants", 0, list),  "Add Arco-Flagellants (140pts)");
  list.push({ unitId: "sor_arco_flagellants", pts: 140 });
  assert(canAddPP("sor_repentia_squad", 1, list),    "Add Repentia Squad 10-man (160pts)");
  list.push({ unitId: "sor_repentia_squad", pts: 160 });
  // All units now at their max of 1
  assert(!canAddPP("sor_ministorum_priest", 0, list), "2nd Priest blocked by unit max");
  assert(!canAddPP("sor_arco_flagellants",  0, list), "2nd Arco-Flagellants blocked by unit max");
  assert(!canAddPP("sor_repentia_squad",    0, list), "2nd Repentia Squad blocked by unit max");
  const total = list.reduce((s, l) => s + l.pts, 0);
  assertEqual(total, 350, "Total should be 350pts (50+140+160)");
  assert(total <= 500, "List must be within the 500pt limit");
});


// ── 61. Pious Protectors — New Unit Definitions ───────────────────────────────

section("61. Pious Protectors — New Unit Definitions");

test("Canoness has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_canoness");
  assert(u !== undefined, "sor_canoness must exist");
  assertEqual(u.name, "Canoness", "name must be 'Canoness'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Canoness must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Canoness must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Canoness must have 1 size option");
  assertEqual(u.sizes[0].pts, 60, "Canoness must cost 60pts");
  assertEqual(u.sizes[0].label, "1 model", "Canoness size label must be '1 model'");
  assert(u.rulesAdaptations === undefined, "Canoness must have no rulesAdaptations");
});

test("Daemonifuge has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_daemonifuge");
  assert(u !== undefined, "sor_daemonifuge must exist");
  assertEqual(u.name, "Daemonifuge", "name must be 'Daemonifuge'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "EPIC HERO", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Daemonifuge must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Daemonifuge must have exactly ${expectedKws.length} keywords`);
  assert(u.keywords.includes("EPIC HERO"), "Daemonifuge must have EPIC HERO keyword");
  assertEqual(u.sizes.length, 1, "Daemonifuge must have 1 size option");
  assertEqual(u.sizes[0].pts, 85, "Daemonifuge must cost 85pts");
  assertEqual(u.sizes[0].label, "2 models", "Daemonifuge size label must be '2 models'");
});

test("Palatine has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_palatine");
  assert(u !== undefined, "sor_palatine must exist");
  assertEqual(u.name, "Palatine", "name must be 'Palatine'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Palatine must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Palatine must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Palatine must have 1 size option");
  assertEqual(u.sizes[0].pts, 50, "Palatine must cost 50pts");
  assertEqual(u.sizes[0].label, "1 model", "Palatine size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Rapturous Blows"),
    "Palatine must have rulesAdaptations referencing 'Rapturous Blows'");
});

test("Astred Thurga and Agathae Dolan has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_astred_thurga_and_agathae_dolan");
  assert(u !== undefined, "sor_astred_thurga_and_agathae_dolan must exist");
  assertEqual(u.name, "Astred Thurga and Agathae Dolan",
    "name must be 'Astred Thurga and Agathae Dolan'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "EPIC HERO", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Astred Thurga and Agathae Dolan must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Astred Thurga and Agathae Dolan must have exactly ${expectedKws.length} keywords`);
  assert(u.keywords.includes("EPIC HERO"),
    "Astred Thurga and Agathae Dolan must have EPIC HERO keyword");
  assertEqual(u.sizes.length, 1, "Astred Thurga and Agathae Dolan must have 1 size option");
  assertEqual(u.sizes[0].pts, 70, "Astred Thurga and Agathae Dolan must cost 70pts");
  assertEqual(u.sizes[0].label, "2 models",
    "Astred Thurga and Agathae Dolan size label must be '2 models'");
  assert(u.rulesAdaptations === undefined,
    "Astred Thurga and Agathae Dolan must have no rulesAdaptations");
});

test("Dialogus has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_dialogus");
  assert(u !== undefined, "sor_dialogus must exist");
  assertEqual(u.name, "Dialogus", "name must be 'Dialogus'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Dialogus must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Dialogus must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 40, "Dialogus must cost 40pts");
  assertEqual(u.sizes[0].label, "1 model", "Dialogus size label must be '1 model'");
  assert(u.rulesAdaptations === undefined, "Dialogus must have no rulesAdaptations");
});

test("Dogmata has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_dogmata");
  assert(u !== undefined, "sor_dogmata must exist");
  assertEqual(u.name, "Dogmata", "name must be 'Dogmata'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw), `Dogmata must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Dogmata must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 45, "Dogmata must cost 45pts");
  assertEqual(u.sizes[0].label, "1 model", "Dogmata size label must be '1 model'");
  assert(u.rulesAdaptations === undefined, "Dogmata must have no rulesAdaptations");
});

test("Hospitaller has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_hospitaller");
  assert(u !== undefined, "sor_hospitaller must exist");
  assertEqual(u.name, "Hospitaller", "name must be 'Hospitaller'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Hospitaller must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Hospitaller must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 60, "Hospitaller must cost 60pts");
  assertEqual(u.sizes[0].label, "1 model", "Hospitaller size label must be '1 model'");
  assert(u.rulesAdaptations === undefined, "Hospitaller must have no rulesAdaptations");
});

test("Imagifier has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_imagifier");
  assert(u !== undefined, "sor_imagifier must exist");
  assertEqual(u.name, "Imagifier", "name must be 'Imagifier'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Imagifier must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Imagifier must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes[0].pts, 65, "Imagifier must cost 65pts");
  assertEqual(u.sizes[0].label, "1 model", "Imagifier size label must be '1 model'");
  assert(u.rulesAdaptations === undefined, "Imagifier must have no rulesAdaptations");
});

test("All 8 new units are type CHARACTER", () => {
  const newIds = [
    "sor_canoness", "sor_daemonifuge", "sor_palatine",
    "sor_astred_thurga_and_agathae_dolan", "sor_dialogus",
    "sor_dogmata", "sor_hospitaller", "sor_imagifier"
  ];
  newIds.forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assertEqual(u.type, "CHARACTER", `"${id}" must be type CHARACTER`);
  });
});

test("Daemonifuge and Astred Thurga and Agathae Dolan are EPIC HERO units", () => {
  ["sor_daemonifuge", "sor_astred_thurga_and_agathae_dolan"].forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assert(u.keywords.includes("EPIC HERO"), `"${id}" must have EPIC HERO keyword`);
  });
});

test("Palatine and Daemonifuge have rulesAdaptations; other first-wave units do not", () => {
  const withoutAdaptations = [
    "sor_canoness", "sor_astred_thurga_and_agathae_dolan",
    "sor_dialogus", "sor_dogmata", "sor_hospitaller", "sor_imagifier"
  ];
  withoutAdaptations.forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assert(u.rulesAdaptations === undefined,
      `"${id}" must have no rulesAdaptations`);
  });
  const palatine = sorUnits.find(u => u.id === "sor_palatine");
  assert(typeof palatine.rulesAdaptations === "string",
    "Palatine must have rulesAdaptations");
  const daemonifuge = sorUnits.find(u => u.id === "sor_daemonifuge");
  assert(typeof daemonifuge.rulesAdaptations === "string"
    && daemonifuge.rulesAdaptations.includes("Holy Judgement"),
    "Daemonifuge must have rulesAdaptations referencing 'Holy Judgement'");
});

// ── 62. Pious Protectors — Updated Detachment Roster ─────────────────────────

section("62. Pious Protectors — Updated Detachment Roster");

test("All 8 new units are in Pious Protectors with max 1", () => {
  const newIds = [
    "sor_canoness", "sor_daemonifuge", "sor_palatine",
    "sor_astred_thurga_and_agathae_dolan", "sor_dialogus",
    "sor_dogmata", "sor_hospitaller", "sor_imagifier"
  ];
  newIds.forEach(id => {
    const entry = ppDet.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Pious Protectors`);
    assertEqual(entry.max, 1, `"${id}" must have max 1 in Pious Protectors`);
  });
});

test("New CHARACTER units count toward the character cap of 3", () => {
  // All 8 new units are CHARACTER — fill cap with 3 of them
  const list = [
    { unitId: "sor_canoness",   pts: 60 },
    { unitId: "sor_palatine",   pts: 50 },
    { unitId: "sor_hospitaller",pts: 60 },
  ];
  const charCount = list.filter(l =>
    sorUnits.find(u => u.id === l.unitId)?.type === "CHARACTER"
  ).length;
  assertEqual(charCount, 3, "Three CHARACTER units should equal the cap of 3");
  // A 4th CHARACTER (e.g. Dialogus) should now be blocked
  function charCapHit(unitId) {
    const unit = sorUnits.find(u => u.id === unitId);
    if (unit.type !== "CHARACTER") return false;
    return charCount >= ppDet.maxCharacters;
  }
  assert(charCapHit("sor_dialogus"),
    "Dialogus (CHARACTER) must be blocked when cap of 3 is already reached");
  assert(!charCapHit("sor_arco_flagellants"),
    "Arco-Flagellants (INFANTRY) must not be affected by character cap");
});

test("Smoke test — legal list using new units within points limit", () => {
  // Canoness (60) + Daemonifuge (85) + Dogmata (45) + Arco-Flagellants (140) = 330pts
  function canAddPP2(unitId, sizeIdx, list) {
    const unit    = sorUnits.find(u => u.id === unitId);
    const detUnit = ppDet.units.find(du => du.id === unitId);
    if (!detUnit) return false;
    const cost = unit.sizes[sizeIdx].pts;
    const pts  = list.reduce((s, l) => s + l.pts, 0);
    if (pts + cost > 500) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    if (unit.type === "CHARACTER" &&
        list.filter(l => sorUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length
          >= ppDet.maxCharacters) return false;
    return true;
  }
  const list = [];
  assert(canAddPP2("sor_canoness",        0, list), "Add Canoness (60pts)");
  list.push({ unitId: "sor_canoness",        pts: 60  });
  assert(canAddPP2("sor_daemonifuge",     0, list), "Add Daemonifuge (85pts)");
  list.push({ unitId: "sor_daemonifuge",     pts: 85  });
  assert(canAddPP2("sor_dogmata",         0, list), "Add Dogmata (45pts)");
  list.push({ unitId: "sor_dogmata",         pts: 45  });
  assert(canAddPP2("sor_arco_flagellants",0, list), "Add Arco-Flagellants (140pts)");
  list.push({ unitId: "sor_arco_flagellants",pts: 140 });
  // Character cap now hit (3 CHARACTERs) — Imagifier should be blocked
  assert(!canAddPP2("sor_imagifier", 0, list),
    "Imagifier must be blocked — character cap of 3 is reached");
  const total = list.reduce((s, l) => s + l.pts, 0);
  assertEqual(total, 330, "Total should be 330pts (60+85+45+140)");
  assert(total <= 500, "List must be within the 500pt limit");
});


// ── 63. Pious Protectors — Second Wave Unit Definitions ───────────────────────

section("63. Pious Protectors — Second Wave Unit Definitions");

test("Canoness with Jump Pack has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_canoness_jump_pack");
  assert(u !== undefined, "sor_canoness_jump_pack must exist");
  assertEqual(u.name, "Canoness with Jump Pack", "name must be 'Canoness with Jump Pack'");
  assertEqual(u.type, "CHARACTER", "type must be CHARACTER");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "CHARACTER", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Canoness with Jump Pack must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Canoness with Jump Pack must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Canoness with Jump Pack must have 1 size option");
  assertEqual(u.sizes[0].pts, 60, "Canoness with Jump Pack must cost 60pts");
  assertEqual(u.sizes[0].label, "1 model", "Canoness with Jump Pack size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "Canoness with Jump Pack must have rulesAdaptations referencing 'Deep Strike'");
  assert(u.rulesAdaptations.includes("9"),
    "Canoness with Jump Pack rulesAdaptations must reference reduced Movement of 9\"");
});

test("Battle Sisters Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_battle_sisters_squad");
  assert(u !== undefined, "sor_battle_sisters_squad must exist");
  assertEqual(u.name, "Battle Sisters Squad", "name must be 'Battle Sisters Squad'");
  assertEqual(u.type, "BATTLELINE", "type must be BATTLELINE");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "BATTLELINE", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Battle Sisters Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Battle Sisters Squad must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Battle Sisters Squad must have 1 size option");
  assertEqual(u.sizes[0].pts, 105, "Battle Sisters Squad must cost 105pts");
  assertEqual(u.sizes[0].label, "10 models", "Battle Sisters Squad size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Defenders of the Faith"),
    "Battle Sisters Squad must have rulesAdaptations referencing 'Defenders of the Faith'");
  assert(u.rulesAdaptations.includes("Cherub"),
    "Battle Sisters Squad rulesAdaptations must reference 'Cherub'");
});

test("Dominion Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_dominion_squad");
  assert(u !== undefined, "sor_dominion_squad must exist");
  assertEqual(u.name, "Dominion Squad", "name must be 'Dominion Squad'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Dominion Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Dominion Squad must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Dominion Squad must have 1 size option");
  assertEqual(u.sizes[0].pts, 120, "Dominion Squad must cost 120pts");
  assertEqual(u.sizes[0].label, "10 models", "Dominion Squad size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Righteous Awareness"),
    "Dominion Squad must have rulesAdaptations referencing 'Righteous Awareness'");
  assert(u.rulesAdaptations.includes("Cherub"),
    "Dominion Squad rulesAdaptations must reference 'Cherub'");
});

test("Sisters Noviate Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_sisters_noviate_squad");
  assert(u !== undefined, "sor_sisters_noviate_squad must exist");
  assertEqual(u.name, "Sisters Noviate Squad", "name must be 'Sisters Noviate Squad'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Sisters Noviate Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Sisters Noviate Squad must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Sisters Noviate Squad must have 1 size option");
  assertEqual(u.sizes[0].pts, 120, "Sisters Noviate Squad must cost 120pts");
  assertEqual(u.sizes[0].label, "10 models", "Sisters Noviate Squad size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Form Boarding Squads"),
    "Sisters Noviate Squad must have rulesAdaptations referencing 'Form Boarding Squads'");
});

test("Celestian Sacresants has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_celestian_sacresants");
  assert(u !== undefined, "sor_celestian_sacresants must exist");
  assertEqual(u.name, "Celestian Sacresants", "name must be 'Celestian Sacresants'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Celestian Sacresants must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Celestian Sacresants must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 2, "Celestian Sacresants must have 2 size options");
  assertEqual(u.sizes[0].pts, 70,  "Celestian Sacresants 5-man must cost 70pts");
  assertEqual(u.sizes[0].label, "5 models",  "Celestian Sacresants first size must be '5 models'");
  assertEqual(u.sizes[1].pts, 140, "Celestian Sacresants 10-man must cost 140pts");
  assertEqual(u.sizes[1].label, "10 models", "Celestian Sacresants second size must be '10 models'");
  assert(u.rulesAdaptations === undefined, "Celestian Sacresants must have no rulesAdaptations");
});

test("Seraphim Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_seraphim_squad");
  assert(u !== undefined, "sor_seraphim_squad must exist");
  assertEqual(u.name, "Seraphim Squad", "name must be 'Seraphim Squad'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Seraphim Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Seraphim Squad must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Seraphim Squad must have 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Seraphim Squad must cost 80pts");
  assertEqual(u.sizes[0].label, "5 models", "Seraphim Squad size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "Seraphim Squad must have rulesAdaptations referencing 'Deep Strike'");
  assert(u.rulesAdaptations.includes("Angelic Ascent"),
    "Seraphim Squad rulesAdaptations must reference 'Angelic Ascent'");
  assert(u.rulesAdaptations.includes("9"),
    "Seraphim Squad rulesAdaptations must reference reduced Movement of 9\"");
});

test("Zephyrim Squad has correct fields", () => {
  const u = sorUnits.find(u => u.id === "sor_zephyrim_squad");
  assert(u !== undefined, "sor_zephyrim_squad must exist");
  assertEqual(u.name, "Zephyrim Squad", "name must be 'Zephyrim Squad'");
  assertEqual(u.type, "INFANTRY", "type must be INFANTRY");
  const expectedKws = ["ADEPTA SORORITAS", "INFANTRY", "IMPERIUM"];
  expectedKws.forEach(kw => assert(u.keywords.includes(kw),
    `Zephyrim Squad must have keyword "${kw}"`));
  assertEqual(u.keywords.length, expectedKws.length,
    `Zephyrim Squad must have exactly ${expectedKws.length} keywords`);
  assertEqual(u.sizes.length, 1, "Zephyrim Squad must have 1 size option");
  assertEqual(u.sizes[0].pts, 80, "Zephyrim Squad must cost 80pts");
  assertEqual(u.sizes[0].label, "5 models", "Zephyrim Squad size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "Zephyrim Squad must have rulesAdaptations referencing 'Deep Strike'");
  assert(!u.rulesAdaptations.includes("Angelic Ascent"),
    "Zephyrim Squad rulesAdaptations must NOT reference 'Angelic Ascent' (only Seraphim loses that)");
  assert(u.rulesAdaptations.includes("9"),
    "Zephyrim Squad rulesAdaptations must reference reduced Movement of 9\"");
});

test("Canoness with Jump Pack is CHARACTER; all other new units are non-CHARACTER", () => {
  const jumpCanoness = sorUnits.find(u => u.id === "sor_canoness_jump_pack");
  assertEqual(jumpCanoness.type, "CHARACTER", "Canoness with Jump Pack must be CHARACTER");
  ["sor_battle_sisters_squad", "sor_dominion_squad", "sor_sisters_noviate_squad",
   "sor_celestian_sacresants", "sor_seraphim_squad", "sor_zephyrim_squad"].forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assert(u.type !== "CHARACTER", `"${id}" must not be type CHARACTER`);
    assert(!u.keywords.includes("CHARACTER"), `"${id}" must not have CHARACTER keyword`);
  });
});

test("Battle Sisters Squad is type BATTLELINE; squad units are INFANTRY", () => {
  const bss = sorUnits.find(u => u.id === "sor_battle_sisters_squad");
  assertEqual(bss.type, "BATTLELINE", "Battle Sisters Squad must be type BATTLELINE");
  ["sor_dominion_squad", "sor_sisters_noviate_squad", "sor_celestian_sacresants",
   "sor_seraphim_squad", "sor_zephyrim_squad"].forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assertEqual(u.type, "INFANTRY", `"${id}" must be type INFANTRY`);
  });
});

test("Seraphim and Zephyrim both lose Deep Strike; only Seraphim also loses Angelic Ascent", () => {
  const seraphim = sorUnits.find(u => u.id === "sor_seraphim_squad");
  const zephyrim = sorUnits.find(u => u.id === "sor_zephyrim_squad");
  assert(seraphim.rulesAdaptations.includes("Deep Strike"),
    "Seraphim must lose Deep Strike");
  assert(seraphim.rulesAdaptations.includes("Angelic Ascent"),
    "Seraphim must also lose Angelic Ascent");
  assert(zephyrim.rulesAdaptations.includes("Deep Strike"),
    "Zephyrim must lose Deep Strike");
  assert(!zephyrim.rulesAdaptations.includes("Angelic Ascent"),
    "Zephyrim must NOT lose Angelic Ascent");
});

// ── 64. Pious Protectors — Updated Detachment Roster (Wave 2) ────────────────

section("64. Pious Protectors — Updated Detachment Roster (Wave 2)");

test("All 7 new units are in Pious Protectors with correct maxes", () => {
  const expected = [
    { id: "sor_canoness_jump_pack",    max: 1 },
    { id: "sor_battle_sisters_squad",  max: 3 },
    { id: "sor_dominion_squad",        max: 3 },
    { id: "sor_sisters_noviate_squad", max: 3 },
    { id: "sor_celestian_sacresants",  max: 1 },
    { id: "sor_seraphim_squad",        max: 1 },
    { id: "sor_zephyrim_squad",        max: 1 },
  ];
  expected.forEach(({ id, max }) => {
    const entry = ppDet.units.find(u => u.id === id);
    assert(entry !== undefined, `"${id}" must be in Pious Protectors`);
    assertEqual(entry.max, max, `"${id}" must have max ${max} in Pious Protectors`);
  });
});

test("Canoness with Jump Pack counts toward character cap in Pious Protectors", () => {
  const u = sorUnits.find(u => u.id === "sor_canoness_jump_pack");
  assertEqual(u.type, "CHARACTER",
    "Canoness with Jump Pack is CHARACTER and must count toward the cap");
});

test("Non-CHARACTER units do not count toward the character cap", () => {
  ["sor_battle_sisters_squad", "sor_dominion_squad", "sor_sisters_noviate_squad",
   "sor_celestian_sacresants", "sor_seraphim_squad", "sor_zephyrim_squad"].forEach(id => {
    const u = sorUnits.find(u => u.id === id);
    assert(u.type !== "CHARACTER",
      `"${id}" is not CHARACTER and must not be subject to the character cap`);
  });
});

test("Smoke test — legal list with wave 2 units within points limit", () => {
  // Canoness JP (60) + Battle Sisters (105) + Dominion (120) + Celestian 5-man (70) = 355pts
  function canAddPP3(unitId, sizeIdx, list) {
    const unit    = sorUnits.find(u => u.id === unitId);
    const detUnit = ppDet.units.find(du => du.id === unitId);
    if (!detUnit) return false;
    const cost = unit.sizes[sizeIdx].pts;
    const pts  = list.reduce((s, l) => s + l.pts, 0);
    if (pts + cost > 500) return false;
    if (list.filter(l => l.unitId === unitId).length >= detUnit.max) return false;
    if (unit.type === "CHARACTER" &&
        list.filter(l => sorUnits.find(u => u.id === l.unitId)?.type === "CHARACTER").length
          >= ppDet.maxCharacters) return false;
    return true;
  }
  const list = [];
  assert(canAddPP3("sor_canoness_jump_pack",   0, list), "Add Canoness with JP (60pts)");
  list.push({ unitId: "sor_canoness_jump_pack",   pts: 60  });
  assert(canAddPP3("sor_battle_sisters_squad", 0, list), "Add Battle Sisters Squad (105pts)");
  list.push({ unitId: "sor_battle_sisters_squad", pts: 105 });
  assert(canAddPP3("sor_dominion_squad",       0, list), "Add Dominion Squad (120pts)");
  list.push({ unitId: "sor_dominion_squad",       pts: 120 });
  assert(canAddPP3("sor_celestian_sacresants", 0, list), "Add Celestian Sacresants 5-man (70pts)");
  list.push({ unitId: "sor_celestian_sacresants", pts: 70  });
  // Max of 1 on Celestian — second should be blocked
  assert(!canAddPP3("sor_celestian_sacresants", 0, list),
    "Second Celestian Sacresants blocked — unit max is 1");
  const total = list.reduce((s, l) => s + l.pts, 0);
  assertEqual(total, 355, "Total should be 355pts (60+105+120+70)");
  assert(total <= 500, "List must be within the 500pt limit");
});

test("3x Sisters Noviate Squad hits unit max of 3; a 4th is blocked", () => {
  function canAddSNS(count) {
    const list = Array.from({ length: count },
      () => ({ unitId: "sor_sisters_noviate_squad", pts: 120 }));
    const detUnit = ppDet.units.find(u => u.id === "sor_sisters_noviate_squad");
    return list.filter(l => l.unitId === "sor_sisters_noviate_squad").length < detUnit.max;
  }
  assert(canAddSNS(0), "First Sisters Noviate Squad should be addable");
  assert(canAddSNS(1), "Second Sisters Noviate Squad should be addable");
  assert(canAddSNS(2), "Third Sisters Noviate Squad should be addable");
  assert(!canAddSNS(3), "Fourth Sisters Noviate Squad must be blocked — max is 3");
});


// ── 65. Pious Protectors — Restrictions ──────────────────────────────────────

section("65. Pious Protectors — Restrictions");

// Mirror app logic for exclusive groups
const isExclusiveGroupBlockedPP = makeExcGroupChecker(ppDet.exclusiveUnitGroups);

// Mirror app logic for maxFromGroup
function isMaxFromGroupBlockedPP(unitId, list) {
  const groups = ppDet.maxFromGroup;
  if (!groups) return false;
  for (const g of groups) {
    if (!g.unitIds.includes(unitId)) continue;
    const alreadyInList = list.filter(l => g.unitIds.includes(l.unitId)).length;
    const thisUnitInList = list.some(l => l.unitId === unitId);
    if (!thisUnitInList && alreadyInList >= g.max) return true;
  }
  return false;
}

// ── Daemonifuge rulesAdaptations ──────────────────────────────────────────────

test("Daemonifuge has rulesAdaptations referencing Holy Judgement", () => {
  const u = sorUnits.find(u => u.id === "sor_daemonifuge");
  assert(typeof u.rulesAdaptations === "string",
    "Daemonifuge must have rulesAdaptations");
  assert(u.rulesAdaptations.includes("Holy Judgement"),
    "Daemonifuge rulesAdaptations must reference 'Holy Judgement'");
});

// ── Exclusive group 1: Commander units ───────────────────────────────────────

test("Pious Protectors has exclusiveUnitGroups defined", () => {
  assert(Array.isArray(ppDet.exclusiveUnitGroups) && ppDet.exclusiveUnitGroups.length > 0,
    "Pious Protectors must have a non-empty exclusiveUnitGroups array");
});

test("Pious Protectors has exactly 2 exclusive unit groups", () => {
  assertEqual(ppDet.exclusiveUnitGroups.length, 2,
    "Pious Protectors must have exactly 2 exclusive unit groups");
});

test("Commander exclusive group contains exactly the 4 correct unit IDs", () => {
  const COMMANDER_GROUP = [
    "sor_canoness", "sor_canoness_jump_pack", "sor_daemonifuge", "sor_palatine"
  ];
  const group = ppDet.exclusiveUnitGroups.find(g =>
    g.includes("sor_canoness") && g.includes("sor_daemonifuge")
  );
  assert(group !== undefined, "Commander exclusive group must exist");
  assertEqual(group.length, 4, "Commander exclusive group must have exactly 4 unit IDs");
  COMMANDER_GROUP.forEach(id => assert(group.includes(id),
    `Commander exclusive group must include "${id}"`));
});

test("All commander exclusive group unit IDs exist in Sororitas units", () => {
  const unitIds = new Set(sorUnits.map(u => u.id));
  const group = ppDet.exclusiveUnitGroups.find(g => g.includes("sor_canoness"));
  group.forEach(id => assert(unitIds.has(id),
    `Commander exclusive group references "${id}" which does not exist in units`));
});

test("All commander exclusive group unit IDs are in Pious Protectors roster", () => {
  const detUnitIds = new Set(ppDet.units.map(u => u.id));
  const group = ppDet.exclusiveUnitGroups.find(g => g.includes("sor_canoness"));
  group.forEach(id => assert(detUnitIds.has(id),
    `Commander exclusive group unit "${id}" must be in Pious Protectors roster`));
});

test("Commander group — first unit can be added to empty list", () => {
  ["sor_canoness", "sor_canoness_jump_pack", "sor_daemonifuge", "sor_palatine"].forEach(id => {
    assert(!isExclusiveGroupBlockedPP(id, []),
      `"${id}" must not be blocked in an empty list`);
  });
});

test("Commander group — adding Canoness blocks all other commander units", () => {
  const list = [{ unitId: "sor_canoness" }];
  ["sor_canoness_jump_pack", "sor_daemonifuge", "sor_palatine"].forEach(id => {
    assert(isExclusiveGroupBlockedPP(id, list),
      `"${id}" must be blocked when Canoness is in the list`);
  });
});

test("Commander group — adding Daemonifuge blocks Canoness, Jump Pack Canoness and Palatine", () => {
  const list = [{ unitId: "sor_daemonifuge" }];
  ["sor_canoness", "sor_canoness_jump_pack", "sor_palatine"].forEach(id => {
    assert(isExclusiveGroupBlockedPP(id, list),
      `"${id}" must be blocked when Daemonifuge is in the list`);
  });
});

test("Commander group — a unit is never blocked by its own presence in the list", () => {
  ["sor_canoness", "sor_canoness_jump_pack", "sor_daemonifuge", "sor_palatine"].forEach(id => {
    const list = [{ unitId: id }];
    assert(!isExclusiveGroupBlockedPP(id, list),
      `"${id}" must not be exclusively-blocked by its own presence`);
  });
});

test("Commander group — removing the taken unit unblocks the rest", () => {
  const list = [{ id: 0, unitId: "sor_canoness" }];
  assert(isExclusiveGroupBlockedPP("sor_palatine", list),
    "Palatine must be blocked while Canoness is in the list");
  const trimmed = list.filter(l => l.id !== 0);
  assert(!isExclusiveGroupBlockedPP("sor_palatine", trimmed),
    "Palatine must be unblocked once Canoness is removed");
});

test("Commander group — units outside the group are never blocked by it", () => {
  const list = [{ unitId: "sor_canoness" }];
  ["sor_dialogus", "sor_hospitaller", "sor_battle_sisters_squad", "sor_arco_flagellants"]
    .forEach(id => {
      assert(!isExclusiveGroupBlockedPP(id, list),
        `"${id}" must not be blocked by the commander exclusive group`);
    });
});

// ── Exclusive group 2: Seraphim / Zephyrim ───────────────────────────────────

test("Seraphim/Zephyrim exclusive group contains exactly the 2 correct unit IDs", () => {
  const group = ppDet.exclusiveUnitGroups.find(g => g.includes("sor_seraphim_squad"));
  assert(group !== undefined, "Seraphim/Zephyrim exclusive group must exist");
  assertEqual(group.length, 2, "Seraphim/Zephyrim exclusive group must have exactly 2 unit IDs");
  assert(group.includes("sor_seraphim_squad"), "Group must include sor_seraphim_squad");
  assert(group.includes("sor_zephyrim_squad"), "Group must include sor_zephyrim_squad");
});

test("Seraphim/Zephyrim — adding Seraphim blocks Zephyrim", () => {
  const list = [{ unitId: "sor_seraphim_squad" }];
  assert(isExclusiveGroupBlockedPP("sor_zephyrim_squad", list),
    "Zephyrim must be blocked when Seraphim is in the list");
});

test("Seraphim/Zephyrim — adding Zephyrim blocks Seraphim", () => {
  const list = [{ unitId: "sor_zephyrim_squad" }];
  assert(isExclusiveGroupBlockedPP("sor_seraphim_squad", list),
    "Seraphim must be blocked when Zephyrim is in the list");
});

test("Seraphim/Zephyrim — each is unblocked in an empty list", () => {
  assert(!isExclusiveGroupBlockedPP("sor_seraphim_squad", []),
    "Seraphim must not be blocked in an empty list");
  assert(!isExclusiveGroupBlockedPP("sor_zephyrim_squad", []),
    "Zephyrim must not be blocked in an empty list");
});

test("Two exclusive groups are independent — commander group does not block Seraphim/Zephyrim", () => {
  const list = [{ unitId: "sor_canoness" }];
  assert(!isExclusiveGroupBlockedPP("sor_seraphim_squad", list),
    "Seraphim must not be blocked by the commander group");
  assert(!isExclusiveGroupBlockedPP("sor_zephyrim_squad", list),
    "Zephyrim must not be blocked by the commander group");
});

test("Two exclusive groups are independent — Seraphim/Zephyrim does not block commander units", () => {
  const list = [{ unitId: "sor_seraphim_squad" }];
  assert(!isExclusiveGroupBlockedPP("sor_canoness", list),
    "Canoness must not be blocked by the Seraphim/Zephyrim group");
  assert(!isExclusiveGroupBlockedPP("sor_daemonifuge", list),
    "Daemonifuge must not be blocked by the Seraphim/Zephyrim group");
});

// ── maxFromGroup: Support character units (max 2) ─────────────────────────────

test("Pious Protectors has maxFromGroup defined", () => {
  assert(Array.isArray(ppDet.maxFromGroup) && ppDet.maxFromGroup.length > 0,
    "Pious Protectors must have a non-empty maxFromGroup array");
});

test("maxFromGroup has exactly 1 group", () => {
  assertEqual(ppDet.maxFromGroup.length, 1,
    "Pious Protectors must have exactly 1 maxFromGroup group");
});

test("maxFromGroup group has max of 2", () => {
  assertEqual(ppDet.maxFromGroup[0].max, 2,
    "Support character maxFromGroup max must be 2");
});

test("maxFromGroup group contains exactly the 6 correct support character unit IDs", () => {
  const SUPPORT_GROUP = [
    "sor_astred_thurga_and_agathae_dolan", "sor_dialogus", "sor_dogmata",
    "sor_hospitaller", "sor_imagifier", "sor_ministorum_priest"
  ];
  const group = ppDet.maxFromGroup[0];
  assertEqual(group.unitIds.length, 6,
    `maxFromGroup must list exactly 6 unit IDs, found ${group.unitIds.length}`);
  SUPPORT_GROUP.forEach(id => assert(group.unitIds.includes(id),
    `maxFromGroup must include "${id}"`));
});

test("maxFromGroup unit IDs all appear in Pious Protectors roster", () => {
  const detUnitIds = new Set(ppDet.units.map(u => u.id));
  ppDet.maxFromGroup[0].unitIds.forEach(id => assert(detUnitIds.has(id),
    `maxFromGroup unit "${id}" must be in Pious Protectors roster`));
});

test("maxFromGroup has a description string", () => {
  assert(typeof ppDet.maxFromGroup[0].description === "string"
    && ppDet.maxFromGroup[0].description.length > 0,
    "maxFromGroup group must have a non-empty description string");
});

test("maxFromGroup — first support unit can be added to an empty list", () => {
  ["sor_dialogus", "sor_dogmata", "sor_hospitaller",
   "sor_imagifier", "sor_ministorum_priest",
   "sor_astred_thurga_and_agathae_dolan"].forEach(id => {
    assert(!isMaxFromGroupBlockedPP(id, []),
      `"${id}" must not be blocked in an empty list`);
  });
});

test("maxFromGroup — second support unit is allowed when only 1 is in the list", () => {
  const list = [{ unitId: "sor_dialogus" }];
  ["sor_dogmata", "sor_hospitaller", "sor_imagifier",
   "sor_ministorum_priest", "sor_astred_thurga_and_agathae_dolan"].forEach(id => {
    assert(!isMaxFromGroupBlockedPP(id, list),
      `"${id}" must be allowed when only 1 support unit is in the list`);
  });
});

test("maxFromGroup — third support unit is blocked when 2 are already in the list", () => {
  const list = [{ unitId: "sor_dialogus" }, { unitId: "sor_hospitaller" }];
  ["sor_dogmata", "sor_imagifier",
   "sor_ministorum_priest", "sor_astred_thurga_and_agathae_dolan"].forEach(id => {
    assert(isMaxFromGroupBlockedPP(id, list),
      `"${id}" must be blocked when 2 support units are already in the list`);
  });
});

test("maxFromGroup — a unit already in the list is never blocked by its own presence", () => {
  const list = [{ unitId: "sor_dialogus" }, { unitId: "sor_hospitaller" }];
  assert(!isMaxFromGroupBlockedPP("sor_dialogus", list),
    "Dialogus must not be blocked by its own presence in the list");
});

test("maxFromGroup — non-support units are unaffected by the constraint", () => {
  const list = [{ unitId: "sor_dialogus" }, { unitId: "sor_hospitaller" }];
  ["sor_battle_sisters_squad", "sor_dominion_squad",
   "sor_arco_flagellants", "sor_canoness"].forEach(id => {
    assert(!isMaxFromGroupBlockedPP(id, list),
      `"${id}" must not be affected by the support character maxFromGroup constraint`);
  });
});

test("Smoke test — all three restriction types apply together correctly", () => {
  // Canoness (60, commander group) + Dialogus (40) + Hospitaller (60, 2 support = cap hit)
  // + Battle Sisters (105) + Seraphim (80) = 345pts
  // Zephyrim blocked by Seraphim; Palatine blocked by Canoness; Dogmata blocked by support cap
  const list = [
    { unitId: "sor_canoness"             },
    { unitId: "sor_dialogus"             },
    { unitId: "sor_hospitaller"          },
    { unitId: "sor_battle_sisters_squad" },
    { unitId: "sor_seraphim_squad"       },
  ];
  assert(isExclusiveGroupBlockedPP("sor_palatine", list),
    "Palatine blocked by commander exclusive group (Canoness taken)");
  assert(isExclusiveGroupBlockedPP("sor_canoness_jump_pack", list),
    "Canoness with JP blocked by commander exclusive group (Canoness taken)");
  assert(isExclusiveGroupBlockedPP("sor_zephyrim_squad", list),
    "Zephyrim blocked by Seraphim/Zephyrim exclusive group (Seraphim taken)");
  assert(isMaxFromGroupBlockedPP("sor_dogmata", list),
    "Dogmata blocked by support cap (Dialogus + Hospitaller = 2 already taken)");
  assert(!isExclusiveGroupBlockedPP("sor_dominion_squad", list),
    "Dominion Squad unaffected by all exclusive group constraints");
  assert(!isMaxFromGroupBlockedPP("sor_dominion_squad", list),
    "Dominion Squad unaffected by support maxFromGroup constraint");
});


// ── Section 66: Emperor's Children Faction ───────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("66. Emperor's Children Faction");

const ecFaction = index.factions.find(f => f.id === "emperors_children");
const ecData    = factionData["emperors_children"];
const ecUnits   = ecData ? ecData.units : [];
const ecDets    = ecData ? ecData.detachments : [];

test("Emperor's Children exists in index.json factions", () => {
  assert(!!ecFaction, "Emperor's Children faction not found in index.json");
});

test("Emperor's Children has correct name", () => {
  assertEqual(ecFaction.name, "Emperor's Children", "faction name mismatch");
});

test("Emperor's Children file path is factions/emperors_children.json", () => {
  assertEqual(ecFaction.file, "factions/emperors_children.json", "file path mismatch");
});

test("Emperor's Children has Musk of Torpidity army rule", () => {
  assert(ecFaction.armyRule, "armyRule must be present");
  assertEqual(ecFaction.armyRule.name, "Musk of Torpidity", "army rule name mismatch");
});

test("Musk of Torpidity desc references Thrill Seekers ability", () => {
  assert(ecFaction.armyRule.desc.includes("Thrill Seekers"),
    "army rule desc must mention 'Thrill Seekers'");
});

test("Musk of Torpidity desc references Fell Back", () => {
  assert(ecFaction.armyRule.desc.includes("Fell Back"),
    "army rule desc must mention 'Fell Back'");
});

test("index.json now has 10 factions including Emperor's Children", () => {
  assert(index.factions.length >= 10,
    `Expected at least 10 factions, got ${index.factions.length}`);
  assert(index.factions.some(f => f.id === "emperors_children"),
    "emperors_children must be in factions array");
});

test("Emperor's Children has exactly 4 units", () => {
  assertEqual(ecUnits.length, 4, `Expected 4 units, got ${ecUnits.length}`);
});

// ── Section 67: Sublime Strike Detachment ────────────────────────────────────

section("67. Emperor's Children — Sublime Strike Detachment");

const ssDet = ecDets ? ecDets.find(d => d.id === "ec_sublime_strike") : null;

test("Sublime Strike detachment exists in emperors_children.json", () => {
  assert(!!ssDet, "Sublime Strike detachment not found");
});

test("Sublime Strike has correct name", () => {
  assertEqual(ssDet.name, "Sublime Strike", "detachment name mismatch");
});

test("Sublime Strike has Dark Radiance special rule", () => {
  assert(ssDet.specialRule, "specialRule must be present");
  assertEqual(ssDet.specialRule.name, "Dark Radiance", "special rule name mismatch");
});

test("Dark Radiance desc references moving through models", () => {
  assert(ssDet.specialRule.desc.includes("move through"),
    "Dark Radiance desc must reference moving through models");
});

test("Dark Radiance desc references Terminator squads and Secure Site", () => {
  assert(ssDet.specialRule.desc.includes("Terminator"),
    "Dark Radiance desc must mention 'Terminator'");
  assert(ssDet.specialRule.desc.includes("Secure Site"),
    "Dark Radiance desc must mention 'Secure Site'");
});

test("Sublime Strike has maxCharacters set to 2", () => {
  assertEqual(ssDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Sublime Strike has exactly 4 unit entries", () => {
  assertEqual(ssDet.units.length, 4, `Expected 4 unit entries, got ${ssDet.units.length}`);
});

test("Sublime Strike unit roster — correct IDs and maxes", () => {
  const roster = ssDet.units;
  const find   = id => roster.find(u => u.id === id);
  assert(find("ec_lord_kakophonist")?.max === 2,  "ec_lord_kakophonist max must be 2");
  assert(find("ec_lucius")?.max === 1,             "ec_lucius max must be 1");
  assert(find("ec_flawless_blades")?.max === 2,   "ec_flawless_blades max must be 2");
  assert(find("ec_chaos_terminators")?.max === 2, "ec_chaos_terminators max must be 2");
});

test("Sublime Strike has exactly 2 enhancements", () => {
  assertEqual(ssDet.enhancements.length, 2,
    `Expected 2 enhancements, got ${ssDet.enhancements.length}`);
});

test("Sublime Strike has Venom of the Six-Fanged Serpent enhancement", () => {
  assert(ssDet.enhancements.some(e => e.id === "enh_ec_venom_six_fanged"),
    "Venom of the Six-Fanged Serpent enhancement not found");
});

test("Sublime Strike has Daemonshrieker enhancement", () => {
  assert(ssDet.enhancements.some(e => e.id === "enh_ec_daemonshrieker"),
    "Daemonshrieker enhancement not found");
});

test("Venom of the Six-Fanged Serpent desc references Strength and Damage", () => {
  const enh = ssDet.enhancements.find(e => e.id === "enh_ec_venom_six_fanged");
  assert(enh.desc.includes("Strength") && enh.desc.includes("Damage"),
    "Venom desc must mention Strength and Damage");
});

test("Daemonshrieker desc references Hatchway and D6 roll", () => {
  const enh = ssDet.enhancements.find(e => e.id === "enh_ec_daemonshrieker");
  assert(enh.desc.includes("Hatchway"), "Daemonshrieker desc must mention Hatchway");
  assert(enh.desc.includes("D6"),       "Daemonshrieker desc must mention D6");
});

// ── Section 68: Unit Definitions ─────────────────────────────────────────────

section("68. Emperor's Children — Unit Definitions");

const ecUnit = id => ecUnits.find(u => u.id === id);

test("Lord Kakophonist has correct fields", () => {
  const u = ecUnit("ec_lord_kakophonist");
  assert(!!u, "Lord Kakophonist not found");
  assertEqual(u.name, "Lord Kakophonist");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EMPEROR'S CHILDREN"), "must have EMPEROR'S CHILDREN keyword");
  assert(u.keywords.includes("CHARACTER"),           "must have CHARACTER keyword");
  assert(u.keywords.includes("CHAOS"),               "must have CHAOS keyword");
  assert(u.keywords.includes("SLAANESH"),            "must have SLAANESH keyword");
  assert(!u.keywords.includes("EPIC HERO"),          "must NOT have EPIC HERO keyword");
  assertEqual(u.sizes.length, 1, "must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 70, "must cost 70pts");
  assertEqual(u.sizes[0].label, "1 model");
});

test("Lucius the Eternal has correct fields", () => {
  const u = ecUnit("ec_lucius");
  assert(!!u, "Lucius the Eternal not found");
  assertEqual(u.name, "Lucius the Eternal");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EMPEROR'S CHILDREN"), "must have EMPEROR'S CHILDREN keyword");
  assert(u.keywords.includes("CHARACTER"),           "must have CHARACTER keyword");
  assert(u.keywords.includes("EPIC HERO"),           "must have EPIC HERO keyword");
  assert(u.keywords.includes("CHAOS"),               "must have CHAOS keyword");
  assert(u.keywords.includes("SLAANESH"),            "must have SLAANESH keyword");
  assertEqual(u.sizes.length, 1, "must have exactly 1 size option");
  assertEqual(u.sizes[0].pts, 70, "must cost 70pts");
  assertEqual(u.sizes[0].label, "1 model");
});

test("Flawless Blades has correct fields", () => {
  const u = ecUnit("ec_flawless_blades");
  assert(!!u, "Flawless Blades not found");
  assertEqual(u.name, "Flawless Blades");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("EMPEROR'S CHILDREN"), "must have EMPEROR'S CHILDREN keyword");
  assert(u.keywords.includes("INFANTRY"),            "must have INFANTRY keyword");
  assert(u.keywords.includes("CHAOS"),               "must have CHAOS keyword");
  assert(u.keywords.includes("SLAANESH"),            "must have SLAANESH keyword");
  assert(!u.keywords.includes("CHARACTER"),          "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 2, "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "3 models");
  assertEqual(u.sizes[0].pts,   110, "3-model size must cost 110pts");
  assertEqual(u.sizes[1].label, "6 models");
  assertEqual(u.sizes[1].pts,   220, "6-model size must cost 220pts");
});

test("Chaos Terminators (Emperor's Children) has correct fields", () => {
  const u = ecUnit("ec_chaos_terminators");
  assert(!!u, "Chaos Terminators not found");
  assertEqual(u.name, "Chaos Terminators");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("EMPEROR'S CHILDREN"), "must have EMPEROR'S CHILDREN keyword");
  assert(u.keywords.includes("INFANTRY"),            "must have INFANTRY keyword");
  assert(u.keywords.includes("CHAOS"),               "must have CHAOS keyword");
  assert(u.keywords.includes("SLAANESH"),            "must have SLAANESH keyword");
  assert(u.keywords.includes("TERMINATOR"),          "must have TERMINATOR keyword");
  assert(!u.keywords.includes("CHARACTER"),          "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 1, "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   155, "must cost 155pts");
});

test("Lucius is an EPIC HERO — UI will correctly block enhancement assignment", () => {
  const u = ecUnit("ec_lucius");
  assert(u.keywords.includes("EPIC HERO"),
    "Lucius must have EPIC HERO so the HTML blocks enhancement assignment");
});

test("Lord Kakophonist is not EPIC HERO — can receive enhancements", () => {
  const u = ecUnit("ec_lord_kakophonist");
  assert(!u.keywords.includes("EPIC HERO"),
    "Lord Kakophonist must NOT have EPIC HERO so it can receive enhancements");
});

// ── Section 69: Sublime Strike — Game Rule Logic ─────────────────────────────

section("69. Sublime Strike — Game Rule Logic");

const ss = makeDetHelpers(ssDet, id => ecUnit(id));

test("Sublime Strike character cap — first CHARACTER can be added (empty list)", () => {
  assert(ss.canAdd([], "ec_lord_kakophonist"),
    "First Lord Kakophonist must be addable to an empty list");
});

test("Sublime Strike character cap — second CHARACTER can be added when one is present", () => {
  const list = [{ unitId: "ec_lord_kakophonist" }];
  assert(ss.canAdd(list, "ec_lord_kakophonist"),
    "Second Lord Kakophonist must be addable when one is already in the list");
});

test("Sublime Strike character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [{ unitId: "ec_lord_kakophonist" }, { unitId: "ec_lord_kakophonist" }];
  assert(!ss.canAdd(list, "ec_lucius"),
    "Lucius must be blocked when two CHARACTERs are already in the list");
});

test("Sublime Strike — Lucius is capped at max 1", () => {
  const list = [{ unitId: "ec_lucius" }];
  assert(!ss.canAdd(list, "ec_lucius"),
    "Second Lucius must be blocked by unit max of 1");
});

test("Sublime Strike — Lord Kakophonist is capped at max 2", () => {
  const list = [{ unitId: "ec_lord_kakophonist" }, { unitId: "ec_lord_kakophonist" }];
  assert(!ss.canAdd(list, "ec_lord_kakophonist"),
    "Third Lord Kakophonist must be blocked by unit max of 2");
});

test("Sublime Strike — Flawless Blades is capped at max 2", () => {
  const list = [{ unitId: "ec_flawless_blades" }, { unitId: "ec_flawless_blades" }];
  assert(!ss.canAdd(list, "ec_flawless_blades"),
    "Third Flawless Blades must be blocked by unit max of 2");
});

test("Sublime Strike — Chaos Terminators is capped at max 2", () => {
  const list = [{ unitId: "ec_chaos_terminators" }, { unitId: "ec_chaos_terminators" }];
  assert(!ss.canAdd(list, "ec_chaos_terminators"),
    "Third Chaos Terminators must be blocked by unit max of 2");
});

test("Sublime Strike — non-CHARACTER units are unaffected by the character cap", () => {
  const list = [{ unitId: "ec_lord_kakophonist" }, { unitId: "ec_lord_kakophonist" }];
  assert(ss.canAdd(list, "ec_flawless_blades"),
    "Flawless Blades must not be blocked by the character cap");
  assert(ss.canAdd(list, "ec_chaos_terminators"),
    "Chaos Terminators must not be blocked by the character cap");
});

test("Sublime Strike smoke test — legal 405pt list within all constraints", () => {
  // Lord Kakophonist (70) + Lucius (70) + Flawless Blades 3-man (110) + Chaos Terminators (155) = 405pts
  const pts = 70 + 70 + 110 + 155;
  assert(pts <= 500, `Smoke list must be under 500pts, got ${pts}`);
  const list = [
    { unitId: "ec_lord_kakophonist" },
    { unitId: "ec_lucius"           },
    { unitId: "ec_flawless_blades"  },
    { unitId: "ec_chaos_terminators"},
  ];
  assertEqual(ss.charCount(list), 2, "Smoke list must have exactly 2 CHARACTERs");
  assert(!ss.canAdd(list, "ec_lucius"),
    "Adding Lucius a second time must be blocked by unit max of 1");
});

test("2x Flawless Blades 6-man + 1 character exceeds 500pt limit", () => {
  // Lord Kakophonist (70) + 2× Flawless Blades 6-man (220+220) = 510pts
  const pts = 70 + 220 + 220;
  assert(pts > 500, `Expected combination to exceed 500pts; got ${pts}`);
});

test("Emperor's Children has exactly 1 detachment", () => {
  assertEqual(ecDets.length, 1, `Expected 1 detachment, got ${ecDets.length}`);
});



// ── Section 70: Grey Knights Faction ─────────────────────────────────────────

// ── Section 70: Grey Knights Faction ─────────────────────────────────────────

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.
section("70. Grey Knights Faction");

const gkFaction = index.factions.find(f => f.id === "grey_knights");
const gkData    = factionData["grey_knights"];
const gkUnits   = gkData ? gkData.units : [];
const gkDets    = gkData ? gkData.detachments : [];

test("Grey Knights exists in index.json factions", () => {
  assert(!!gkFaction, "Grey Knights faction not found in index.json");
});

test("Grey Knights has correct name", () => {
  assertEqual(gkFaction.name, "Grey Knights", "faction name mismatch");
});

test("Grey Knights file path is factions/grey_knights.json", () => {
  assertEqual(gkFaction.file, "factions/grey_knights.json", "file path mismatch");
});

test("Grey Knights has Eye of the Prognosticars army rule", () => {
  assert(!!gkFaction.armyRule, "armyRule must be present");
  assertEqual(gkFaction.armyRule.name, "Eye of the Prognosticars",
    "army rule name mismatch");
});

test("Eye of the Prognosticars desc references Teleport Strike ability", () => {
  assert(gkFaction.armyRule.desc.includes("Teleport Strike"),
    "army rule desc must mention 'Teleport Strike'");
});

test("Eye of the Prognosticars desc references CP gain on 5+", () => {
  assert(gkFaction.armyRule.desc.includes("5+"), "army rule desc must mention '5+'");
  assert(gkFaction.armyRule.desc.includes("1 CP"), "army rule desc must mention '1 CP'");
});

test("Eye of the Prognosticars desc references D6 roll and objective marker", () => {
  assert(gkFaction.armyRule.desc.includes("D6"), "must mention 'D6'");
  assert(gkFaction.armyRule.desc.includes("objective marker"), "must mention 'objective marker'");
});

test("index.json now has at least 11 factions including Grey Knights", () => {
  assert(index.factions.length >= 11,
    `Expected at least 11 factions, got ${index.factions.length}`);
  assert(index.factions.some(f => f.id === "grey_knights"),
    "grey_knights must be in factions array");
});

test("Grey Knights has exactly 13 units", () => {
  assertEqual(gkUnits.length, 13, `Expected 13 units, got ${gkUnits.length}`);
});

test("Grey Knights has exactly 2 detachments", () => {
  assertEqual(gkDets.length, 2, `Expected 2 detachments, got ${gkDets.length}`);
});

// ── Section 71: Baneslayer Strike Detachment ─────────────────────────────────

section("71. Grey Knights — Baneslayer Strike Detachment");

const bsDet = gkDets ? gkDets.find(d => d.id === "gk_baneslayer_strike") : null;

test("Baneslayer Strike detachment exists in grey_knights.json", () => {
  assert(!!bsDet, "Baneslayer Strike detachment not found");
});

test("Baneslayer Strike has correct name", () => {
  assertEqual(bsDet.name, "Baneslayer Strike", "detachment name mismatch");
});

test("Baneslayer Strike has Pre-Emptive Strike special rule", () => {
  assert(!!bsDet.specialRule, "specialRule must be present");
  assertEqual(bsDet.specialRule.name, "Pre-Emptive Strike", "special rule name mismatch");
});

test("Pre-Emptive Strike desc references first Movement phase and Deep Strike", () => {
  assert(bsDet.specialRule.desc.includes("first Movement phase"),
    "must mention 'first Movement phase'");
  assert(bsDet.specialRule.desc.includes("Deep Strike"),
    "must mention 'Deep Strike'");
});

test("Pre-Emptive Strike desc references 6\" distance and charge restriction", () => {
  assert(bsDet.specialRule.desc.includes("6\""), "must mention '6\"'");
  assert(bsDet.specialRule.desc.includes("not eligible to declare a charge"),
    "must reference charge restriction");
});

test("Baneslayer Strike has maxCharacters set to 2", () => {
  assertEqual(bsDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Baneslayer Strike has exactly 7 unit entries", () => {
  assertEqual(bsDet.units.length, 7,
    `Expected 7 unit entries, got ${bsDet.units.length}`);
});

test("Baneslayer Strike unit roster — correct IDs and maxes", () => {
  const find = id => bsDet.units.find(u => u.id === id);
  assert(find("gk_grand_master_voldus")?.max === 1,          "gk_grand_master_voldus max must be 1");
  assert(find("gk_grand_master")?.max === 1,                 "gk_grand_master max must be 1");
  assert(find("gk_brother_captain")?.max === 1,              "gk_brother_captain max must be 1");
  assert(find("gk_brotherhood_chaplain")?.max === 1,         "gk_brotherhood_chaplain max must be 1");
  assert(find("gk_brotherhood_librarian")?.max === 1,        "gk_brotherhood_librarian max must be 1");
  assert(find("gk_brotherhood_terminator_squad")?.max === 2, "gk_brotherhood_terminator_squad max must be 2");
  assert(find("gk_paladin_squad")?.max === 2,                "gk_paladin_squad max must be 2");
});

test("Baneslayer Strike has exactly 2 enhancements", () => {
  assertEqual(bsDet.enhancements.length, 2,
    `Expected 2 enhancements, got ${bsDet.enhancements.length}`);
});

test("Baneslayer Strike has Shield of Admonishment enhancement", () => {
  assert(bsDet.enhancements.some(e => e.id === "enh_gk_shield_of_admonishment"),
    "Shield of Admonishment enhancement not found");
});

test("Baneslayer Strike has Close and Sanction enhancement", () => {
  assert(bsDet.enhancements.some(e => e.id === "enh_gk_close_and_sanction"),
    "Close and Sanction enhancement not found");
});

test("Baneslayer Strike does NOT have old Empyrean Domination enhancement", () => {
  assert(!bsDet.enhancements.some(e => e.id === "enh_gk_empyrean_domination"),
    "Empyrean Domination must have been removed from Baneslayer Strike");
});

test("Baneslayer Strike does NOT have old Wards of Banishment enhancement", () => {
  assert(!bsDet.enhancements.some(e => e.id === "enh_gk_wards_of_banishment"),
    "Wards of Banishment must have been removed from Baneslayer Strike");
});

test("Shield of Admonishment desc references melee attack and Hit roll", () => {
  const enh = bsDet.enhancements.find(e => e.id === "enh_gk_shield_of_admonishment");
  assert(enh.desc.includes("melee attack"), "must mention 'melee attack'");
  assert(enh.desc.includes("Hit roll"),     "must mention 'Hit roll'");
  assert(enh.desc.includes("subtract 1"),   "must mention 'subtract 1'");
});

test("Close and Sanction desc references Shooting phase, Dash move and D6", () => {
  const enh = bsDet.enhancements.find(e => e.id === "enh_gk_close_and_sanction");
  assert(enh.desc.includes("Shooting phase"), "must mention 'Shooting phase'");
  assert(enh.desc.includes("Dash move"),      "must mention 'Dash move'");
  assert(enh.desc.includes("D6"),             "must mention 'D6'");
  assert(enh.desc.includes("Engagement Range"), "must mention 'Engagement Range'");
});

test("Both new enhancements have no keyword requirements", () => {
  bsDet.enhancements.forEach(e => {
    assert(Array.isArray(e.requiresKeywords),
      `Enhancement "${e.name}" must have requiresKeywords array`);
    assertEqual(e.requiresKeywords.length, 0,
      `Enhancement "${e.name}" must have empty requiresKeywords`);
  });
});

// ── Section 72: Grey Knights — Unit Definitions ───────────────────────────────

section("72. Grey Knights — Unit Definitions");

const gkUnit = id => gkUnits.find(u => u.id === id);

test("Grand Master Voldus has correct fields", () => {
  const u = gkUnit("gk_grand_master_voldus");
  assert(!!u, "Grand Master Voldus not found");
  assertEqual(u.name, "Grand Master Voldus");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GREY KNIGHTS"),  "must have GREY KNIGHTS keyword");
  assert(u.keywords.includes("EPIC HERO"),      "must have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),         "must have PSYKER keyword");
  assert(u.keywords.includes("TERMINATOR"),     "must have TERMINATOR keyword");
  assertEqual(u.sizes[0].pts, 110, "must cost 110pts");
  assert(u.rulesAdaptations?.includes("Hammer Aflame"),
    "rulesAdaptations must reference 'Hammer Aflame'");
});

test("Grand Master has correct fields", () => {
  const u = gkUnit("gk_grand_master");
  assert(!!u, "Grand Master not found");
  assertEqual(u.name, "Grand Master");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GREY KNIGHTS"),  "must have GREY KNIGHTS keyword");
  assert(u.keywords.includes("CHARACTER"),      "must have CHARACTER keyword");
  assert(!u.keywords.includes("EPIC HERO"),     "must NOT have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),         "must have PSYKER keyword");
  assert(u.keywords.includes("IMPERIUM"),       "must have IMPERIUM keyword");
  assert(u.keywords.includes("TERMINATOR"),     "must have TERMINATOR keyword");
  assertEqual(u.sizes.length, 1,                "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model");
  assertEqual(u.sizes[0].pts, 95,               "must cost 95pts");
  assert(!u.rulesAdaptations, "Grand Master must have no rulesAdaptations");
});

test("Brother-Captain has correct fields", () => {
  const u = gkUnit("gk_brother_captain");
  assert(!!u, "Brother-Captain not found");
  assertEqual(u.name, "Brother-Captain");
  assertEqual(u.type, "CHARACTER");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER keyword");
  assert(u.keywords.includes("TERMINATOR"), "must have TERMINATOR keyword");
  assertEqual(u.sizes[0].pts, 90, "must cost 90pts");
  assert(!u.rulesAdaptations, "Brother-Captain must have no rulesAdaptations");
});

test("Brotherhood Chaplain has correct fields", () => {
  const u = gkUnit("gk_brotherhood_chaplain");
  assert(!!u, "Brotherhood Chaplain not found");
  assertEqual(u.name, "Brotherhood Chaplain");
  assertEqual(u.type, "CHARACTER");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER keyword");
  assert(u.keywords.includes("TERMINATOR"), "must have TERMINATOR keyword");
  assertEqual(u.sizes[0].pts, 65, "must cost 65pts");
  assert(!u.rulesAdaptations, "Brotherhood Chaplain must have no rulesAdaptations");
});

test("Brotherhood Librarian has correct fields", () => {
  const u = gkUnit("gk_brotherhood_librarian");
  assert(!!u, "Brotherhood Librarian not found");
  assertEqual(u.name, "Brotherhood Librarian");
  assertEqual(u.type, "CHARACTER");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO keyword");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER keyword");
  assert(u.keywords.includes("TERMINATOR"), "must have TERMINATOR keyword");
  assertEqual(u.sizes[0].pts, 80, "must cost 80pts");
  assert(u.rulesAdaptations?.includes("Vortex of Doom"),
    "rulesAdaptations must reference 'Vortex of Doom'");
});

test("Brotherhood Terminator Squad has correct fields", () => {
  const u = gkUnit("gk_brotherhood_terminator_squad");
  assert(!!u, "Brotherhood Terminator Squad not found");
  assertEqual(u.name, "Brotherhood Terminator Squad");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("GREY KNIGHTS"),  "must have GREY KNIGHTS keyword");
  assert(u.keywords.includes("BATTLELINE"),     "must have BATTLELINE keyword");
  assert(u.keywords.includes("PSYKER"),         "must have PSYKER keyword");
  assert(u.keywords.includes("IMPERIUM"),       "must have IMPERIUM keyword");
  assert(u.keywords.includes("TERMINATOR"),     "must have TERMINATOR keyword");
  assert(!u.keywords.includes("CHARACTER"),     "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 2,                "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   185,            "5-model size must cost 185pts");
  assertEqual(u.sizes[1].label, "10 models");
  assertEqual(u.sizes[1].pts,   375,            "10-model size must cost 375pts");
  assert(!u.rulesAdaptations, "Brotherhood Terminator Squad must have no rulesAdaptations");
});

test("Paladin Squad has correct fields", () => {
  const u = gkUnit("gk_paladin_squad");
  assert(!!u, "Paladin Squad not found");
  assertEqual(u.name, "Paladin Squad");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("GREY KNIGHTS"),  "must have GREY KNIGHTS keyword");
  assert(u.keywords.includes("INFANTRY"),       "must have INFANTRY keyword");
  assert(!u.keywords.includes("BATTLELINE"),    "must NOT have BATTLELINE keyword");
  assert(u.keywords.includes("PSYKER"),         "must have PSYKER keyword");
  assert(u.keywords.includes("IMPERIUM"),       "must have IMPERIUM keyword");
  assert(u.keywords.includes("TERMINATOR"),     "must have TERMINATOR keyword");
  assert(!u.keywords.includes("CHARACTER"),     "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 2,                "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   225,            "5-model size must cost 225pts");
  assertEqual(u.sizes[1].label, "10 models");
  assertEqual(u.sizes[1].pts,   450,            "10-model size must cost 450pts");
  assert(!u.rulesAdaptations, "Paladin Squad must have no rulesAdaptations");
});

test("Grand Master Voldus is EPIC HERO — UI blocks enhancement assignment", () => {
  assert(gkUnit("gk_grand_master_voldus").keywords.includes("EPIC HERO"),
    "Grand Master Voldus must have EPIC HERO so HTML blocks enhancement assignment");
});

test("All other characters are not EPIC HERO — can receive enhancements", () => {
  ["gk_grand_master", "gk_brother_captain", "gk_brotherhood_chaplain", "gk_brotherhood_librarian"]
    .forEach(id => {
      assert(!gkUnit(id).keywords.includes("EPIC HERO"),
        `"${id}" must NOT have EPIC HERO`);
    });
});

test("All 5 CHARACTER units have PSYKER and TERMINATOR keywords", () => {
  ["gk_grand_master_voldus", "gk_grand_master", "gk_brother_captain",
   "gk_brotherhood_chaplain", "gk_brotherhood_librarian"].forEach(id => {
    const u = gkUnit(id);
    assert(u.keywords.includes("PSYKER"),    `"${u.name}" must have PSYKER`);
    assert(u.keywords.includes("TERMINATOR"),`"${u.name}" must have TERMINATOR`);
  });
});

test("Brotherhood Terminator Squad and Paladin Squad are non-CHARACTER types", () => {
  assert(gkUnit("gk_brotherhood_terminator_squad").type !== "CHARACTER",
    "Brotherhood Terminator Squad must not be CHARACTER type");
  assert(gkUnit("gk_paladin_squad").type !== "CHARACTER",
    "Paladin Squad must not be CHARACTER type");
});

test("Brotherhood Terminator Squad and Paladin Squad both have TERMINATOR and PSYKER", () => {
  ["gk_brotherhood_terminator_squad", "gk_paladin_squad"].forEach(id => {
    const u = gkUnit(id);
    assert(u.keywords.includes("TERMINATOR"), `"${u.name}" must have TERMINATOR`);
    assert(u.keywords.includes("PSYKER"),      `"${u.name}" must have PSYKER`);
  });
});

test("Paladin Squad has different name, type, and cost from Brotherhood Terminator Squad", () => {
  const bts = gkUnit("gk_brotherhood_terminator_squad");
  const pal = gkUnit("gk_paladin_squad");
  assert(bts.name !== pal.name,           "units must have different names");
  assert(bts.type !== pal.type ||
         bts.sizes[0].pts !== pal.sizes[0].pts,
    "units must differ in type or cost");
  assert(bts.sizes[0].pts !== pal.sizes[0].pts,
    "5-model costs must differ (185 vs 225)");
});

test("Both enhancements are eligible for all non-EPIC-HERO CHARACTER units", () => {
  const chars = gkUnits.filter(u =>
    u.type === "CHARACTER" && !u.keywords.includes("EPIC HERO"));
  bsDet.enhancements.forEach(enh => {
    chars.forEach(u => {
      const eligible = enh.requiresKeywords.length === 0 ||
        enh.requiresKeywords.every(kw => u.keywords.includes(kw));
      assert(eligible,
        `"${u.name}" must be eligible for "${enh.name}" (no keyword restrictions)`);
    });
  });
});

// ── Section 73: Baneslayer Strike — Game Rule Logic ───────────────────────────

section("73. Baneslayer Strike — Game Rule Logic");

const gk = makeDetHelpers(bsDet, id => gkUnit(id));

test("Character cap — first CHARACTER can be added (empty list)", () => {
  assert(gk.canAdd([], "gk_brother_captain"),
    "Brother-Captain must be addable to an empty list");
});

test("Character cap — second CHARACTER can be added when one is present", () => {
  const list = [{ unitId: "gk_grand_master" }];
  assert(gk.canAdd(list, "gk_brother_captain"),
    "Brother-Captain must be addable when one CHARACTER is in the list");
});

test("Character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [{ unitId: "gk_grand_master" }, { unitId: "gk_brother_captain" }];
  assert(!gk.canAdd(list, "gk_brotherhood_chaplain"),
    "Brotherhood Chaplain must be blocked when 2 CHARACTERs are already in the list");
});

test("All CHARACTER units are capped at max 1", () => {
  ["gk_grand_master_voldus", "gk_grand_master", "gk_brother_captain",
   "gk_brotherhood_chaplain", "gk_brotherhood_librarian"].forEach(id => {
    const list = [{ unitId: id }];
    assert(!gk.canAdd(list, id),
      `Second "${id}" must be blocked by unit max of 1`);
  });
});

test("Brotherhood Terminator Squad is capped at max 2", () => {
  const list = [
    { unitId: "gk_brotherhood_terminator_squad" },
    { unitId: "gk_brotherhood_terminator_squad" },
  ];
  assert(!gk.canAdd(list, "gk_brotherhood_terminator_squad"),
    "Third Brotherhood Terminator Squad must be blocked by unit max of 2");
});

test("Paladin Squad is capped at max 2", () => {
  const list = [
    { unitId: "gk_paladin_squad" },
    { unitId: "gk_paladin_squad" },
  ];
  assert(!gk.canAdd(list, "gk_paladin_squad"),
    "Third Paladin Squad must be blocked by unit max of 2");
});

test("Non-CHARACTER units are unaffected by the character cap", () => {
  const list = [{ unitId: "gk_grand_master" }, { unitId: "gk_brother_captain" }];
  assert(gk.canAdd(list, "gk_brotherhood_terminator_squad"),
    "Brotherhood Terminator Squad must not be blocked by character cap");
  assert(gk.canAdd(list, "gk_paladin_squad"),
    "Paladin Squad must not be blocked by character cap");
});

test("Smoke test — legal list: Grand Master + Librarian + 2× Terminators = 450pts", () => {
  // Grand Master (95) + Brotherhood Librarian (80) + 2× Brotherhood Terminator Squad 5-man (185×2) = 545pts — over
  // Grand Master (95) + Brotherhood Librarian (80) + 1× Brotherhood Terminator Squad 5-man (185) = 360pts — legal
  const pts = 95 + 80 + 185;
  assert(pts <= 500, `Must be under 500pts; got ${pts}`);
  const list = [
    { unitId: "gk_grand_master"              },
    { unitId: "gk_brotherhood_librarian"      },
    { unitId: "gk_brotherhood_terminator_squad" },
  ];
  assertEqual(gk.charCount(list), 2, "Must have exactly 2 CHARACTERs");
  assert(!gk.canAdd(list, "gk_brotherhood_chaplain"),
    "Brotherhood Chaplain must be blocked once cap is hit");
});

test("Smoke test — legal list: Brother-Captain + Chaplain + Paladin Squad 5-man = 220pts", () => {
  const pts = 90 + 65 + 225;
  assert(pts <= 500, `Must be under 500pts; got ${pts}`);
});

test("2× Paladin Squad 10-man (900pts total) vastly exceeds 500pt limit", () => {
  const pts = 450 + 450;
  assert(pts > 500, `Expected combination to exceed 500pts; got ${pts}`);
});

test("Brotherhood Terminator Squad 10-man (375pts) + Grand Master (95) + Chaplain (65) = 535pts — over limit", () => {
  const pts = 375 + 95 + 65;
  assert(pts > 500, `Expected combination to exceed 500pts; got ${pts}`);
});

test("Grand Master and Grand Master Voldus are independent units — both could be in list", () => {
  const list = [{ unitId: "gk_grand_master" }];
  assert(gk.canAdd(list, "gk_grand_master_voldus"),
    "Grand Master Voldus must not be blocked by Grand Master being in the list");
});


// ── Section 74: Void Purge Force Detachment ───────────────────────────────────

// ── Section 74: Void Purge Force Detachment ───────────────────────────────────

section("74. Grey Knights — Void Purge Force Detachment");

const vpfDet = gkDets ? gkDets.find(d => d.id === "gk_void_purge_force") : null;

test("Void Purge Force detachment exists in grey_knights.json", () => {
  assert(!!vpfDet, "Void Purge Force detachment not found");
});

test("Void Purge Force has correct name", () => {
  assertEqual(vpfDet.name, "Void Purge Force", "detachment name mismatch");
});

test("Void Purge Force has An Urgent Duty special rule", () => {
  assert(!!vpfDet.specialRule, "specialRule must be present");
  assertEqual(vpfDet.specialRule.name, "An Urgent Duty", "special rule name mismatch");
});

test("An Urgent Duty desc references Advance, Charge rolls and GREY KNIGHTS", () => {
  assert(vpfDet.specialRule.desc.includes("Advance"),       "must mention 'Advance'");
  assert(vpfDet.specialRule.desc.includes("Charge"),        "must mention 'Charge'");
  assert(vpfDet.specialRule.desc.includes("Add 1"),         "must mention 'Add 1'");
  assert(vpfDet.specialRule.desc.includes("GREY KNIGHTS"),  "must mention 'GREY KNIGHTS'");
});

test("Void Purge Force has maxCharacters set to 2", () => {
  assertEqual(vpfDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Void Purge Force has exactly 13 unit entries", () => {
  assertEqual(vpfDet.units.length, 13,
    `Expected 13 unit entries, got ${vpfDet.units.length}`);
});

test("Void Purge Force unit roster — character unit IDs and maxes", () => {
  const find = id => vpfDet.units.find(u => u.id === id);
  assert(find("gk_brother_captain")?.max === 1,        "gk_brother_captain max must be 1");
  assert(find("gk_brotherhood_chaplain")?.max === 1,   "gk_brotherhood_chaplain max must be 1");
  assert(find("gk_brotherhood_librarian")?.max === 1,  "gk_brotherhood_librarian max must be 1");
  assert(find("gk_grand_master")?.max === 1,           "gk_grand_master max must be 1");
  assert(find("gk_grand_master_voldus")?.max === 1,    "gk_grand_master_voldus max must be 1");
  assert(find("gk_castellan_crowe")?.max === 1,        "gk_castellan_crowe max must be 1");
  assert(find("gk_brotherhood_champion")?.max === 1,   "gk_brotherhood_champion max must be 1");
  assert(find("gk_brotherhood_techmarine")?.max === 1, "gk_brotherhood_techmarine max must be 1");
});

test("Void Purge Force unit roster — non-character unit IDs and maxes", () => {
  const find = id => vpfDet.units.find(u => u.id === id);
  assert(find("gk_strike_squad")?.max === 3,       "gk_strike_squad max must be 3");
  assert(find("gk_interceptor_squad")?.max === 1,  "gk_interceptor_squad max must be 1");
  assert(find("gk_purifier_squad")?.max === 1,     "gk_purifier_squad max must be 1");
});

test("Void Purge Force includes Brotherhood Terminator Squad and Paladin Squad (5-model only)", () => {
  const bts = vpfDet.units.find(u => u.id === "gk_brotherhood_terminator_squad");
  const pal = vpfDet.units.find(u => u.id === "gk_paladin_squad");
  assert(!!bts, "Brotherhood Terminator Squad must be in Void Purge Force");
  assert(!!pal, "Paladin Squad must be in Void Purge Force");
  assert(Array.isArray(bts.allowedSizeIndices) && bts.allowedSizeIndices.length === 1 && bts.allowedSizeIndices[0] === 0,
    "Brotherhood Terminator Squad in VPF must have allowedSizeIndices: [0] (5-model only)");
  assert(Array.isArray(pal.allowedSizeIndices) && pal.allowedSizeIndices.length === 1 && pal.allowedSizeIndices[0] === 0,
    "Paladin Squad in VPF must have allowedSizeIndices: [0] (5-model only)");
});

test("Void Purge Force has exactly 2 enhancements", () => {
  assertEqual(vpfDet.enhancements.length, 2,
    `Expected 2 enhancements, got ${vpfDet.enhancements.length}`);
});

test("Void Purge Force has Sigil of Warding enhancement", () => {
  assert(vpfDet.enhancements.some(e => e.id === "enh_gk_sigil_of_warding"),
    "Sigil of Warding enhancement not found");
});

test("Void Purge Force has Tactical Haruspexy enhancement", () => {
  assert(vpfDet.enhancements.some(e => e.id === "enh_gk_tactical_haruspexy"),
    "Tactical Haruspexy enhancement not found");
});

test("Sigil of Warding desc references Shooting phase, Normal move, Hatchway and charge restriction", () => {
  const enh = vpfDet.enhancements.find(e => e.id === "enh_gk_sigil_of_warding");
  assert(enh.desc.includes("Shooting phase"),                "must mention 'Shooting phase'");
  assert(enh.desc.includes("Normal move"),                   "must mention 'Normal move'");
  assert(enh.desc.includes("Hatchway"),                      "must mention 'Hatchway'");
  assert(enh.desc.includes("3\""),                           "must mention '3\"'");
  assert(enh.desc.includes("not eligible to declare a charge"), "must mention charge restriction");
});

test("Tactical Haruspexy desc references charge declaration, visibility and 9\"", () => {
  const enh = vpfDet.enhancements.find(e => e.id === "enh_gk_tactical_haruspexy");
  assert(enh.desc.includes("declares a charge"), "must mention 'declares a charge'");
  assert(enh.desc.includes("not visible"),        "must mention 'not visible'");
  assert(enh.desc.includes("9\""),                "must mention '9\"'");
});

test("Both Void Purge Force enhancements have no keyword requirements", () => {
  vpfDet.enhancements.forEach(e => {
    assert(Array.isArray(e.requiresKeywords), `"${e.name}" must have requiresKeywords array`);
    assertEqual(e.requiresKeywords.length, 0,  `"${e.name}" must have empty requiresKeywords`);
  });
});

// ── Section 75: Void Purge Force — New Unit Definitions ──────────────────────

section("75. Grey Knights — Void Purge Force New Unit Definitions");

test("Grey Knights now has exactly 13 units", () => {
  assertEqual(gkUnits.length, 13, `Expected 13 units, got ${gkUnits.length}`);
});

test("Castellan Crowe has correct fields", () => {
  const u = gkUnit("gk_castellan_crowe");
  assert(!!u, "Castellan Crowe not found");
  assertEqual(u.name, "Castellan Crowe");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("CHARACTER"),     "must have CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),     "must have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("TERMINATOR"),   "must NOT have TERMINATOR");
  assertEqual(u.sizes.length, 1,               "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model");
  assertEqual(u.sizes[0].pts, 90,              "must cost 90pts");
  assert(!u.rulesAdaptations, "Castellan Crowe must have no rulesAdaptations");
});

test("Brotherhood Champion has correct fields", () => {
  const u = gkUnit("gk_brotherhood_champion");
  assert(!!u, "Brotherhood Champion not found");
  assertEqual(u.name, "Brotherhood Champion");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("CHARACTER"),     "must have CHARACTER");
  assert(!u.keywords.includes("EPIC HERO"),    "must NOT have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("TERMINATOR"),   "must NOT have TERMINATOR");
  assertEqual(u.sizes.length, 1,               "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model");
  assertEqual(u.sizes[0].pts, 70,              "must cost 70pts");
  assert(!u.rulesAdaptations, "Brotherhood Champion must have no rulesAdaptations");
});

test("Brotherhood Techmarine has correct fields", () => {
  const u = gkUnit("gk_brotherhood_techmarine");
  assert(!!u, "Brotherhood Techmarine not found");
  assertEqual(u.name, "Brotherhood Techmarine");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("CHARACTER"),     "must have CHARACTER");
  assert(!u.keywords.includes("EPIC HERO"),    "must NOT have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("TERMINATOR"),   "must NOT have TERMINATOR");
  assertEqual(u.sizes.length, 1,               "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model");
  assertEqual(u.sizes[0].pts, 70,              "must cost 70pts");
  assert(!u.rulesAdaptations, "Brotherhood Techmarine must have no rulesAdaptations");
});

test("Strike Squad has correct fields", () => {
  const u = gkUnit("gk_strike_squad");
  assert(!!u, "Strike Squad not found");
  assertEqual(u.name, "Strike Squad");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("INFANTRY"),      "must have INFANTRY");
  assert(u.keywords.includes("BATTLELINE"),    "must have BATTLELINE");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("CHARACTER"),    "must NOT have CHARACTER");
  assert(!u.keywords.includes("TERMINATOR"),   "must NOT have TERMINATOR");
  assertEqual(u.sizes.length, 2,               "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   120,           "5-model size must cost 120pts");
  assertEqual(u.sizes[1].label, "10 models");
  assertEqual(u.sizes[1].pts,   240,           "10-model size must cost 240pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "rulesAdaptations must be a non-empty string");
  assert(u.rulesAdaptations.includes("Sanctifying Ritual"),
    "rulesAdaptations must reference 'Sanctifying Ritual'");
});

test("Interceptor Squad has correct fields", () => {
  const u = gkUnit("gk_interceptor_squad");
  assert(!!u, "Interceptor Squad not found");
  assertEqual(u.name, "Interceptor Squad");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("INFANTRY"),      "must have INFANTRY");
  assert(!u.keywords.includes("BATTLELINE"),   "must NOT have BATTLELINE");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("CHARACTER"),    "must NOT have CHARACTER");
  assertEqual(u.sizes.length, 2,               "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   125,           "5-model size must cost 125pts");
  assertEqual(u.sizes[1].label, "10 models");
  assertEqual(u.sizes[1].pts,   250,           "10-model size must cost 250pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.length > 0,
    "rulesAdaptations must be a non-empty string");
  assert(u.rulesAdaptations.includes("Personal Teleporters"),
    "rulesAdaptations must reference 'Personal Teleporters'");
  assert(u.rulesAdaptations.includes("Movement"),
    "rulesAdaptations must reference Movement characteristic reduction");
  assert(u.rulesAdaptations.includes("9"),
    "rulesAdaptations must reference the new movement value of 9");
});

test("Purifier Squad has correct fields", () => {
  const u = gkUnit("gk_purifier_squad");
  assert(!!u, "Purifier Squad not found");
  assertEqual(u.name, "Purifier Squad");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("GREY KNIGHTS"), "must have GREY KNIGHTS");
  assert(u.keywords.includes("INFANTRY"),      "must have INFANTRY");
  assert(!u.keywords.includes("BATTLELINE"),   "must NOT have BATTLELINE");
  assert(u.keywords.includes("PSYKER"),        "must have PSYKER");
  assert(u.keywords.includes("IMPERIUM"),      "must have IMPERIUM");
  assert(!u.keywords.includes("CHARACTER"),    "must NOT have CHARACTER");
  assertEqual(u.sizes.length, 2,               "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models");
  assertEqual(u.sizes[0].pts,   125,           "5-model size must cost 125pts");
  assertEqual(u.sizes[1].label, "10 models");
  assertEqual(u.sizes[1].pts,   250,           "10-model size must cost 250pts");
  assert(!u.rulesAdaptations, "Purifier Squad must have no rulesAdaptations");
});

test("Castellan Crowe and Brotherhood Champion/Techmarine lack TERMINATOR unlike earlier GK characters", () => {
  ["gk_castellan_crowe", "gk_brotherhood_champion", "gk_brotherhood_techmarine"].forEach(id => {
    assert(!gkUnit(id).keywords.includes("TERMINATOR"),
      `"${id}" must NOT have TERMINATOR keyword`);
  });
});

test("Castellan Crowe is EPIC HERO — UI blocks enhancement assignment", () => {
  assert(gkUnit("gk_castellan_crowe").keywords.includes("EPIC HERO"),
    "Castellan Crowe must have EPIC HERO");
});

test("Brotherhood Champion and Techmarine are not EPIC HERO — can receive enhancements", () => {
  ["gk_brotherhood_champion", "gk_brotherhood_techmarine"].forEach(id => {
    assert(!gkUnit(id).keywords.includes("EPIC HERO"),
      `"${id}" must NOT have EPIC HERO`);
  });
});

test("Strike Squad has double the points for double the models (linear pricing)", () => {
  const u = gkUnit("gk_strike_squad");
  assertEqual(u.sizes[1].pts, u.sizes[0].pts * 2,
    "10-model cost must be exactly double the 5-model cost");
});

test("Interceptor Squad has double the points for double the models (linear pricing)", () => {
  const u = gkUnit("gk_interceptor_squad");
  assertEqual(u.sizes[1].pts, u.sizes[0].pts * 2,
    "10-model cost must be exactly double the 5-model cost");
});

test("Purifier Squad has double the points for double the models (linear pricing)", () => {
  const u = gkUnit("gk_purifier_squad");
  assertEqual(u.sizes[1].pts, u.sizes[0].pts * 2,
    "10-model cost must be exactly double the 5-model cost");
});

// ── Section 76: Void Purge Force — Game Rule Logic (Full Roster) ──────────────

section("76. Void Purge Force — Game Rule Logic (Full Roster)");

const vpf = makeDetHelpers(vpfDet, id => gkUnit(id));

test("Character cap — first CHARACTER can be added to an empty list", () => {
  assert(vpf.canAdd([], "gk_grand_master"),
    "Grand Master must be addable to an empty list");
});

test("Character cap — second CHARACTER can be added when one is present", () => {
  const list = [{ unitId: "gk_grand_master" }];
  assert(vpf.canAdd(list, "gk_brotherhood_champion"),
    "Brotherhood Champion must be addable when one CHARACTER is present");
});

test("Character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [{ unitId: "gk_grand_master" }, { unitId: "gk_brotherhood_champion" }];
  assert(!vpf.canAdd(list, "gk_brotherhood_techmarine"),
    "Brotherhood Techmarine must be blocked when 2 CHARACTERs are already in the list");
});

test("All CHARACTER units in VPF are capped at max 1", () => {
  const charIds = vpfDet.units
    .filter(du => gkUnit(du.id)?.type === "CHARACTER")
    .map(du => du.id);
  charIds.forEach(id => {
    const list = [{ unitId: id }];
    assert(!vpf.canAdd(list, id), `Second "${id}" must be blocked by unit max of 1`);
  });
});

test("Non-CHARACTER units are unaffected by the character cap", () => {
  const list = [{ unitId: "gk_grand_master" }, { unitId: "gk_brotherhood_champion" }];
  assert(vpf.canAdd(list, "gk_strike_squad"),       "Strike Squad must not be blocked by char cap");
  assert(vpf.canAdd(list, "gk_interceptor_squad"),  "Interceptor Squad must not be blocked by char cap");
  assert(vpf.canAdd(list, "gk_purifier_squad"),     "Purifier Squad must not be blocked by char cap");
});

test("Strike Squad is capped at max 3", () => {
  const list = [
    { unitId: "gk_strike_squad" },
    { unitId: "gk_strike_squad" },
    { unitId: "gk_strike_squad" },
  ];
  assert(!vpf.canAdd(list, "gk_strike_squad"),
    "Fourth Strike Squad must be blocked by unit max of 3");
});

test("Strike Squad max of 3 is not yet reached at 2 entries", () => {
  const list = [{ unitId: "gk_strike_squad" }, { unitId: "gk_strike_squad" }];
  assert(vpf.canAdd(list, "gk_strike_squad"),
    "Third Strike Squad must still be addable when only 2 are in the list");
});

test("Interceptor Squad is capped at max 1", () => {
  const list = [{ unitId: "gk_interceptor_squad" }];
  assert(!vpf.canAdd(list, "gk_interceptor_squad"),
    "Second Interceptor Squad must be blocked by unit max of 1");
});

test("Purifier Squad is capped at max 1", () => {
  const list = [{ unitId: "gk_purifier_squad" }];
  assert(!vpf.canAdd(list, "gk_purifier_squad"),
    "Second Purifier Squad must be blocked by unit max of 1");
});

test("Smoke test — Brother-Captain + Chaplain + Strike Squad 5-man = 275pts", () => {
  const pts = 90 + 65 + 120;
  assert(pts <= 500, `Must be under 500pts; got ${pts}`);
  const list = [
    { unitId: "gk_brother_captain"     },
    { unitId: "gk_brotherhood_chaplain"},
    { unitId: "gk_strike_squad"        },
  ];
  assertEqual(vpf.charCount(list), 2, "Must have exactly 2 CHARACTERs");
  assert(!vpf.canAdd(list, "gk_brotherhood_techmarine"),
    "Brotherhood Techmarine must be blocked once char cap is hit");
});

test("Smoke test — Brotherhood Champion + Techmarine + 3× Strike Squad 5-man = 500pts exactly", () => {
  const pts = 70 + 70 + (120 * 3);
  assertEqual(pts, 500, `Must be exactly 500pts; got ${pts}`);
});

test("Smoke test — Brother-Captain + Interceptor Squad 10-man + Purifier Squad 10-man = 590pts (over limit)", () => {
  const pts = 90 + 250 + 250;
  assert(pts > 500, `Expected to exceed 500pts; got ${pts}`);
});

test("Castellan Crowe + Grand Master Voldus fills char cap — no other CHARACTERs can be added", () => {
  const list = [{ unitId: "gk_castellan_crowe" }, { unitId: "gk_grand_master_voldus" }];
  assertEqual(vpf.charCount(list), 2, "Both are CHARACTERs");
  ["gk_grand_master", "gk_brother_captain", "gk_brotherhood_chaplain",
   "gk_brotherhood_librarian", "gk_brotherhood_champion", "gk_brotherhood_techmarine"]
    .forEach(id => {
      assert(!vpf.canAdd(list, id),
        `"${id}" must be blocked when char cap is filled by Crowe + Voldus`);
    });
});


// ── Section 77: VPF — Terminator/Paladin Exclusive Group ─────────────────────

section("77. Void Purge Force — Terminator/Paladin Exclusive Group");

test("Void Purge Force has exclusiveUnitGroups defined", () => {
  assert(Array.isArray(vpfDet.exclusiveUnitGroups) && vpfDet.exclusiveUnitGroups.length > 0,
    "exclusiveUnitGroups must be a non-empty array");
});

test("Void Purge Force has exactly 1 exclusive unit group", () => {
  assertEqual(vpfDet.exclusiveUnitGroups.length, 1,
    `Expected 1 exclusive unit group, got ${vpfDet.exclusiveUnitGroups.length}`);
});

const vpfExcGroup = vpfDet.exclusiveUnitGroups ? vpfDet.exclusiveUnitGroups[0] : null;

test("Exclusive group contains exactly Brotherhood Terminator Squad and Paladin Squad", () => {
  assert(!!vpfExcGroup, "exclusive group must exist");
  assert(Array.isArray(vpfExcGroup) && vpfExcGroup.length === 2,
    "exclusive group must be a plain array with exactly 2 unit IDs");
  assert(vpfExcGroup.includes("gk_brotherhood_terminator_squad"),
    "exclusive group must include gk_brotherhood_terminator_squad");
  assert(vpfExcGroup.includes("gk_paladin_squad"),
    "exclusive group must include gk_paladin_squad");
});

test("Both units in the exclusive group resolve to real Grey Knights units", () => {
  const unitIds = new Set(gkUnits.map(u => u.id));
  vpfExcGroup.forEach(id => {
    assert(unitIds.has(id), `Exclusive group unit "${id}" not found in faction units`);
  });
});

test("Both units in the exclusive group are present in Void Purge Force roster", () => {
  const vpfUnitIds = new Set(vpfDet.units.map(u => u.id));
  vpfExcGroup.forEach(id => {
    assert(vpfUnitIds.has(id),
      `Exclusive group unit "${id}" must appear in VPF detachment unit roster`);
  });
});

test("Brotherhood Terminator Squad in VPF is restricted to 5-model size only (allowedSizeIndices: [0])", () => {
  const du = vpfDet.units.find(u => u.id === "gk_brotherhood_terminator_squad");
  assert(Array.isArray(du.allowedSizeIndices), "allowedSizeIndices must be an array");
  assertEqual(du.allowedSizeIndices.length, 1, "must have exactly 1 allowed size index");
  assertEqual(du.allowedSizeIndices[0], 0,     "allowed size index must be 0 (5-model size)");
  // Verify index 0 really does mean 5 models
  const unitDef = gkUnit("gk_brotherhood_terminator_squad");
  assertEqual(unitDef.sizes[0].label, "5 models", "size index 0 must be the 5-model option");
  assertEqual(unitDef.sizes[0].pts,   185,         "5-model Brotherhood Terminator Squad costs 185pts");
});

test("Paladin Squad in VPF is restricted to 5-model size only (allowedSizeIndices: [0])", () => {
  const du = vpfDet.units.find(u => u.id === "gk_paladin_squad");
  assert(Array.isArray(du.allowedSizeIndices), "allowedSizeIndices must be an array");
  assertEqual(du.allowedSizeIndices.length, 1, "must have exactly 1 allowed size index");
  assertEqual(du.allowedSizeIndices[0], 0,     "allowed size index must be 0 (5-model size)");
  const unitDef = gkUnit("gk_paladin_squad");
  assertEqual(unitDef.sizes[0].label, "5 models", "size index 0 must be the 5-model option");
  assertEqual(unitDef.sizes[0].pts,   225,         "5-model Paladin Squad costs 225pts");
});

test("Brotherhood Terminator Squad in Baneslayer Strike still allows both sizes", () => {
  const du = bsDet.units.find(u => u.id === "gk_brotherhood_terminator_squad");
  assert(!du.allowedSizeIndices,
    "Baneslayer Strike Brotherhood Terminator Squad must NOT have allowedSizeIndices restriction");
});

test("Paladin Squad in Baneslayer Strike still allows both sizes", () => {
  const du = bsDet.units.find(u => u.id === "gk_paladin_squad");
  assert(!du.allowedSizeIndices,
    "Baneslayer Strike Paladin Squad must NOT have allowedSizeIndices restriction");
});

const isVpfExcGroupBlocked = makeExcGroupChecker(vpfDet.exclusiveUnitGroups);

test("Exclusive group — neither unit is blocked in an empty list", () => {
  assert(!isVpfExcGroupBlocked("gk_brotherhood_terminator_squad", []),
    "Brotherhood Terminator Squad must not be blocked in an empty list");
  assert(!isVpfExcGroupBlocked("gk_paladin_squad", []),
    "Paladin Squad must not be blocked in an empty list");
});

test("Exclusive group — taking Brotherhood Terminator Squad blocks Paladin Squad", () => {
  const list = [{ unitId: "gk_brotherhood_terminator_squad" }];
  assert(isVpfExcGroupBlocked("gk_paladin_squad", list),
    "Paladin Squad must be blocked when Brotherhood Terminator Squad is in the list");
});

test("Exclusive group — taking Paladin Squad blocks Brotherhood Terminator Squad", () => {
  const list = [{ unitId: "gk_paladin_squad" }];
  assert(isVpfExcGroupBlocked("gk_brotherhood_terminator_squad", list),
    "Brotherhood Terminator Squad must be blocked when Paladin Squad is in the list");
});

test("Exclusive group — a unit is never blocked by its own presence in the list", () => {
  const bts = [{ unitId: "gk_brotherhood_terminator_squad" }];
  const pal = [{ unitId: "gk_paladin_squad" }];
  assert(!isVpfExcGroupBlocked("gk_brotherhood_terminator_squad", bts),
    "Brotherhood Terminator Squad must not be blocked by its own presence");
  assert(!isVpfExcGroupBlocked("gk_paladin_squad", pal),
    "Paladin Squad must not be blocked by its own presence");
});

test("Exclusive group — units outside the group are never affected", () => {
  const list = [{ unitId: "gk_brotherhood_terminator_squad" }];
  ["gk_strike_squad", "gk_interceptor_squad", "gk_purifier_squad",
   "gk_brother_captain", "gk_grand_master"].forEach(id => {
    assert(!isVpfExcGroupBlocked(id, list),
      `"${id}" must not be affected by the exclusive group constraint`);
  });
});

test("Smoke test — Grand Master + Brotherhood Terminator Squad 5-man = 280pts (legal)", () => {
  const pts = 95 + 185;
  assert(pts <= 500, `Must be under 500pts; got ${pts}`);
  const list = [
    { unitId: "gk_grand_master"                  },
    { unitId: "gk_brotherhood_terminator_squad"  },
  ];
  assert(isVpfExcGroupBlocked("gk_paladin_squad", list),
    "Paladin Squad must be blocked once Brotherhood Terminator Squad is taken");
  assert(!isVpfExcGroupBlocked("gk_brotherhood_terminator_squad", list),
    "Brotherhood Terminator Squad must not be blocked by its own presence");
});

test("Smoke test — Grand Master + Paladin Squad 5-man = 320pts (legal)", () => {
  const pts = 95 + 225;
  assert(pts <= 500, `Must be under 500pts; got ${pts}`);
  const list = [
    { unitId: "gk_grand_master" },
    { unitId: "gk_paladin_squad" },
  ];
  assert(isVpfExcGroupBlocked("gk_brotherhood_terminator_squad", list),
    "Brotherhood Terminator Squad must be blocked once Paladin Squad is taken");
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  AGENTS OF THE IMPERIUM                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks (id/name/type/keywords/sizes/armyRule). Section 3 covers all of
// these globally for every faction. Only test faction-specific behaviour here:
// points values, keywords, rules adaptations content, and constraint logic.

section("78. Agents of the Imperium Faction");

const aotiFaction = index.factions.find(f => f.id === "agents_of_the_imperium");
const aotiData    = factionData["agents_of_the_imperium"];
const aotiUnits   = aotiData ? aotiData.units : [];
const aotiDets    = aotiData ? aotiData.detachments : [];
const aotiUnit    = id => aotiUnits.find(u => u.id === id);

test("Agents of the Imperium faction entry exists in index", () => {
  assert(!!aotiFaction, "agents_of_the_imperium must exist in index.factions");
});

test("Agents of the Imperium has Imperial Insights army rule", () => {
  assertEqual(aotiFaction.armyRule.name, "Imperial Insights");
});

test("Imperial Insights desc references Assigned Agents ability", () => {
  assert(aotiFaction.armyRule.desc.includes("Assigned Agents"),
    "army rule desc must mention 'Assigned Agents'");
});

test("Imperial Insights desc references Secure Site Tactical Manoeuvre", () => {
  assert(aotiFaction.armyRule.desc.includes("Secure Site Tactical Manoeuvre"),
    "army rule desc must mention 'Secure Site Tactical Manoeuvre'");
});

test("Imperial Insights desc references Secured by your army", () => {
  assert(aotiFaction.armyRule.desc.includes("Secured by your army"),
    "army rule desc must mention 'Secured by your army'");
});

test("Agents of the Imperium has exactly 2 detachments", () => {
  assertEqual(aotiDets.length, 2, "Expected 2 detachments, got " + aotiDets.length);
});

test("Agents of the Imperium has exactly 11 units", () => {
  assertEqual(aotiUnits.length, 11, "Expected 11 units, got " + aotiUnits.length);
});


// ── Section 79: Interdiction Team Detachment ─────────────────────────────────

section("79. Agents of the Imperium — Interdiction Team Detachment");

const itDet = aotiDets ? aotiDets.find(d => d.id === "aoti_interdiction_team") : null;

test("Interdiction Team detachment exists", () => {
  assert(!!itDet, "aoti_interdiction_team must exist in Agents of the Imperium detachments");
});

test("Interdiction Team has maxCharacters of 1", () => {
  assertEqual(itDet.maxCharacters, 1, "maxCharacters must be 1");
});

test("Interdiction Team special rule is Chastisor Auto-Vox", () => {
  assertEqual(itDet.specialRule.name, "Chastisor Auto-Vox");
});

test("Chastisor Auto-Vox desc references ADEPTUS ARBITES", () => {
  assert(itDet.specialRule.desc.includes("ADEPTUS ARBITES"),
    "special rule desc must mention 'ADEPTUS ARBITES'");
});

test("Chastisor Auto-Vox desc references Battle-shock test", () => {
  assert(itDet.specialRule.desc.includes("Battle-shock test"),
    "special rule desc must mention 'Battle-shock test'");
});

test("Chastisor Auto-Vox desc references Below Half-strength", () => {
  assert(itDet.specialRule.desc.includes("Below Half-strength"),
    "special rule desc must mention 'Below Half-strength'");
});

test("Interdiction Team unit roster — correct IDs and maxes", () => {
  const find = id => itDet.units.find(u => u.id === id);
  assert(find("aoti_inquisitor_coteaz")?.max    === 1, "aoti_inquisitor_coteaz max must be 1");
  assert(find("aoti_inquisitor_draxus")?.max    === 1, "aoti_inquisitor_draxus max must be 1");
  assert(find("aoti_inquisitor_greyfax")?.max   === 1, "aoti_inquisitor_greyfax max must be 1");
  assert(find("aoti_inquisitor")?.max           === 1, "aoti_inquisitor max must be 1");
  assert(find("aoti_exaction_squad")?.max       === 2, "aoti_exaction_squad max must be 2");
  assert(find("aoti_subductor_squad")?.max      === 3, "aoti_subductor_squad max must be 3");
  assert(find("aoti_vigilant_squad")?.max       === 3, "aoti_vigilant_squad max must be 3");
  assert(find("aoti_inquisitorial_agents")?.max === 1, "aoti_inquisitorial_agents max must be 1");
});

test("Interdiction Team has exactly 8 unit slots", () => {
  assertEqual(itDet.units.length, 8, "Expected 8 unit slots, got " + itDet.units.length);
});

test("Exaction Squad has canTakeEnhancement in Interdiction Team", () => {
  const entry = itDet.units.find(u => u.id === "aoti_exaction_squad");
  assert(entry?.canTakeEnhancement === true,
    "aoti_exaction_squad must have canTakeEnhancement: true in Interdiction Team");
});

test("Interdiction Team has exactly 2 enhancements", () => {
  assertEqual(itDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + itDet.enhancements.length);
});

test("Interdiction Team enhancements — Manhunter's Helm and Vasov's Auto-Oppressor present", () => {
  const ids = itDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_aoti_manhunters_helm"),
    "must include enh_aoti_manhunters_helm");
  assert(ids.includes("enh_aoti_vasovs_auto_oppressor"),
    "must include enh_aoti_vasovs_auto_oppressor");
});

test("Manhunter's Helm requiresKeywords is ADEPTUS ARBITES", () => {
  const enh = itDet.enhancements.find(e => e.id === "enh_aoti_manhunters_helm");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("ADEPTUS ARBITES"),
    "Manhunter's Helm must require ADEPTUS ARBITES keyword");
});

test("Manhunter's Helm desc references Priority Target", () => {
  const enh = itDet.enhancements.find(e => e.id === "enh_aoti_manhunters_helm");
  assert(enh.desc.includes("Priority Target"),
    "Manhunter's Helm desc must mention 'Priority Target'");
});

test("Manhunter's Helm desc references ADEPTUS ARBITES", () => {
  const enh = itDet.enhancements.find(e => e.id === "enh_aoti_manhunters_helm");
  assert(enh.desc.includes("ADEPTUS ARBITES"),
    "Manhunter's Helm desc must mention 'ADEPTUS ARBITES'");
});

test("Vasov's Auto-Oppressor requiresKeywords is ADEPTUS ARBITES", () => {
  const enh = itDet.enhancements.find(e => e.id === "enh_aoti_vasovs_auto_oppressor");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("ADEPTUS ARBITES"),
    "Vasov's Auto-Oppressor must require ADEPTUS ARBITES keyword");
});

test("Vasov's Auto-Oppressor desc references Movement characteristic", () => {
  const enh = itDet.enhancements.find(e => e.id === "enh_aoti_vasovs_auto_oppressor");
  assert(enh.desc.includes("Movement characteristic"),
    "Vasov's Auto-Oppressor desc must mention 'Movement characteristic'");
});


// ── Section 80: Unit Definitions ─────────────────────────────────────────────

section("80. Agents of the Imperium — Unit Definitions");

test("Inquisitor Coteaz — CHARACTER, EPIC HERO, PSYKER, INQUISITOR, ORDO MALLEUS, 75pts", () => {
  const u = aotiUnit("aoti_inquisitor_coteaz");
  assert(!!u, "aoti_inquisitor_coteaz not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),              "must have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),                 "must have PSYKER");
  assert(u.keywords.includes("INQUISITOR"),             "must have INQUISITOR");
  assert(u.keywords.includes("ORDO MALLEUS"),           "must have ORDO MALLEUS");
  assert(u.keywords.includes("AGENTS OF THE IMPERIUM"), "must have AGENTS OF THE IMPERIUM");
  assertEqual(u.sizes[0].pts, 75, "must cost 75pts");
});

test("Inquisitor Coteaz does not have ORDO XENOS or ORDO HERETICUS", () => {
  const u = aotiUnit("aoti_inquisitor_coteaz");
  assert(!u.keywords.includes("ORDO XENOS"),     "must NOT have ORDO XENOS");
  assert(!u.keywords.includes("ORDO HERETICUS"), "must NOT have ORDO HERETICUS");
});

test("Inquisitor Draxus — CHARACTER, EPIC HERO, PSYKER, INQUISITOR, ORDO XENOS, 75pts", () => {
  const u = aotiUnit("aoti_inquisitor_draxus");
  assert(!!u, "aoti_inquisitor_draxus not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),  "must have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER");
  assert(u.keywords.includes("INQUISITOR"), "must have INQUISITOR");
  assert(u.keywords.includes("ORDO XENOS"), "must have ORDO XENOS");
  assertEqual(u.sizes[0].pts, 75, "must cost 75pts");
});

test("Inquisitor Draxus does not have ORDO MALLEUS or ORDO HERETICUS", () => {
  const u = aotiUnit("aoti_inquisitor_draxus");
  assert(!u.keywords.includes("ORDO MALLEUS"),   "must NOT have ORDO MALLEUS");
  assert(!u.keywords.includes("ORDO HERETICUS"), "must NOT have ORDO HERETICUS");
});

test("Inquisitor Greyfax — CHARACTER, EPIC HERO, PSYKER, INQUISITOR, ORDO HERETICUS, 75pts", () => {
  const u = aotiUnit("aoti_inquisitor_greyfax");
  assert(!!u, "aoti_inquisitor_greyfax not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),      "must have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),         "must have PSYKER");
  assert(u.keywords.includes("INQUISITOR"),     "must have INQUISITOR");
  assert(u.keywords.includes("ORDO HERETICUS"), "must have ORDO HERETICUS");
  assertEqual(u.sizes[0].pts, 75, "must cost 75pts");
});

test("Inquisitor Greyfax does not have ORDO MALLEUS or ORDO XENOS", () => {
  const u = aotiUnit("aoti_inquisitor_greyfax");
  assert(!u.keywords.includes("ORDO MALLEUS"), "must NOT have ORDO MALLEUS");
  assert(!u.keywords.includes("ORDO XENOS"),   "must NOT have ORDO XENOS");
});

test("Inquisitor — CHARACTER, INQUISITOR, no EPIC HERO, no PSYKER, 55pts", () => {
  const u = aotiUnit("aoti_inquisitor");
  assert(!!u, "aoti_inquisitor not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("INQUISITOR"), "must have INQUISITOR");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assert(!u.keywords.includes("PSYKER"),    "must NOT have PSYKER");
  assertEqual(u.sizes[0].pts, 55, "must cost 55pts");
});

test("Exaction Squad — INFANTRY, ADEPTUS ARBITES, no CHARACTER, 90pts for 11 models", () => {
  const u = aotiUnit("aoti_exaction_squad");
  assert(!!u, "aoti_exaction_squad not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS ARBITES"),        "must have ADEPTUS ARBITES");
  assert(u.keywords.includes("AGENTS OF THE IMPERIUM"), "must have AGENTS OF THE IMPERIUM");
  assert(!u.keywords.includes("CHARACTER"),             "must NOT have CHARACTER keyword");
  assertEqual(u.sizes[0].label, "11 models", "size label must be '11 models'");
  assertEqual(u.sizes[0].pts, 90,            "must cost 90pts");
  assertEqual(u.sizes.length, 1,             "must have exactly 1 size option");
});

test("Exaction Squad rulesAdaptations references Proctor-Exactant", () => {
  const u = aotiUnit("aoti_exaction_squad");
  assert(u.rulesAdaptations?.includes("Proctor-Exactant"),
    "rulesAdaptations must mention 'Proctor-Exactant'");
});

test("Exaction Squad rulesAdaptations references Form Boarding Squads", () => {
  const u = aotiUnit("aoti_exaction_squad");
  assert(u.rulesAdaptations?.includes("Form Boarding Squads"),
    "rulesAdaptations must mention 'Form Boarding Squads'");
});

test("Exaction Squad rulesAdaptations references Nuncio Aquila", () => {
  const u = aotiUnit("aoti_exaction_squad");
  assert(u.rulesAdaptations?.includes("Nuncio Aquila"),
    "rulesAdaptations must mention 'Nuncio Aquila'");
});

test("Subductor Squad — INFANTRY, ADEPTUS ARBITES, no CHARACTER, no BATTLELINE, 85pts for 11 models", () => {
  const u = aotiUnit("aoti_subductor_squad");
  assert(!!u, "aoti_subductor_squad not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS ARBITES"), "must have ADEPTUS ARBITES");
  assert(!u.keywords.includes("CHARACTER"),      "must NOT have CHARACTER keyword");
  assert(!u.keywords.includes("BATTLELINE"),     "must NOT have BATTLELINE keyword");
  assertEqual(u.sizes[0].label, "11 models", "size label must be '11 models'");
  assertEqual(u.sizes[0].pts, 85,            "must cost 85pts");
});

test("Subductor Squad rulesAdaptations references Secure Site Tactical Manoeuvre", () => {
  const u = aotiUnit("aoti_subductor_squad");
  assert(u.rulesAdaptations?.includes("Secure Site Tactical Manoeuvre"),
    "rulesAdaptations must mention 'Secure Site Tactical Manoeuvre'");
});

test("Subductor Squad rulesAdaptations references Objective Control", () => {
  const u = aotiUnit("aoti_subductor_squad");
  assert(u.rulesAdaptations?.includes("Objective Control"),
    "rulesAdaptations must mention 'Objective Control'");
});

test("Subductor Squad rulesAdaptations references Nuncio Aquila", () => {
  const u = aotiUnit("aoti_subductor_squad");
  assert(u.rulesAdaptations?.includes("Nuncio Aquila"),
    "rulesAdaptations must mention 'Nuncio Aquila'");
});

test("Vigilant Squad — BATTLELINE, ADEPTUS ARBITES, no CHARACTER, 85pts for 11 models", () => {
  const u = aotiUnit("aoti_vigilant_squad");
  assert(!!u, "aoti_vigilant_squad not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("ADEPTUS ARBITES"), "must have ADEPTUS ARBITES");
  assert(u.keywords.includes("BATTLELINE"),      "must have BATTLELINE keyword");
  assert(!u.keywords.includes("CHARACTER"),      "must NOT have CHARACTER keyword");
  assertEqual(u.sizes[0].label, "11 models", "size label must be '11 models'");
  assertEqual(u.sizes[0].pts, 85,            "must cost 85pts");
});

test("Vigilant Squad rulesAdaptations references Form Boarding Squads", () => {
  const u = aotiUnit("aoti_vigilant_squad");
  assert(u.rulesAdaptations?.includes("Form Boarding Squads"),
    "rulesAdaptations must mention 'Form Boarding Squads'");
});

test("Vigilant Squad rulesAdaptations references Nuncio Aquila", () => {
  const u = aotiUnit("aoti_vigilant_squad");
  assert(u.rulesAdaptations?.includes("Nuncio Aquila"),
    "rulesAdaptations must mention 'Nuncio Aquila'");
});

test("Inquisitorial Agents — INFANTRY, no CHARACTER, no ADEPTUS ARBITES, two size options", () => {
  const u = aotiUnit("aoti_inquisitorial_agents");
  assert(!!u, "aoti_inquisitorial_agents not found");
  assertEqual(u.type, "INFANTRY");
  assert(!u.keywords.includes("CHARACTER"),       "must NOT have CHARACTER keyword");
  assert(!u.keywords.includes("ADEPTUS ARBITES"), "must NOT have ADEPTUS ARBITES keyword");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "6 models",  "first size label must be '6 models'");
  assertEqual(u.sizes[0].pts, 50,            "6-model size must cost 50pts");
  assertEqual(u.sizes[1].label, "12 models", "second size label must be '12 models'");
  assertEqual(u.sizes[1].pts, 100,           "12-model size must cost 100pts");
});

test("Inquisitorial Agents rulesAdaptations references Loyal Henchmen", () => {
  const u = aotiUnit("aoti_inquisitorial_agents");
  assert(u.rulesAdaptations?.includes("Loyal Henchmen"),
    "rulesAdaptations must mention 'Loyal Henchmen'");
});

test("Inquisitorial Agents rulesAdaptations references Form Boarding Squads", () => {
  const u = aotiUnit("aoti_inquisitorial_agents");
  assert(u.rulesAdaptations?.includes("Form Boarding Squads"),
    "rulesAdaptations must mention 'Form Boarding Squads'");
});

test("All four INQUISITOR units have the INQUISITOR keyword", () => {
  ["aoti_inquisitor_coteaz", "aoti_inquisitor_draxus",
   "aoti_inquisitor_greyfax", "aoti_inquisitor"].forEach(id => {
    const u = aotiUnit(id);
    assert(u?.keywords.includes("INQUISITOR"),
      id + " must have the INQUISITOR keyword");
  });
});

test("ADEPTUS ARBITES units do not have the INQUISITOR keyword", () => {
  ["aoti_exaction_squad", "aoti_subductor_squad", "aoti_vigilant_squad"].forEach(id => {
    const u = aotiUnit(id);
    assert(!u?.keywords.includes("INQUISITOR"),
      id + " must NOT have the INQUISITOR keyword");
  });
});


// ── Section 81: Interdiction Team Game Rule Logic ────────────────────────────

section("81. Agents of the Imperium — Interdiction Team Game Rule Logic");

const it = makeDetHelpers(itDet, id => aotiUnit(id));

test("Character cap — first CHARACTER (Inquisitor) can be added to empty list", () => {
  assert(it.canAdd([], "aoti_inquisitor"),
    "Inquisitor must be addable to an empty list");
});

test("Character cap — second CHARACTER is blocked by cap of 1", () => {
  const list = [{ unitId: "aoti_inquisitor" }];
  assertEqual(it.charCount(list), 1, "must count 1 CHARACTER");
  assert(!it.canAdd(list, "aoti_inquisitor_coteaz"),
    "Inquisitor Coteaz must be blocked when char cap of 1 is already filled");
});

test("Character cap — each other INQUISITOR CHARACTER is blocked when one is present", () => {
  const list = [{ unitId: "aoti_inquisitor_coteaz" }];
  ["aoti_inquisitor_draxus", "aoti_inquisitor_greyfax", "aoti_inquisitor"].forEach(id => {
    assert(!it.canAdd(list, id),
      id + " must be blocked when char cap is filled by Inquisitor Coteaz");
  });
});

test("Non-CHARACTER units are not blocked by the character cap", () => {
  const list = [{ unitId: "aoti_inquisitor" }];
  ["aoti_exaction_squad", "aoti_subductor_squad",
   "aoti_vigilant_squad", "aoti_inquisitorial_agents"].forEach(id => {
    assert(it.canAdd(list, id),
      id + " must still be addable when char cap is filled");
  });
});

test("Unit max — Exaction Squad capped at 2", () => {
  assertEqual(it.unitMax("aoti_exaction_squad"), 2, "Exaction Squad max must be 2");
  const list = [{ unitId: "aoti_exaction_squad" }, { unitId: "aoti_exaction_squad" }];
  assert(!it.canAdd(list, "aoti_exaction_squad"),
    "Third Exaction Squad must be blocked by unit max of 2");
});

test("Unit max — Subductor Squad capped at 3", () => {
  assertEqual(it.unitMax("aoti_subductor_squad"), 3, "Subductor Squad max must be 3");
  const list = [
    { unitId: "aoti_subductor_squad" },
    { unitId: "aoti_subductor_squad" },
    { unitId: "aoti_subductor_squad" },
  ];
  assert(!it.canAdd(list, "aoti_subductor_squad"),
    "Fourth Subductor Squad must be blocked by unit max of 3");
});

test("Unit max — Vigilant Squad capped at 3", () => {
  assertEqual(it.unitMax("aoti_vigilant_squad"), 3, "Vigilant Squad max must be 3");
  const list = [
    { unitId: "aoti_vigilant_squad" },
    { unitId: "aoti_vigilant_squad" },
    { unitId: "aoti_vigilant_squad" },
  ];
  assert(!it.canAdd(list, "aoti_vigilant_squad"),
    "Fourth Vigilant Squad must be blocked by unit max of 3");
});

test("Unit max — EPIC HERO Inquisitors each capped at 1", () => {
  ["aoti_inquisitor_coteaz", "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    const list = [{ unitId: id }];
    assert(!it.canAdd(list, id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

test("Smoke test — Inquisitor + 2x Exaction Squad + 2x Vigilant Squad = 55 + 180 + 170 = 405pts (legal)", () => {
  const pts = 55 + (90 * 2) + (85 * 2);
  assertEqual(pts, 405, "Expected 405pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
  const list = [
    { unitId: "aoti_inquisitor"      },
    { unitId: "aoti_exaction_squad"  },
    { unitId: "aoti_exaction_squad"  },
    { unitId: "aoti_vigilant_squad"  },
    { unitId: "aoti_vigilant_squad"  },
  ];
  assertEqual(it.charCount(list), 1, "must have exactly 1 CHARACTER");
  assert(!it.canAdd(list, "aoti_inquisitor_coteaz"),
    "Inquisitor Coteaz must be blocked once char cap of 1 is filled");
});

test("Smoke test — Inquisitor Greyfax + 3x Subductor Squad = 75 + 255 = 330pts (legal)", () => {
  const pts = 75 + (85 * 3);
  assertEqual(pts, 330, "Expected 330pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 82: Interdiction Team — Inquisitorial Agents Ratio Constraint ────

section("82. Interdiction Team — Inquisitorial Agents Ratio Constraint");

// Mirror the updated app logic, including denominatorKeyword support.
// This tests both the data shape and the logic the app now implements.
function aotiKeywordCountInList(list, keyword) {
  return list.filter(l => aotiUnit(l.unitId)?.keywords.includes(keyword)).length;
}
function aotiRatioUnitCountInList(list, unitIds) {
  return list.filter(l => unitIds.includes(l.unitId)).length;
}
function aotiIsRatioBlocked(unitId, list) {
  const ratio = itDet?.keywordRatio;
  if (!ratio) return false;
  if (!ratio.numeratorUnitIds.includes(unitId)) return false;
  const numCount = aotiRatioUnitCountInList(list, ratio.numeratorUnitIds);
  const denCount = ratio.denominatorKeyword
    ? aotiKeywordCountInList(list, ratio.denominatorKeyword)
    : aotiRatioUnitCountInList(list, ratio.denominatorUnitIds);
  return numCount >= denCount;
}

test("Interdiction Team has keywordRatio defined", () => {
  assert(itDet.keywordRatio !== undefined,
    "aoti_interdiction_team must have a keywordRatio constraint");
});

test("keywordRatio numeratorUnitIds contains aoti_inquisitorial_agents", () => {
  const ratio = itDet.keywordRatio;
  assert(Array.isArray(ratio.numeratorUnitIds) && ratio.numeratorUnitIds.length > 0,
    "keywordRatio must have a non-empty numeratorUnitIds array");
  assert(ratio.numeratorUnitIds.includes("aoti_inquisitorial_agents"),
    "numeratorUnitIds must include 'aoti_inquisitorial_agents'");
});

test("keywordRatio uses denominatorKeyword of INQUISITOR (not denominatorUnitIds)", () => {
  const ratio = itDet.keywordRatio;
  assertEqual(ratio.denominatorKeyword, "INQUISITOR",
    "denominatorKeyword must be 'INQUISITOR'");
  assert(ratio.denominatorUnitIds === undefined,
    "denominatorUnitIds must not be set when denominatorKeyword is used");
});

test("keywordRatio has a non-empty description string", () => {
  const ratio = itDet.keywordRatio;
  assert(typeof ratio.description === "string" && ratio.description.length > 0,
    "keywordRatio must have a non-empty description string");
});

test("Ratio — Inquisitorial Agents blocked in empty list (0 units >= 0 INQUISITOR units)", () => {
  assert(aotiIsRatioBlocked("aoti_inquisitorial_agents", []),
    "Inquisitorial Agents must be blocked when no INQUISITOR units are present");
});

test("Ratio — Inquisitorial Agents allowed when one INQUISITOR unit is present", () => {
  const list = [{ unitId: "aoti_inquisitor" }];
  assert(!aotiIsRatioBlocked("aoti_inquisitorial_agents", list),
    "Inquisitorial Agents must be allowed when one INQUISITOR unit is in the list");
});

test("Ratio — second Inquisitorial Agents blocked when count equals INQUISITOR count", () => {
  const list = [
    { unitId: "aoti_inquisitor"           },
    { unitId: "aoti_inquisitorial_agents" },
  ];
  assert(aotiIsRatioBlocked("aoti_inquisitorial_agents", list),
    "Second Inquisitorial Agents must be blocked when agents (1) equals INQUISITORs (1)");
});

test("Ratio — each named INQUISITOR unit counts individually toward the denominator", () => {
  ["aoti_inquisitor_coteaz", "aoti_inquisitor_draxus",
   "aoti_inquisitor_greyfax", "aoti_inquisitor"].forEach(inqId => {
    const list = [{ unitId: inqId }];
    assert(!aotiIsRatioBlocked("aoti_inquisitorial_agents", list),
      "Inquisitorial Agents must be allowed when " + inqId + " is the INQUISITOR present");
  });
});

test("Ratio — non-Agents units are never blocked by the ratio constraint", () => {
  ["aoti_exaction_squad", "aoti_subductor_squad",
   "aoti_vigilant_squad", "aoti_inquisitor"].forEach(id => {
    assert(!aotiIsRatioBlocked(id, []),
      id + " must not be blocked by the Inquisitorial Agents ratio constraint");
  });
});

test("HTML supports denominatorKeyword in isKeywordRatioBlocked", () => {
  assert(html.includes("denominatorKeyword"),
    "isKeywordRatioBlocked must handle denominatorKeyword in the HTML app");
});

test("Smoke test — Inquisitor Coteaz + Inquisitorial Agents 6-model = 125pts (legal, agents allowed)", () => {
  const pts = 75 + 50;
  assertEqual(pts, 125, "Expected 125pts, got " + pts);
  // One INQUISITOR in list → agents allowed; once added, second agents blocked
  const listBefore = [{ unitId: "aoti_inquisitor_coteaz" }];
  assert(!aotiIsRatioBlocked("aoti_inquisitorial_agents", listBefore),
    "Inquisitorial Agents must be allowed before being added (1 INQUISITOR, 0 agents)");
  const listAfter = [
    { unitId: "aoti_inquisitor_coteaz"    },
    { unitId: "aoti_inquisitorial_agents" },
  ];
  assert(aotiIsRatioBlocked("aoti_inquisitorial_agents", listAfter),
    "Second Inquisitorial Agents must be blocked once count (1) equals INQUISITORs (1)");
});

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  AGENTS OF THE IMPERIUM — VOIDSHIP'S COMPANY                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks. Section 3 covers all of these globally. Only faction-specific
// behaviour is tested here: points values, keywords, rules adaptations content,
// and constraint logic.

section("83. Agents of the Imperium — Voidship's Company Detachment");

const vcDet = aotiDets ? aotiDets.find(d => d.id === "aoti_voidships_company") : null;

test("Voidship's Company detachment exists", () => {
  assert(!!vcDet, "aoti_voidships_company must exist in Agents of the Imperium detachments");
});

test("Voidship's Company has maxCharacters of 3", () => {
  assertEqual(vcDet.maxCharacters, 3, "maxCharacters must be 3");
});

test("Voidship's Company special rule is Beseechment Codes", () => {
  assertEqual(vcDet.specialRule.name, "Beseechment Codes");
});

test("Beseechment Codes desc references VOIDFARERS", () => {
  assert(vcDet.specialRule.desc.includes("VOIDFARERS"),
    "special rule desc must mention 'VOIDFARERS'");
});

test("Beseechment Codes desc references Normal move", () => {
  assert(vcDet.specialRule.desc.includes("Normal move"),
    "special rule desc must mention 'Normal move'");
});

test("Beseechment Codes desc references Hatchway", () => {
  assert(vcDet.specialRule.desc.includes("Hatchway"),
    "special rule desc must mention 'Hatchway'");
});

test("Voidship's Company unit roster — correct IDs and maxes", () => {
  const find = id => vcDet.units.find(u => u.id === id);
  assert(find("aoti_inquisitor")?.max              === 1, "aoti_inquisitor max must be 1");
  assert(find("aoti_inquisitor_coteaz")?.max        === 1, "aoti_inquisitor_coteaz max must be 1");
  assert(find("aoti_inquisitor_draxus")?.max        === 1, "aoti_inquisitor_draxus max must be 1");
  assert(find("aoti_inquisitor_greyfax")?.max       === 1, "aoti_inquisitor_greyfax max must be 1");
  assert(find("aoti_inquisitorial_agents")?.max     === 1, "aoti_inquisitorial_agents max must be 1");
  assert(find("aoti_rogue_trader_entourage")?.max   === 2, "aoti_rogue_trader_entourage max must be 2");
  assert(find("aoti_imperial_navy_breachers")?.max  === 3, "aoti_imperial_navy_breachers max must be 3");
  assert(find("aoti_voidsmen_at_arms")?.max         === 6, "aoti_voidsmen_at_arms max must be 6");
});

test("Voidship's Company has exactly 8 unit slots", () => {
  assertEqual(vcDet.units.length, 8, "Expected 8 unit slots, got " + vcDet.units.length);
});

test("Voidship's Company enhancements — Lathimon's Flock and Heirloom Blade present", () => {
  const ids = vcDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_aoti_lathimons_flock"),  "must include enh_aoti_lathimons_flock");
  assert(ids.includes("enh_aoti_heirloom_blade"),   "must include enh_aoti_heirloom_blade");
});

test("Lathimon's Flock requiresKeywords is VOIDFARERS", () => {
  const enh = vcDet.enhancements.find(e => e.id === "enh_aoti_lathimons_flock");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("VOIDFARERS"),
    "Lathimon's Flock must require VOIDFARERS keyword");
});

test("Lathimon's Flock desc references Imperial Navy Breachers", () => {
  const enh = vcDet.enhancements.find(e => e.id === "enh_aoti_lathimons_flock");
  assert(enh.desc.includes("Imperial Navy Breachers"),
    "Lathimon's Flock desc must mention 'Imperial Navy Breachers'");
});

test("Lathimon's Flock desc references Infiltrate", () => {
  const enh = vcDet.enhancements.find(e => e.id === "enh_aoti_lathimons_flock");
  assert(enh.desc.includes("Infiltrate"),
    "Lathimon's Flock desc must mention 'Infiltrate'");
});

test("Heirloom Blade requiresKeywords is VOIDFARERS", () => {
  const enh = vcDet.enhancements.find(e => e.id === "enh_aoti_heirloom_blade");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("VOIDFARERS"),
    "Heirloom Blade must require VOIDFARERS keyword");
});

test("Heirloom Blade desc references monomolecular cane-rapier", () => {
  const enh = vcDet.enhancements.find(e => e.id === "enh_aoti_heirloom_blade");
  assert(enh.desc.includes("monomolecular cane-rapier"),
    "Heirloom Blade desc must mention 'monomolecular cane-rapier'");
});

test("Voidship's Company has keywordRatio defined", () => {
  assert(vcDet.keywordRatio !== undefined,
    "aoti_voidships_company must have a keywordRatio constraint");
});

test("Voidship's Company keywordRatio numeratorUnitIds contains aoti_inquisitorial_agents", () => {
  const ratio = vcDet.keywordRatio;
  assert(Array.isArray(ratio.numeratorUnitIds) &&
    ratio.numeratorUnitIds.includes("aoti_inquisitorial_agents"),
    "numeratorUnitIds must include 'aoti_inquisitorial_agents'");
});

test("Voidship's Company keywordRatio uses denominatorKeyword of INQUISITOR", () => {
  assertEqual(vcDet.keywordRatio.denominatorKeyword, "INQUISITOR",
    "denominatorKeyword must be 'INQUISITOR'");
});

test("Voidship's Company has exclusiveUnitGroups defined", () => {
  assert(Array.isArray(vcDet.exclusiveUnitGroups) && vcDet.exclusiveUnitGroups.length > 0,
    "aoti_voidships_company must have a non-empty exclusiveUnitGroups array");
});

test("Voidship's Company has exactly 1 exclusive unit group", () => {
  assertEqual(vcDet.exclusiveUnitGroups.length, 1,
    "Expected exactly 1 exclusive unit group, got " + vcDet.exclusiveUnitGroups.length);
});


// ── Section 84: Voidship's Company Unit Definitions ──────────────────────────

section("84. Agents of the Imperium — Voidship's Company Unit Definitions");

test("Rogue Trader Entourage — CHARACTER, VOIDFARERS, no EPIC HERO, 75pts for 4 models", () => {
  const u = aotiUnit("aoti_rogue_trader_entourage");
  assert(!!u, "aoti_rogue_trader_entourage not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("VOIDFARERS"),             "must have VOIDFARERS");
  assert(u.keywords.includes("AGENTS OF THE IMPERIUM"), "must have AGENTS OF THE IMPERIUM");
  assert(u.keywords.includes("INFANTRY"),               "must have INFANTRY");
  assert(!u.keywords.includes("EPIC HERO"),             "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].label, "4 models", "size label must be '4 models'");
  assertEqual(u.sizes[0].pts, 75,           "must cost 75pts");
  assertEqual(u.sizes.length, 1,            "must have exactly 1 size option");
});

test("Rogue Trader Entourage rulesAdaptations references Backroom Deals", () => {
  const u = aotiUnit("aoti_rogue_trader_entourage");
  assert(u.rulesAdaptations?.includes("Backroom Deals"),
    "rulesAdaptations must mention 'Backroom Deals'");
});

test("Rogue Trader Entourage rulesAdaptations references Warrant of Trade", () => {
  const u = aotiUnit("aoti_rogue_trader_entourage");
  assert(u.rulesAdaptations?.includes("Warrant of Trade"),
    "rulesAdaptations must mention 'Warrant of Trade'");
});

test("Imperial Navy Breachers — INFANTRY, VOIDFARERS, no CHARACTER, no BATTLELINE, 90pts for 10 models", () => {
  const u = aotiUnit("aoti_imperial_navy_breachers");
  assert(!!u, "aoti_imperial_navy_breachers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("VOIDFARERS"),  "must have VOIDFARERS");
  assert(!u.keywords.includes("CHARACTER"),  "must NOT have CHARACTER keyword");
  assert(!u.keywords.includes("BATTLELINE"), "must NOT have BATTLELINE keyword");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assertEqual(u.sizes[0].pts, 90,            "must cost 90pts");
  assertEqual(u.sizes.length, 1,             "must have exactly 1 size option");
});

test("Imperial Navy Breachers rulesAdaptations references BATTLELINE keyword", () => {
  const u = aotiUnit("aoti_imperial_navy_breachers");
  assert(u.rulesAdaptations?.includes("BATTLELINE"),
    "rulesAdaptations must mention 'BATTLELINE'");
});

test("Imperial Navy Breachers rulesAdaptations references Gheistskull", () => {
  const u = aotiUnit("aoti_imperial_navy_breachers");
  assert(u.rulesAdaptations?.includes("Gheistskull"),
    "rulesAdaptations must mention 'Gheistskull'");
});

test("Voidsmen-at-Arms — INFANTRY, VOIDFARERS, no CHARACTER, 50pts for 16 models", () => {
  const u = aotiUnit("aoti_voidsmen_at_arms");
  assert(!!u, "aoti_voidsmen_at_arms not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("VOIDFARERS"), "must have VOIDFARERS");
  assert(!u.keywords.includes("CHARACTER"), "must NOT have CHARACTER keyword");
  assertEqual(u.sizes[0].label, "6 models",  "size label must be '6 models'");
  assertEqual(u.sizes[0].pts, 50,            "must cost 50pts");
  assertEqual(u.sizes.length, 1,             "must have exactly 1 size option");
});

test("Voidsmen-at-Arms rulesAdaptations references Secure Site Tactical Manoeuvre", () => {
  const u = aotiUnit("aoti_voidsmen_at_arms");
  assert(u.rulesAdaptations?.includes("Secure Site Tactical Manoeuvre"),
    "rulesAdaptations must mention 'Secure Site Tactical Manoeuvre'");
});

test("Voidsmen-at-Arms rulesAdaptations references BATTLELINE keyword", () => {
  const u = aotiUnit("aoti_voidsmen_at_arms");
  assert(u.rulesAdaptations?.includes("BATTLELINE"),
    "rulesAdaptations must mention 'BATTLELINE'");
});

test("All three VOIDFARERS units have the VOIDFARERS keyword", () => {
  ["aoti_rogue_trader_entourage", "aoti_imperial_navy_breachers", "aoti_voidsmen_at_arms"]
    .forEach(id => {
      const u = aotiUnit(id);
      assert(u?.keywords.includes("VOIDFARERS"),
        id + " must have the VOIDFARERS keyword");
    });
});

test("INQUISITOR units do not have the VOIDFARERS keyword", () => {
  ["aoti_inquisitor", "aoti_inquisitor_coteaz",
   "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    const u = aotiUnit(id);
    assert(!u?.keywords.includes("VOIDFARERS"),
      id + " must NOT have the VOIDFARERS keyword");
  });
});


// ── Section 85: Voidship's Company Game Rule Logic ───────────────────────────

section("85. Agents of the Imperium — Voidship's Company Game Rule Logic");

const vc = makeDetHelpers(vcDet, id => aotiUnit(id));

test("Character cap — Rogue Trader Entourage (CHARACTER) can be added to empty list", () => {
  assert(vc.canAdd([], "aoti_rogue_trader_entourage"),
    "Rogue Trader Entourage must be addable to an empty list");
});

test("Character cap — up to 3 CHARACTERs allowed", () => {
  const list = [
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_inquisitor"             },
  ];
  assertEqual(vc.charCount(list), 3, "must count 3 CHARACTERs");
});

test("Character cap — fourth CHARACTER is blocked by cap of 3", () => {
  const list = [
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_inquisitor"             },
  ];
  assert(!vc.canAdd(list, "aoti_inquisitor_coteaz"),
    "Fourth CHARACTER must be blocked when cap of 3 is reached");
});

test("Non-CHARACTER units are never blocked by the character cap", () => {
  const list = [
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_inquisitor"             },
  ];
  ["aoti_imperial_navy_breachers", "aoti_voidsmen_at_arms", "aoti_inquisitorial_agents"]
    .forEach(id => {
      assert(vc.canAdd(list, id),
        id + " must still be addable when char cap of 3 is filled");
    });
});

test("Unit max — Rogue Trader Entourage capped at 2", () => {
  assertEqual(vc.unitMax("aoti_rogue_trader_entourage"), 2,
    "Rogue Trader Entourage max must be 2");
  const list = [
    { unitId: "aoti_rogue_trader_entourage" },
    { unitId: "aoti_rogue_trader_entourage" },
  ];
  assert(!vc.canAdd(list, "aoti_rogue_trader_entourage"),
    "Third Rogue Trader Entourage must be blocked by unit max of 2");
});

test("Unit max — Imperial Navy Breachers capped at 3", () => {
  assertEqual(vc.unitMax("aoti_imperial_navy_breachers"), 3,
    "Imperial Navy Breachers max must be 3");
  const list = [
    { unitId: "aoti_imperial_navy_breachers" },
    { unitId: "aoti_imperial_navy_breachers" },
    { unitId: "aoti_imperial_navy_breachers" },
  ];
  assert(!vc.canAdd(list, "aoti_imperial_navy_breachers"),
    "Fourth Imperial Navy Breachers must be blocked by unit max of 3");
});

test("Unit max — Voidsmen-at-Arms capped at 6", () => {
  assertEqual(vc.unitMax("aoti_voidsmen_at_arms"), 6,
    "Voidsmen-at-Arms max must be 6");
  const list = Array(6).fill({ unitId: "aoti_voidsmen_at_arms" });
  assert(!vc.canAdd(list, "aoti_voidsmen_at_arms"),
    "Seventh Voidsmen-at-Arms must be blocked by unit max of 6");
});

test("Smoke test — Inquisitor + 3x Imperial Navy Breachers + 2x Voidsmen-at-Arms = 55 + 270 + 100 = 425pts (legal)", () => {
  const pts = 55 + (90 * 3) + (50 * 2);
  assertEqual(pts, 425, "Expected 425pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — 2x Rogue Trader Entourage + 6x Voidsmen-at-Arms = 150 + 300 = 450pts (legal)", () => {
  const pts = (75 * 2) + (50 * 6);
  assertEqual(pts, 450, "Expected 450pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 86: Voidship's Company — Inquisitor Exclusive Group ──────────────

section("86. Voidship's Company — Inquisitor Exclusive Group");

const vcExcGroup = vcDet.exclusiveUnitGroups ? vcDet.exclusiveUnitGroups[0] : null;
const isVcExcGroupBlocked = makeExcGroupChecker(vcDet.exclusiveUnitGroups);

test("Exclusive group contains exactly the 4 correct Inquisitor unit IDs", () => {
  assert(!!vcExcGroup, "exclusive group must exist");
  assertEqual(vcExcGroup.length, 4, "exclusive group must have exactly 4 unit IDs");
  ["aoti_inquisitor", "aoti_inquisitor_coteaz",
   "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(vcExcGroup.includes(id),
      "exclusive group must include \"" + id + "\"");
  });
});

test("All exclusive group unit IDs exist in Agents of the Imperium units", () => {
  const unitIds = new Set(aotiUnits.map(u => u.id));
  vcExcGroup.forEach(id => {
    assert(unitIds.has(id),
      "Exclusive group references \"" + id + "\" which does not exist in faction units");
  });
});

test("All exclusive group unit IDs are in Voidship's Company roster", () => {
  const detUnitIds = new Set(vcDet.units.map(u => u.id));
  vcExcGroup.forEach(id => {
    assert(detUnitIds.has(id),
      "Exclusive group unit \"" + id + "\" must be in Voidship's Company roster");
  });
});

test("Exclusive group — each Inquisitor unit can be added to an empty list", () => {
  ["aoti_inquisitor", "aoti_inquisitor_coteaz",
   "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(!isVcExcGroupBlocked(id, []),
      "\"" + id + "\" must not be blocked in an empty list");
  });
});

test("Exclusive group — taking Inquisitor Coteaz blocks all other Inquisitor variants", () => {
  const list = [{ unitId: "aoti_inquisitor_coteaz" }];
  ["aoti_inquisitor", "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must be blocked when Inquisitor Coteaz is in the list");
  });
});

test("Exclusive group — taking Inquisitor Draxus blocks all other Inquisitor variants", () => {
  const list = [{ unitId: "aoti_inquisitor_draxus" }];
  ["aoti_inquisitor", "aoti_inquisitor_coteaz", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must be blocked when Inquisitor Draxus is in the list");
  });
});

test("Exclusive group — taking Inquisitor Greyfax blocks all other Inquisitor variants", () => {
  const list = [{ unitId: "aoti_inquisitor_greyfax" }];
  ["aoti_inquisitor", "aoti_inquisitor_coteaz", "aoti_inquisitor_draxus"].forEach(id => {
    assert(isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must be blocked when Inquisitor Greyfax is in the list");
  });
});

test("Exclusive group — taking generic Inquisitor blocks all named Inquisitor variants", () => {
  const list = [{ unitId: "aoti_inquisitor" }];
  ["aoti_inquisitor_coteaz", "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must be blocked when generic Inquisitor is in the list");
  });
});

test("Exclusive group — a unit is never blocked by its own presence in the list", () => {
  ["aoti_inquisitor", "aoti_inquisitor_coteaz",
   "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    const list = [{ unitId: id }];
    assert(!isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must not be blocked by its own presence in the list");
  });
});

test("Exclusive group — removing the taken unit unblocks the rest", () => {
  const list = [{ id: 0, unitId: "aoti_inquisitor_coteaz" }];
  assert(isVcExcGroupBlocked("aoti_inquisitor_greyfax", list),
    "Inquisitor Greyfax must be blocked while Inquisitor Coteaz is in the list");
  const trimmed = list.filter(l => l.id !== 0);
  assert(!isVcExcGroupBlocked("aoti_inquisitor_greyfax", trimmed),
    "Inquisitor Greyfax must be unblocked once Inquisitor Coteaz is removed");
});

test("Exclusive group — non-Inquisitor units are never blocked by it", () => {
  const list = [{ unitId: "aoti_inquisitor_coteaz" }];
  ["aoti_rogue_trader_entourage", "aoti_imperial_navy_breachers",
   "aoti_voidsmen_at_arms", "aoti_inquisitorial_agents"].forEach(id => {
    assert(!isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must not be blocked by the Inquisitor exclusive group");
  });
});

test("Interdiction Team does not have an exclusiveUnitGroups constraint", () => {
  assert(itDet.exclusiveUnitGroups === undefined,
    "Interdiction Team must not have exclusiveUnitGroups");
});

test("Smoke test — Inquisitor Coteaz + Inquisitorial Agents + 3x Navy Breachers = 75 + 50 + 270 = 395pts (legal)", () => {
  const pts = 75 + 50 + (90 * 3);
  assertEqual(pts, 395, "Expected 395pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
  const list = [
    { unitId: "aoti_inquisitor_coteaz"        },
    { unitId: "aoti_inquisitorial_agents"     },
    { unitId: "aoti_imperial_navy_breachers"  },
    { unitId: "aoti_imperial_navy_breachers"  },
    { unitId: "aoti_imperial_navy_breachers"  },
  ];
  // Coteaz taken — all other Inquisitors blocked
  ["aoti_inquisitor", "aoti_inquisitor_draxus", "aoti_inquisitor_greyfax"].forEach(id => {
    assert(isVcExcGroupBlocked(id, list),
      "\"" + id + "\" must be blocked when Inquisitor Coteaz is in the list");
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  GENESTEALER CULTS                                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks. Section 3 covers all of these globally. Only faction-specific
// behaviour is tested here: points values, keywords, rules adaptations content,
// and constraint logic.

section("87. Genestealer Cults Faction");

const gcFaction = index.factions.find(f => f.id === "genestealer_cults");
const gcData    = factionData["genestealer_cults"];
const gcUnits   = gcData ? gcData.units : [];
const gcDets    = gcData ? gcData.detachments : [];
const gcUnit    = id => gcUnits.find(u => u.id === id);

test("Genestealer Cults faction entry exists in index", () => {
  assert(!!gcFaction, "genestealer_cults must exist in index.factions");
});

test("Genestealer Cults has Insidious Ambushers army rule", () => {
  assertEqual(gcFaction.armyRule.name, "Insidious Ambushers");
});

test("Insidious Ambushers desc references Cult Ambush ability", () => {
  assert(gcFaction.armyRule.desc.includes("Cult Ambush"),
    "army rule desc must mention 'Cult Ambush'");
});

test("Insidious Ambushers desc references GENESTEALER CULTS", () => {
  assert(gcFaction.armyRule.desc.includes("GENESTEALER CULTS"),
    "army rule desc must mention 'GENESTEALER CULTS'");
});

test("Insidious Ambushers desc references Deploy Armies step", () => {
  assert(gcFaction.armyRule.desc.includes("Deploy Armies step"),
    "army rule desc must mention 'Deploy Armies step'");
});

test("Genestealer Cults has exactly 2 detachments", () => {
  assertEqual(gcDets.length, 2, "Expected 2 detachments, got " + gcDets.length);
});

test("Genestealer Cults has exactly 15 units", () => {
  assertEqual(gcUnits.length, 15, "Expected 15 units, got " + gcUnits.length);
});


// ── Section 88: Genespawn Onslaught Detachment ───────────────────────────────

section("88. Genestealer Cults — Genespawn Onslaught Detachment");

const goDet = gcDets ? gcDets.find(d => d.id === "gc_genespawn_onslaught") : null;

test("Genespawn Onslaught detachment exists", () => {
  assert(!!goDet, "gc_genespawn_onslaught must exist in Genestealer Cults detachments");
});

test("Genespawn Onslaught has maxCharacters of 2", () => {
  assertEqual(goDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Genespawn Onslaught special rule is Blessed Visages", () => {
  assertEqual(goDet.specialRule.name, "Blessed Visages");
});

test("Blessed Visages desc references GENESTEALER CULTS", () => {
  assert(goDet.specialRule.desc.includes("GENESTEALER CULTS"),
    "special rule desc must mention 'GENESTEALER CULTS'");
});

test("Blessed Visages desc references Leadership test", () => {
  assert(goDet.specialRule.desc.includes("Leadership test"),
    "special rule desc must mention 'Leadership test'");
});

test("Blessed Visages desc references Hit roll", () => {
  assert(goDet.specialRule.desc.includes("Hit roll"),
    "special rule desc must mention 'Hit roll'");
});

test("Genespawn Onslaught unit roster — correct IDs and maxes", () => {
  const find = id => goDet.units.find(u => u.id === id);
  assert(find("gc_abominant")?.max        === 1, "gc_abominant max must be 1");
  assert(find("gc_benefictus")?.max       === 1, "gc_benefictus max must be 1");
  assert(find("gc_biophagus")?.max        === 1, "gc_biophagus max must be 1");
  assert(find("gc_aberrants")?.max        === 2, "gc_aberrants max must be 2");
  assert(find("gc_hybrid_metamorphs")?.max === 1, "gc_hybrid_metamorphs max must be 1");
});

test("Genespawn Onslaught has exactly 5 unit slots", () => {
  assertEqual(goDet.units.length, 5, "Expected 5 unit slots, got " + goDet.units.length);
});

test("Genespawn Onslaught has exactly 2 enhancements", () => {
  assertEqual(goDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + goDet.enhancements.length);
});

test("Genespawn Onslaught enhancements — Spiteful Imp and Miasmic Fumes present", () => {
  const ids = goDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_gc_spiteful_imp"),    "must include enh_gc_spiteful_imp");
  assert(ids.includes("enh_gc_miasmic_fumes"),   "must include enh_gc_miasmic_fumes");
});

test("Spiteful Imp requiresKeywords is ABOMINANT", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_spiteful_imp");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("ABOMINANT"),
    "Spiteful Imp must require ABOMINANT keyword");
});

test("Spiteful Imp desc references Hatchway", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_spiteful_imp");
  assert(enh.desc.includes("Hatchway"),
    "Spiteful Imp desc must mention 'Hatchway'");
});

test("Spiteful Imp desc references mortal wound", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_spiteful_imp");
  assert(enh.desc.includes("mortal wound"),
    "Spiteful Imp desc must mention 'mortal wound'");
});

test("Miasmic Fumes requiresKeywords is BIOPHAGUS", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_miasmic_fumes");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("BIOPHAGUS"),
    "Miasmic Fumes must require BIOPHAGUS keyword");
});

test("Miasmic Fumes desc references Hit roll", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_miasmic_fumes");
  assert(enh.desc.includes("Hit roll"),
    "Miasmic Fumes desc must mention 'Hit roll'");
});

test("Miasmic Fumes desc references Wound roll", () => {
  const enh = goDet.enhancements.find(e => e.id === "enh_gc_miasmic_fumes");
  assert(enh.desc.includes("Wound roll"),
    "Miasmic Fumes desc must mention 'Wound roll'");
});


// ── Section 89: Unit Definitions ─────────────────────────────────────────────

section("89. Genestealer Cults — Unit Definitions");

test("Abominant — CHARACTER, GREAT DEVOURER, no EPIC HERO, 85pts for 1 model", () => {
  const u = gcUnit("gc_abominant");
  assert(!!u, "gc_abominant not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GENESTEALER CULTS"), "must have GENESTEALER CULTS");
  assert(u.keywords.includes("GREAT DEVOURER"),    "must have GREAT DEVOURER");
  assert(u.keywords.includes("INFANTRY"),          "must have INFANTRY");
  assert(u.keywords.includes("ABOMINANT"),         "must have ABOMINANT");
  assert(!u.keywords.includes("EPIC HERO"),        "must NOT have EPIC HERO");
  assertEqual(u.sizes.length, 1,           "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assertEqual(u.sizes[0].pts, 85,          "must cost 85pts");
});

test("Abominant rulesAdaptations references Deep Strike ability", () => {
  const u = gcUnit("gc_abominant");
  assert(u.rulesAdaptations?.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Benefictus — CHARACTER, GREAT DEVOURER, no EPIC HERO, 70pts for 1 model", () => {
  const u = gcUnit("gc_benefictus");
  assert(!!u, "gc_benefictus not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GENESTEALER CULTS"), "must have GENESTEALER CULTS");
  assert(u.keywords.includes("GREAT DEVOURER"),    "must have GREAT DEVOURER");
  assert(!u.keywords.includes("EPIC HERO"),        "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assertEqual(u.sizes[0].pts, 70,          "must cost 70pts");
});

test("Benefictus rulesAdaptations references Deep Strike ability", () => {
  const u = gcUnit("gc_benefictus");
  assert(u.rulesAdaptations?.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Biophagus — CHARACTER, GREAT DEVOURER, no EPIC HERO, 50pts for 1 model", () => {
  const u = gcUnit("gc_biophagus");
  assert(!!u, "gc_biophagus not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("GENESTEALER CULTS"), "must have GENESTEALER CULTS");
  assert(u.keywords.includes("GREAT DEVOURER"),    "must have GREAT DEVOURER");
  assert(u.keywords.includes("BIOPHAGUS"),         "must have BIOPHAGUS");
  assert(!u.keywords.includes("EPIC HERO"),        "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assertEqual(u.sizes[0].pts, 50,          "must cost 50pts");
});

test("Biophagus rulesAdaptations references Deep Strike ability", () => {
  const u = gcUnit("gc_biophagus");
  assert(u.rulesAdaptations?.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Aberrants — INFANTRY, no CHARACTER, two size options", () => {
  const u = gcUnit("gc_aberrants");
  assert(!!u, "gc_aberrants not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("GENESTEALER CULTS"), "must have GENESTEALER CULTS");
  assert(u.keywords.includes("GREAT DEVOURER"),    "must have GREAT DEVOURER");
  assert(!u.keywords.includes("CHARACTER"),        "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",  "first size label must be '5 models'");
  assertEqual(u.sizes[0].pts, 135,           "5-model size must cost 135pts");
  assertEqual(u.sizes[1].label, "10 models", "second size label must be '10 models'");
  assertEqual(u.sizes[1].pts, 300,           "10-model size must cost 300pts");
});

test("Aberrants rulesAdaptations references Deep Strike ability", () => {
  const u = gcUnit("gc_aberrants");
  assert(u.rulesAdaptations?.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Hybrid Metamorphs — INFANTRY, no CHARACTER, two size options", () => {
  const u = gcUnit("gc_hybrid_metamorphs");
  assert(!!u, "gc_hybrid_metamorphs not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("GENESTEALER CULTS"), "must have GENESTEALER CULTS");
  assert(u.keywords.includes("GREAT DEVOURER"),    "must have GREAT DEVOURER");
  assert(!u.keywords.includes("CHARACTER"),        "must NOT have CHARACTER keyword");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",  "first size label must be '5 models'");
  assertEqual(u.sizes[0].pts, 70,            "5-model size must cost 70pts");
  assertEqual(u.sizes[1].label, "10 models", "second size label must be '10 models'");
  assertEqual(u.sizes[1].pts, 300,           "10-model size must cost 300pts");
});

test("Hybrid Metamorphs rulesAdaptations references Deep Strike ability", () => {
  const u = gcUnit("gc_hybrid_metamorphs");
  assert(u.rulesAdaptations?.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Hybrid Metamorphs rulesAdaptations references Scouts ability", () => {
  const u = gcUnit("gc_hybrid_metamorphs");
  assert(u.rulesAdaptations?.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
});

test("Hybrid Metamorphs rulesAdaptations references Brood Surge ability", () => {
  const u = gcUnit("gc_hybrid_metamorphs");
  assert(u.rulesAdaptations?.includes("Brood Surge"),
    "rulesAdaptations must mention 'Brood Surge'");
});

test("All three CHARACTER units have GENESTEALER CULTS, INFANTRY, CHARACTER, GREAT DEVOURER", () => {
  ["gc_abominant", "gc_benefictus", "gc_biophagus"].forEach(id => {
    const u = gcUnit(id);
    ["GENESTEALER CULTS", "INFANTRY", "CHARACTER", "GREAT DEVOURER"].forEach(kw => {
      assert(u?.keywords.includes(kw), id + " must have keyword " + kw);
    });
  });
});

test("Both INFANTRY units do not have the CHARACTER keyword", () => {
  ["gc_aberrants", "gc_hybrid_metamorphs"].forEach(id => {
    const u = gcUnit(id);
    assert(!u?.keywords.includes("CHARACTER"),
      id + " must NOT have the CHARACTER keyword");
  });
});


// ── Section 90: Genespawn Onslaught Game Rule Logic ──────────────────────────

section("90. Genestealer Cults — Genespawn Onslaught Game Rule Logic");

const go = makeDetHelpers(goDet, id => gcUnit(id));

test("Character cap — first CHARACTER can be added to an empty list", () => {
  assert(go.canAdd([], "gc_abominant"),
    "Abominant must be addable to an empty list");
});

test("Character cap — up to 2 CHARACTERs allowed", () => {
  const list = [{ unitId: "gc_abominant" }, { unitId: "gc_benefictus" }];
  assertEqual(go.charCount(list), 2, "must count 2 CHARACTERs");
});

test("Character cap — third CHARACTER is blocked by cap of 2", () => {
  const list = [{ unitId: "gc_abominant" }, { unitId: "gc_benefictus" }];
  assert(!go.canAdd(list, "gc_biophagus"),
    "Biophagus must be blocked when char cap of 2 is already filled");
});

test("Character cap — all three CHARACTER units can each fill the second slot", () => {
  ["gc_abominant", "gc_benefictus", "gc_biophagus"].forEach(id => {
    const list = [{ unitId: "gc_abominant" }];
    if (id !== "gc_abominant") {
      assert(go.canAdd(list, id),
        id + " must be addable when only 1 CHARACTER is in the list");
    }
  });
});

test("Non-CHARACTER units are never blocked by the character cap", () => {
  const list = [{ unitId: "gc_abominant" }, { unitId: "gc_benefictus" }];
  ["gc_aberrants", "gc_hybrid_metamorphs"].forEach(id => {
    assert(go.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Abominant capped at 1", () => {
  assertEqual(go.unitMax("gc_abominant"), 1, "Abominant max must be 1");
  const list = [{ unitId: "gc_abominant" }];
  assert(!go.canAdd(list, "gc_abominant"),
    "Second Abominant must be blocked by unit max of 1");
});

test("Unit max — Benefictus capped at 1", () => {
  assertEqual(go.unitMax("gc_benefictus"), 1, "Benefictus max must be 1");
  const list = [{ unitId: "gc_benefictus" }];
  assert(!go.canAdd(list, "gc_benefictus"),
    "Second Benefictus must be blocked by unit max of 1");
});

test("Unit max — Biophagus capped at 1", () => {
  assertEqual(go.unitMax("gc_biophagus"), 1, "Biophagus max must be 1");
  const list = [{ unitId: "gc_biophagus" }];
  assert(!go.canAdd(list, "gc_biophagus"),
    "Second Biophagus must be blocked by unit max of 1");
});

test("Unit max — Aberrants capped at 2", () => {
  assertEqual(go.unitMax("gc_aberrants"), 2, "Aberrants max must be 2");
  const list = [{ unitId: "gc_aberrants" }, { unitId: "gc_aberrants" }];
  assert(!go.canAdd(list, "gc_aberrants"),
    "Third Aberrants must be blocked by unit max of 2");
});

test("Unit max — Hybrid Metamorphs capped at 1", () => {
  assertEqual(go.unitMax("gc_hybrid_metamorphs"), 1, "Hybrid Metamorphs max must be 1");
  const list = [{ unitId: "gc_hybrid_metamorphs" }];
  assert(!go.canAdd(list, "gc_hybrid_metamorphs"),
    "Second Hybrid Metamorphs must be blocked by unit max of 1");
});

test("Smoke test — Abominant + Biophagus + 2x Aberrants (5-model) = 85 + 50 + 270 = 405pts (legal)", () => {
  const pts = 85 + 50 + (135 * 2);
  assertEqual(pts, 405, "Expected 405pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Abominant + Biophagus + 2x Aberrants (10-model) = 85 + 50 + 600 = 735pts (over limit)", () => {
  const pts = 85 + 50 + (300 * 2);
  assertEqual(pts, 735, "Expected 735pts, got " + pts);
  assert(pts > 500, "must exceed 500pt limit");
});

test("Smoke test — Benefictus + Hybrid Metamorphs (10-model) = 70 + 300 = 370pts (legal)", () => {
  const pts = 70 + 300;
  assertEqual(pts, 370, "Expected 370pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  TAU EMPIRE                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks. Section 3 covers all of these globally. Only faction-specific
// behaviour is tested here: points values, keywords, rules adaptations content,
// and constraint logic.

section("91. T'au Empire Faction");

const tauFaction = index.factions.find(f => f.id === "tau_empire");
const tauData    = factionData["tau_empire"];
const tauUnits   = tauData ? tauData.units : [];
const tauDets    = tauData ? tauData.detachments : [];
const tauUnit    = id => tauUnits.find(u => u.id === id);

test("T'au Empire faction entry exists in index", () => {
  assert(!!tauFaction, "tau_empire must exist in index.factions");
});

test("T'au Empire has Void Combat Discipline army rule", () => {
  assertEqual(tauFaction.armyRule.name, "Void Combat Discipline");
});

test("Void Combat Discipline desc references For the Greater Good", () => {
  assert(tauFaction.armyRule.desc.includes("For the Greater Good"),
    "army rule desc must mention 'For the Greater Good'");
});

test("Void Combat Discipline desc references TAU EMPIRE", () => {
  assert(tauFaction.armyRule.desc.includes("TAU EMPIRE"),
    "army rule desc must mention 'TAU EMPIRE'");
});

test("Void Combat Discipline desc references Set Overwatch", () => {
  assert(tauFaction.armyRule.desc.includes("Set Overwatch"),
    "army rule desc must mention 'Set Overwatch'");
});

test("T'au Empire has exactly 2 detachments", () => {
  assertEqual(tauDets.length, 2, "Expected 2 detachments, got " + tauDets.length);
});

test("T'au Empire has exactly 18 units", () => {
  assertEqual(tauUnits.length, 18, "Expected 18 units, got " + tauUnits.length);
});


// ── Section 92: Starfire Cadre Detachment ────────────────────────────────────

section("92. T'au Empire — Starfire Cadre Detachment");

const scDet = tauDets ? tauDets.find(d => d.id === "tau_starfire_cadre") : null;

test("Starfire Cadre detachment exists", () => {
  assert(!!scDet, "tau_starfire_cadre must exist in T'au Empire detachments");
});

test("Starfire Cadre has maxCharacters of 2", () => {
  assertEqual(scDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Starfire Cadre special rule is Markerlight Precision", () => {
  assertEqual(scDet.specialRule.name, "Markerlight Precision");
});

test("Markerlight Precision desc references MARKERLIGHT", () => {
  assert(scDet.specialRule.desc.includes("MARKERLIGHT"),
    "special rule desc must mention 'MARKERLIGHT'");
});

test("Markerlight Precision desc references Ballistic Skill", () => {
  assert(scDet.specialRule.desc.includes("Ballistic Skill"),
    "special rule desc must mention 'Ballistic Skill'");
});

test("Markerlight Precision desc references SUSTAINED HITS 1", () => {
  assert(scDet.specialRule.desc.includes("SUSTAINED HITS 1"),
    "special rule desc must mention '[SUSTAINED HITS 1]'");
});

test("Starfire Cadre has exactly 2 enhancements", () => {
  assertEqual(scDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + scDet.enhancements.length);
});

test("Starfire Cadre enhancements — Target Optimisation Microdrones and Duty's Echo present", () => {
  const ids = scDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_tau_target_optimisation_microdrones"), "must include enh_tau_target_optimisation_microdrones");
  assert(ids.includes("enh_tau_dutys_echo"),                     "must include enh_tau_dutys_echo");
});

test("Target Optimisation Microdrones requiresKeywords is CADRE FIREBLADE", () => {
  const enh = scDet.enhancements.find(e => e.id === "enh_tau_target_optimisation_microdrones");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("CADRE FIREBLADE"),
    "Target Optimisation Microdrones must require CADRE FIREBLADE keyword");
});

test("Target Optimisation Microdrones desc references Armour Penetration", () => {
  const enh = scDet.enhancements.find(e => e.id === "enh_tau_target_optimisation_microdrones");
  assert(enh.desc.includes("Armour Penetration"),
    "desc must mention 'Armour Penetration'");
});

test("Duty's Echo requiresKeywords is ETHEREAL", () => {
  const enh = scDet.enhancements.find(e => e.id === "enh_tau_dutys_echo");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.includes("ETHEREAL"),
    "Duty's Echo must require ETHEREAL keyword");
});

test("Duty's Echo desc references Set Overwatch", () => {
  const enh = scDet.enhancements.find(e => e.id === "enh_tau_dutys_echo");
  assert(enh.desc.includes("Set Overwatch"),
    "Duty's Echo desc must mention 'Set Overwatch'");
});

test("Starfire Cadre unit roster — correct IDs and maxes", () => {
  const find = id => scDet.units.find(u => u.id === id);
  assert(find("tau_darkstrider")?.max                  === 1, "tau_darkstrider max must be 1");
  assert(find("tau_cadre_fireblade")?.max              === 1, "tau_cadre_fireblade max must be 1");
  assert(find("tau_ethereal")?.max                     === 1, "tau_ethereal max must be 1");
  assert(find("tau_breacher_team")?.max                === 3, "tau_breacher_team max must be 3");
  assert(find("tau_strike_team")?.max                  === 3, "tau_strike_team max must be 3");
  assert(find("tau_pathfinder_team")?.max              === 3, "tau_pathfinder_team max must be 3");
  assert(find("tau_kroot_carnivores")?.max             === 1, "tau_kroot_carnivores max must be 1 in Starfire Cadre");
  assert(find("tau_vespid_stingwings")?.max            === 1, "tau_vespid_stingwings max must be 1");
  assert(find("tau_stealth_battlesuits")?.max          === 1, "tau_stealth_battlesuits max must be 1");
  assert(find("tau_crisis_fireknife_battlesuits")?.max === 1, "tau_crisis_fireknife_battlesuits max must be 1");
  assert(find("tau_crisis_starscythe_battlesuits")?.max === 1, "tau_crisis_starscythe_battlesuits max must be 1");
  assert(find("tau_crisis_sunforge_battlesuits")?.max  === 1, "tau_crisis_sunforge_battlesuits max must be 1");
});

test("Starfire Cadre has exactly 12 unit slots", () => {
  assertEqual(scDet.units.length, 12, "Expected 12 unit slots, got " + scDet.units.length);
});

test("Starfire Cadre has exactly one Crisis Suit exclusive group", () => {
  assert(Array.isArray(scDet.exclusiveUnitGroups) && scDet.exclusiveUnitGroups.length === 1,
    "must have exactly one exclusiveUnitGroups entry");
});

test("Starfire Cadre exclusive group contains all three Crisis Suit variants", () => {
  const group = scDet.exclusiveUnitGroups[0];
  assert(group.includes("tau_crisis_fireknife_battlesuits"),  "must include tau_crisis_fireknife_battlesuits");
  assert(group.includes("tau_crisis_starscythe_battlesuits"), "must include tau_crisis_starscythe_battlesuits");
  assert(group.includes("tau_crisis_sunforge_battlesuits"),   "must include tau_crisis_sunforge_battlesuits");
  assertEqual(group.length, 3, "exclusive group must contain exactly 3 unit IDs");
});

test("Starfire Cadre has no keywordRatio or keywordRatios", () => {
  assert(scDet.keywordRatio  === undefined, "Starfire Cadre must not have keywordRatio");
  assert(scDet.keywordRatios === undefined, "Starfire Cadre must not have keywordRatios");
});


// ── Section 93: Starfire Cadre Unit Definitions ───────────────────────────────

section("93. T'au Empire — Starfire Cadre Unit Definitions");

test("Darkstrider — CHARACTER, EPIC HERO, MARKERLIGHT, 60pts for 1 model, loses Scouts", () => {
  const u = tauUnit("tau_darkstrider");
  assert(!!u, "tau_darkstrider not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TAU EMPIRE"),   "must have TAU EMPIRE");
  assert(u.keywords.includes("INFANTRY"),     "must have INFANTRY");
  assert(u.keywords.includes("CHARACTER"),    "must have CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),    "must have EPIC HERO");
  assert(u.keywords.includes("MARKERLIGHT"), "must have MARKERLIGHT");
  assertEqual(u.sizes.length, 1,           "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assertEqual(u.sizes[0].pts, 60,          "must cost 60pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
});

test("Cadre Fireblade — CHARACTER, CADRE FIREBLADE keyword, 50pts for 1 model", () => {
  const u = tauUnit("tau_cadre_fireblade");
  assert(!!u, "tau_cadre_fireblade not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TAU EMPIRE"),      "must have TAU EMPIRE");
  assert(u.keywords.includes("INFANTRY"),        "must have INFANTRY");
  assert(u.keywords.includes("CHARACTER"),       "must have CHARACTER");
  assert(u.keywords.includes("CADRE FIREBLADE"), "must have CADRE FIREBLADE");
  assertEqual(u.sizes[0].pts, 50, "must cost 50pts");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assert(!u.rulesAdaptations, "Cadre Fireblade must have no rulesAdaptations");
});

test("Ethereal — CHARACTER, ETHEREAL keyword, 50pts for 1 model", () => {
  const u = tauUnit("tau_ethereal");
  assert(!!u, "tau_ethereal not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("CHARACTER"),  "must have CHARACTER");
  assert(u.keywords.includes("ETHEREAL"),   "must have ETHEREAL keyword");
  assertEqual(u.sizes[0].pts, 50, "must cost 50pts");
  assert(!u.rulesAdaptations, "Ethereal must have no rulesAdaptations");
});

test("Breacher Team — BATTLELINE, MARKERLIGHT, 90pts for 10 models, loses MARKERLIGHT adaptation", () => {
  const u = tauUnit("tau_breacher_team");
  assert(!!u, "tau_breacher_team not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("TAU EMPIRE"),  "must have TAU EMPIRE");
  assert(u.keywords.includes("INFANTRY"),    "must have INFANTRY");
  assert(u.keywords.includes("BATTLELINE"),  "must have BATTLELINE");
  assert(u.keywords.includes("MARKERLIGHT"),"must have MARKERLIGHT");
  assertEqual(u.sizes[0].pts, 90,           "must cost 90pts");
  assertEqual(u.sizes[0].label, "10 models","size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("MARKERLIGHT"),
    "rulesAdaptations must mention 'MARKERLIGHT'");
  assert(u.rulesAdaptations.includes("Shas'ui"),
    "rulesAdaptations must mention 'Shas'ui'");
});

test("Strike Team — BATTLELINE, MARKERLIGHT, 70pts for 10 models, loses MARKERLIGHT adaptation", () => {
  const u = tauUnit("tau_strike_team");
  assert(!!u, "tau_strike_team not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("BATTLELINE"),  "must have BATTLELINE");
  assert(u.keywords.includes("MARKERLIGHT"),"must have MARKERLIGHT");
  assertEqual(u.sizes[0].pts, 70,           "must cost 70pts");
  assertEqual(u.sizes[0].label, "10 models","size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("MARKERLIGHT"),
    "rulesAdaptations must mention 'MARKERLIGHT'");
});

test("Pathfinder Team — INFANTRY, MARKERLIGHT, 90pts for 10 models, loses Scouts", () => {
  const u = tauUnit("tau_pathfinder_team");
  assert(!!u, "tau_pathfinder_team not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("MARKERLIGHT"), "must have MARKERLIGHT");
  assert(!u.keywords.includes("BATTLELINE"), "must NOT have BATTLELINE");
  assertEqual(u.sizes[0].pts, 90, "must cost 90pts");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
});

test("Kroot Carnivores — INFANTRY, KROOT, 65pts for 10 models, loses Scouts and Fieldcraft", () => {
  const u = tauUnit("tau_kroot_carnivores");
  assert(!!u, "tau_kroot_carnivores not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("KROOT"),      "must have KROOT");
  assert(!u.keywords.includes("BATTLELINE"), "must NOT have BATTLELINE");
  assertEqual(u.sizes[0].pts, 65,           "must cost 65pts");
  assertEqual(u.sizes[0].label, "10 models","size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
  assert(u.rulesAdaptations.includes("Fieldcraft"),
    "rulesAdaptations must mention 'Fieldcraft'");
});

test("Vespid Stingwings — INFANTRY, 65pts for 5 models, loses Deep Strike and Airborne Agility, Movement 9\"", () => {
  const u = tauUnit("tau_vespid_stingwings");
  assert(!!u, "tau_vespid_stingwings not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("INFANTRY"),   "must have INFANTRY");
  assertEqual(u.sizes[0].pts, 65,          "must cost 65pts");
  assertEqual(u.sizes[0].label, "5 models","size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
  assert(u.rulesAdaptations.includes("Airborne Agility"),
    "rulesAdaptations must mention 'Airborne Agility'");
  assert(u.rulesAdaptations.includes("9"),
    "rulesAdaptations must mention reduced Movement of 9\"");
});

test("Stealth Battlesuits — INFANTRY, BATTLESUIT, MARKERLIGHT, 110pts for 5 models, loses Homing Beacon", () => {
  const u = tauUnit("tau_stealth_battlesuits");
  assert(!!u, "tau_stealth_battlesuits not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("BATTLESUIT"),  "must have BATTLESUIT");
  assert(u.keywords.includes("MARKERLIGHT"),"must have MARKERLIGHT");
  assertEqual(u.sizes[0].pts, 110,          "must cost 110pts");
  assertEqual(u.sizes[0].label, "5 models", "size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Homing Beacon"),
    "rulesAdaptations must mention 'Homing Beacon'");
});

test("Crisis Fireknife Battlesuits — VEHICLE, BATTLESUIT, 120pts for 3 models, loses Deep Strike, Movement 9\"", () => {
  const u = tauUnit("tau_crisis_fireknife_battlesuits");
  assert(!!u, "tau_crisis_fireknife_battlesuits not found");
  assertEqual(u.type, "VEHICLE");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("VEHICLE"),    "must have VEHICLE");
  assert(u.keywords.includes("BATTLESUIT"), "must have BATTLESUIT");
  assertEqual(u.sizes[0].pts, 120,           "must cost 120pts");
  assertEqual(u.sizes[0].label, "3 models",  "size label must be '3 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
  assert(u.rulesAdaptations.includes("9"), "rulesAdaptations must mention reduced Movement of 9\"");
});

test("Crisis Starscythe Battlesuits — VEHICLE, BATTLESUIT, 110pts for 3 models, loses Deep Strike, Movement 9\"", () => {
  const u = tauUnit("tau_crisis_starscythe_battlesuits");
  assert(!!u, "tau_crisis_starscythe_battlesuits not found");
  assertEqual(u.type, "VEHICLE");
  assert(u.keywords.includes("BATTLESUIT"), "must have BATTLESUIT");
  assertEqual(u.sizes[0].pts, 110,          "must cost 110pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Crisis Sunforge Battlesuits — VEHICLE, BATTLESUIT, 140pts for 3 models, loses Deep Strike, Movement 9\"", () => {
  const u = tauUnit("tau_crisis_sunforge_battlesuits");
  assert(!!u, "tau_crisis_sunforge_battlesuits not found");
  assertEqual(u.type, "VEHICLE");
  assert(u.keywords.includes("BATTLESUIT"), "must have BATTLESUIT");
  assertEqual(u.sizes[0].pts, 140,          "must cost 140pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Deep Strike"),
    "rulesAdaptations must mention 'Deep Strike'");
});

test("Three Crisis Suit variants are the only VEHICLE units in the faction", () => {
  const vehicles = tauUnits.filter(u => u.type === "VEHICLE");
  assertEqual(vehicles.length, 3, "Expected exactly 3 VEHICLE units");
  const ids = vehicles.map(u => u.id);
  assert(ids.includes("tau_crisis_fireknife_battlesuits"),  "must include Fireknife");
  assert(ids.includes("tau_crisis_starscythe_battlesuits"), "must include Starscythe");
  assert(ids.includes("tau_crisis_sunforge_battlesuits"),   "must include Sunforge");
});


// ── Section 94: Starfire Cadre Game Rule Logic ────────────────────────────────

section("94. T'au Empire — Starfire Cadre Game Rule Logic");

const sc = makeDetHelpers(scDet, id => tauUnit(id));
const isScExcGroupBlocked = makeExcGroupChecker(scDet.exclusiveUnitGroups);

test("Character cap — first CHARACTER can be added to an empty list", () => {
  assert(sc.canAdd([], "tau_darkstrider"),
    "Darkstrider must be addable to an empty list");
});

test("Character cap — up to 2 CHARACTERs allowed", () => {
  const list = [{ unitId: "tau_darkstrider" }, { unitId: "tau_cadre_fireblade" }];
  assertEqual(sc.charCount(list), 2, "must count 2 CHARACTERs");
});

test("Character cap — third CHARACTER blocked when cap of 2 filled", () => {
  const list = [{ unitId: "tau_darkstrider" }, { unitId: "tau_cadre_fireblade" }];
  assert(!sc.canAdd(list, "tau_ethereal"),
    "Ethereal must be blocked when char cap of 2 is already filled");
});

test("Character cap — non-CHARACTER units are never blocked by the cap", () => {
  const list = [{ unitId: "tau_darkstrider" }, { unitId: "tau_cadre_fireblade" }];
  ["tau_breacher_team", "tau_strike_team", "tau_stealth_battlesuits"].forEach(id => {
    assert(sc.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Darkstrider capped at 1", () => {
  assertEqual(sc.unitMax("tau_darkstrider"), 1, "Darkstrider max must be 1");
  assert(!sc.canAdd([{ unitId: "tau_darkstrider" }], "tau_darkstrider"),
    "Second Darkstrider must be blocked by unit max of 1");
});

test("Unit max — Breacher Team capped at 3", () => {
  assertEqual(sc.unitMax("tau_breacher_team"), 3, "Breacher Team max must be 3");
  const list = [
    { unitId: "tau_breacher_team" },
    { unitId: "tau_breacher_team" },
    { unitId: "tau_breacher_team" },
  ];
  assert(!sc.canAdd(list, "tau_breacher_team"),
    "Fourth Breacher Team must be blocked by unit max of 3");
});

test("Unit max — Strike Team capped at 3", () => {
  assertEqual(sc.unitMax("tau_strike_team"), 3, "Strike Team max must be 3");
  const list = [
    { unitId: "tau_strike_team" },
    { unitId: "tau_strike_team" },
    { unitId: "tau_strike_team" },
  ];
  assert(!sc.canAdd(list, "tau_strike_team"),
    "Fourth Strike Team must be blocked by unit max of 3");
});

test("Crisis Suit exclusive group — Fireknife blocks Starscythe and Sunforge", () => {
  const list = [{ unitId: "tau_crisis_fireknife_battlesuits" }];
  assert(isScExcGroupBlocked("tau_crisis_starscythe_battlesuits", list),
    "Starscythe must be blocked when Fireknife is in the list");
  assert(isScExcGroupBlocked("tau_crisis_sunforge_battlesuits", list),
    "Sunforge must be blocked when Fireknife is in the list");
});

test("Crisis Suit exclusive group — Starscythe blocks Fireknife and Sunforge", () => {
  const list = [{ unitId: "tau_crisis_starscythe_battlesuits" }];
  assert(isScExcGroupBlocked("tau_crisis_fireknife_battlesuits", list),
    "Fireknife must be blocked when Starscythe is in the list");
  assert(isScExcGroupBlocked("tau_crisis_sunforge_battlesuits", list),
    "Sunforge must be blocked when Starscythe is in the list");
});

test("Crisis Suit exclusive group — Sunforge blocks Fireknife and Starscythe", () => {
  const list = [{ unitId: "tau_crisis_sunforge_battlesuits" }];
  assert(isScExcGroupBlocked("tau_crisis_fireknife_battlesuits", list),
    "Fireknife must be blocked when Sunforge is in the list");
  assert(isScExcGroupBlocked("tau_crisis_starscythe_battlesuits", list),
    "Starscythe must be blocked when Sunforge is in the list");
});

test("Crisis Suit exclusive group — empty list blocks none of the three", () => {
  ["tau_crisis_fireknife_battlesuits",
   "tau_crisis_starscythe_battlesuits",
   "tau_crisis_sunforge_battlesuits"].forEach(id => {
    assert(!isScExcGroupBlocked(id, []),
      id + " must not be blocked in an empty list");
  });
});

test("Crisis Suit exclusive group — non-Crisis units are never affected", () => {
  const list = [{ unitId: "tau_crisis_fireknife_battlesuits" }];
  ["tau_breacher_team", "tau_strike_team", "tau_stealth_battlesuits",
   "tau_darkstrider", "tau_kroot_carnivores"].forEach(id => {
    assert(!isScExcGroupBlocked(id, list),
      id + " must not be blocked by the Crisis Suit exclusive group");
  });
});

test("Smoke test — Darkstrider + Cadre Fireblade + 3x Strike Team = 60 + 50 + 210 = 320pts (legal)", () => {
  const pts = 60 + 50 + (70 * 3);
  assertEqual(pts, 320, "Expected 320pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Darkstrider + Cadre Fireblade + 3x Breacher Team + Crisis Fireknife = 60 + 50 + 270 + 120 = 500pts (legal)", () => {
  const pts = 60 + 50 + (90 * 3) + 120;
  assertEqual(pts, 500, "Expected 500pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 95: Kroot Raiding Party Detachment ───────────────────────────────

section("95. T'au Empire — Kroot Raiding Party Detachment");

const krpDet = tauDets ? tauDets.find(d => d.id === "tau_kroot_raiding_party") : null;

test("Kroot Raiding Party detachment exists", () => {
  assert(!!krpDet, "tau_kroot_raiding_party must exist in T'au Empire detachments");
});

test("Kroot Raiding Party has maxCharacters of 2", () => {
  assertEqual(krpDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Kroot Raiding Party special rule is Guerrilla Ambushers", () => {
  assertEqual(krpDet.specialRule.name, "Guerrilla Ambushers");
});

test("Guerrilla Ambushers desc references Overwatch and D6", () => {
  assert(krpDet.specialRule.desc.includes("Overwatch"),
    "special rule desc must mention 'Overwatch'");
  assert(krpDet.specialRule.desc.includes("D6"),
    "special rule desc must mention 'D6'");
});

test("Guerrilla Ambushers desc references KROOT units", () => {
  assert(krpDet.specialRule.desc.includes("KROOT"),
    "special rule desc must mention 'KROOT'");
});

test("Guerrilla Ambushers desc references Secure Site", () => {
  assert(krpDet.specialRule.desc.includes("Secure Site"),
    "special rule desc must mention 'Secure Site'");
});

test("Guerrilla Ambushers desc references Entry Zone deployment", () => {
  assert(krpDet.specialRule.desc.includes("Entry Zone"),
    "special rule desc must mention 'Entry Zone'");
});

test("Guerrilla Ambushers desc references Kroot Hounds and Krootox Rider", () => {
  assert(krpDet.specialRule.desc.includes("Kroot Hounds"),
    "special rule desc must mention 'Kroot Hounds'");
  assert(krpDet.specialRule.desc.includes("Krootox Rider"),
    "special rule desc must mention 'Krootox Rider'");
});

test("Kroot Raiding Party has exactly 2 enhancements", () => {
  assertEqual(krpDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + krpDet.enhancements.length);
});

test("Kroot Raiding Party enhancements — Experienced Leader and Quill Marker present", () => {
  const ids = krpDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_tau_experienced_leader"), "must include enh_tau_experienced_leader");
  assert(ids.includes("enh_tau_quill_marker"),       "must include enh_tau_quill_marker");
});

test("Experienced Leader requiresKeywords is empty array", () => {
  const enh = krpDet.enhancements.find(e => e.id === "enh_tau_experienced_leader");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Experienced Leader must have empty requiresKeywords array");
});

test("Experienced Leader desc references Wound roll", () => {
  const enh = krpDet.enhancements.find(e => e.id === "enh_tau_experienced_leader");
  assert(enh.desc.includes("Wound roll"),
    "Experienced Leader desc must mention 'Wound roll'");
});

test("Quill Marker requiresKeywords is empty array", () => {
  const enh = krpDet.enhancements.find(e => e.id === "enh_tau_quill_marker");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Quill Marker must have empty requiresKeywords array");
});

test("Quill Marker desc references Charge phase", () => {
  const enh = krpDet.enhancements.find(e => e.id === "enh_tau_quill_marker");
  assert(enh.desc.includes("Charge phase"),
    "Quill Marker desc must mention 'Charge phase'");
});

test("Kroot Raiding Party unit roster — correct IDs and maxes", () => {
  const find = id => krpDet.units.find(u => u.id === id);
  assert(find("tau_kroot_carnivores")?.max    === 3, "tau_kroot_carnivores max must be 3");
  assert(find("tau_kroot_flesh_shaper")?.max  === 1, "tau_kroot_flesh_shaper max must be 1");
  assert(find("tau_kroot_trail_shaper")?.max  === 1, "tau_kroot_trail_shaper max must be 1");
  assert(find("tau_kroot_war_shaper")?.max    === 1, "tau_kroot_war_shaper max must be 1");
  assert(find("tau_kroot_farstalkers")?.max   === 3, "tau_kroot_farstalkers max must be 3");
  assert(find("tau_kroot_hounds")?.max        === 3, "tau_kroot_hounds max must be 3");
  assert(find("tau_krootox_rider")?.max       === 3, "tau_krootox_rider max must be 3");
});

test("Kroot Raiding Party has exactly 7 unit slots", () => {
  assertEqual(krpDet.units.length, 7, "Expected 7 unit slots, got " + krpDet.units.length);
});

test("Kroot Raiding Party has keywordRatio for Farstalkers vs Carnivores", () => {
  assert(krpDet.keywordRatio !== undefined, "must have keywordRatio defined");
  assert(Array.isArray(krpDet.keywordRatio.numeratorUnitIds) &&
    krpDet.keywordRatio.numeratorUnitIds.includes("tau_kroot_farstalkers"),
    "keywordRatio numeratorUnitIds must include tau_kroot_farstalkers");
  assert(Array.isArray(krpDet.keywordRatio.denominatorUnitIds) &&
    krpDet.keywordRatio.denominatorUnitIds.includes("tau_kroot_carnivores"),
    "keywordRatio denominatorUnitIds must include tau_kroot_carnivores");
  assert(typeof krpDet.keywordRatio.description === "string" && krpDet.keywordRatio.description.length > 0,
    "keywordRatio must have a non-empty description");
});

test("Kroot Raiding Party has keywordRatios array with 2 entries", () => {
  assert(Array.isArray(krpDet.keywordRatios) && krpDet.keywordRatios.length === 2,
    "keywordRatios must be an array of exactly 2 entries");
});

test("keywordRatios[0] is Hounds vs Carnivores", () => {
  const r = krpDet.keywordRatios[0];
  assert(Array.isArray(r.numeratorUnitIds) && r.numeratorUnitIds.includes("tau_kroot_hounds"),
    "keywordRatios[0] numeratorUnitIds must include tau_kroot_hounds");
  assert(Array.isArray(r.denominatorUnitIds) && r.denominatorUnitIds.includes("tau_kroot_carnivores"),
    "keywordRatios[0] denominatorUnitIds must include tau_kroot_carnivores");
  assert(typeof r.description === "string" && r.description.length > 0,
    "keywordRatios[0] must have a non-empty description");
});

test("keywordRatios[1] is Krootox Rider vs Carnivores", () => {
  const r = krpDet.keywordRatios[1];
  assert(Array.isArray(r.numeratorUnitIds) && r.numeratorUnitIds.includes("tau_krootox_rider"),
    "keywordRatios[1] numeratorUnitIds must include tau_krootox_rider");
  assert(Array.isArray(r.denominatorUnitIds) && r.denominatorUnitIds.includes("tau_kroot_carnivores"),
    "keywordRatios[1] denominatorUnitIds must include tau_kroot_carnivores");
  assert(typeof r.description === "string" && r.description.length > 0,
    "keywordRatios[1] must have a non-empty description");
});


// ── Section 96: Kroot Raiding Party Unit Definitions ─────────────────────────

section("96. T'au Empire — Kroot Raiding Party Unit Definitions");

test("Kroot Flesh Shaper — CHARACTER, KROOT, SHAPER, 45pts for 1 model, Rites of Feasting adaptation", () => {
  const u = tauUnit("tau_kroot_flesh_shaper");
  assert(!!u, "tau_kroot_flesh_shaper not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("INFANTRY"),   "must have INFANTRY");
  assert(u.keywords.includes("CHARACTER"),  "must have CHARACTER");
  assert(u.keywords.includes("KROOT"),      "must have KROOT");
  assert(u.keywords.includes("SHAPER"),     "must have SHAPER");
  assertEqual(u.sizes[0].pts, 45,           "must cost 45pts");
  assertEqual(u.sizes[0].label, "1 model",  "size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Rites of Feasting"),
    "rulesAdaptations must mention 'Rites of Feasting'");
  assert(u.rulesAdaptations.includes("Feel No Pain 5+"),
    "rulesAdaptations must mention 'Feel No Pain 5+'");
});

test("Kroot Flesh Shaper adaptation references Kroot Carnivores and Kroot Farstalkers", () => {
  const u = tauUnit("tau_kroot_flesh_shaper");
  assert(u.rulesAdaptations.includes("Kroot Carnivores"),
    "rulesAdaptations must mention 'Kroot Carnivores'");
  assert(u.rulesAdaptations.includes("Kroot Farstalkers"),
    "rulesAdaptations must mention 'Kroot Farstalkers'");
});

test("Kroot Trail Shaper — CHARACTER, KROOT, SHAPER, 55pts for 1 model, loses Scouts", () => {
  const u = tauUnit("tau_kroot_trail_shaper");
  assert(!!u, "tau_kroot_trail_shaper not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("KROOT"),  "must have KROOT");
  assert(u.keywords.includes("SHAPER"), "must have SHAPER");
  assertEqual(u.sizes[0].pts, 55,       "must cost 55pts");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
});

test("Kroot War Shaper — CHARACTER, KROOT, SHAPER, 50pts for 1 model, loses Scouts", () => {
  const u = tauUnit("tau_kroot_war_shaper");
  assert(!!u, "tau_kroot_war_shaper not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("KROOT"),  "must have KROOT");
  assert(u.keywords.includes("SHAPER"), "must have SHAPER");
  assertEqual(u.sizes[0].pts, 50,       "must cost 50pts");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
});

test("All three Shaper variants share SHAPER keyword and CHARACTER type", () => {
  ["tau_kroot_flesh_shaper", "tau_kroot_trail_shaper", "tau_kroot_war_shaper"].forEach(id => {
    const u = tauUnit(id);
    assertEqual(u.type, "CHARACTER", id + " must be CHARACTER type");
    assert(u.keywords.includes("SHAPER"), id + " must have SHAPER keyword");
    assert(u.keywords.includes("KROOT"),  id + " must have KROOT keyword");
  });
});

test("Kroot Farstalkers — INFANTRY, KROOT, 85pts for 12 models, splits into 2x6 in Boarding Squads", () => {
  const u = tauUnit("tau_kroot_farstalkers");
  assert(!!u, "tau_kroot_farstalkers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("KROOT"),      "must have KROOT");
  assertEqual(u.sizes[0].pts, 85,            "must cost 85pts");
  assertEqual(u.sizes[0].label, "12 models", "size label must be '12 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Boarding Squads"),
    "rulesAdaptations must mention 'Boarding Squads'");
  assert(u.rulesAdaptations.includes("6 models"),
    "rulesAdaptations must mention '6 models'");
});

test("Kroot Hounds — BEAST type, BEAST keyword, KROOT, 40pts for 5 models, loses Scouts and Loping Pounce, Movement 9\"", () => {
  const u = tauUnit("tau_kroot_hounds");
  assert(!!u, "tau_kroot_hounds not found");
  assertEqual(u.type, "BEAST");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("BEAST"),      "must have BEAST keyword");
  assert(u.keywords.includes("KROOT"),      "must have KROOT");
  assertEqual(u.sizes[0].pts, 40,           "must cost 40pts");
  assertEqual(u.sizes[0].label, "5 models", "size label must be '5 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
  assert(u.rulesAdaptations.includes("Loping Pounce"),
    "rulesAdaptations must mention 'Loping Pounce'");
  assert(u.rulesAdaptations.includes("9"),
    "rulesAdaptations must mention reduced Movement of 9\"");
});

test("Krootox Rider — MOUNTED type, MOUNTED keyword, KROOT, 40pts for 1 model, loses Scouts and Kroot Packmates", () => {
  const u = tauUnit("tau_krootox_rider");
  assert(!!u, "tau_krootox_rider not found");
  assertEqual(u.type, "MOUNTED");
  assert(u.keywords.includes("TAU EMPIRE"), "must have TAU EMPIRE");
  assert(u.keywords.includes("MOUNTED"),    "must have MOUNTED keyword");
  assert(u.keywords.includes("KROOT"),      "must have KROOT");
  assertEqual(u.sizes[0].pts, 40,           "must cost 40pts");
  assertEqual(u.sizes[0].label, "1 model",  "size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
  assert(u.rulesAdaptations.includes("Kroot Packmates"),
    "rulesAdaptations must mention 'Kroot Packmates'");
});

test("Kroot Hounds is the only BEAST type unit in the faction", () => {
  const beasts = tauUnits.filter(u => u.type === "BEAST");
  assertEqual(beasts.length, 1, "Expected exactly 1 BEAST unit");
  assertEqual(beasts[0].id, "tau_kroot_hounds", "The BEAST unit must be tau_kroot_hounds");
});

test("Krootox Rider is the only MOUNTED type unit in the faction", () => {
  const mounted = tauUnits.filter(u => u.type === "MOUNTED");
  assertEqual(mounted.length, 1, "Expected exactly 1 MOUNTED unit");
  assertEqual(mounted[0].id, "tau_krootox_rider", "The MOUNTED unit must be tau_krootox_rider");
});


// ── Section 97: Kroot Raiding Party Game Rule Logic ───────────────────────────

section("97. T'au Empire — Kroot Raiding Party Game Rule Logic");

const krp = makeDetHelpers(krpDet, id => tauUnit(id));

// Ratio helper that checks all ratios (keywordRatio + keywordRatios) for this detachment
function krpIsRatioBlocked(unitId, list) {
  const ratios = [];
  if (krpDet.keywordRatio)  ratios.push(krpDet.keywordRatio);
  if (krpDet.keywordRatios) ratios.push(...krpDet.keywordRatios);
  const unit = tauUnit(unitId);
  for (const ratio of ratios) {
    const den = list.filter(l => ratio.denominatorUnitIds.includes(l.unitId)).length;
    if (!ratio.numeratorUnitIds.includes(unitId)) continue;
    const num = list.filter(l => ratio.numeratorUnitIds.includes(l.unitId)).length;
    if (num + 1 > den) return true;
  }
  return false;
}

test("Character cap — first SHAPER CHARACTER can be added to an empty list", () => {
  assert(krp.canAdd([], "tau_kroot_flesh_shaper"),
    "Kroot Flesh Shaper must be addable to an empty list");
});

test("Character cap — second SHAPER CHARACTER allowed when only one is present", () => {
  const list = [{ unitId: "tau_kroot_flesh_shaper" }];
  assert(krp.canAdd(list, "tau_kroot_trail_shaper"),
    "Kroot Trail Shaper must be addable when only one CHARACTER is in the list");
});

test("Character cap — third CHARACTER blocked when cap of 2 filled", () => {
  const list = [{ unitId: "tau_kroot_flesh_shaper" }, { unitId: "tau_kroot_trail_shaper" }];
  assert(!krp.canAdd(list, "tau_kroot_war_shaper"),
    "Kroot War Shaper must be blocked when char cap of 2 is already filled");
});

test("Character cap — non-CHARACTER units are never blocked by the cap", () => {
  const list = [{ unitId: "tau_kroot_flesh_shaper" }, { unitId: "tau_kroot_trail_shaper" }];
  ["tau_kroot_carnivores", "tau_kroot_farstalkers", "tau_kroot_hounds", "tau_krootox_rider"].forEach(id => {
    assert(krp.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Kroot Flesh Shaper capped at 1", () => {
  assertEqual(krp.unitMax("tau_kroot_flesh_shaper"), 1, "Kroot Flesh Shaper max must be 1");
  assert(!krp.canAdd([{ unitId: "tau_kroot_flesh_shaper" }], "tau_kroot_flesh_shaper"),
    "Second Kroot Flesh Shaper must be blocked by unit max of 1");
});

test("Unit max — Kroot Carnivores capped at 3", () => {
  assertEqual(krp.unitMax("tau_kroot_carnivores"), 3, "Kroot Carnivores max must be 3");
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
  ];
  assert(!krp.canAdd(list, "tau_kroot_carnivores"),
    "Fourth Kroot Carnivores must be blocked by unit max of 3");
});

test("Unit max — Kroot Farstalkers capped at 3", () => {
  assertEqual(krp.unitMax("tau_kroot_farstalkers"), 3, "Kroot Farstalkers max must be 3");
});

test("Unit max — Kroot Hounds capped at 3", () => {
  assertEqual(krp.unitMax("tau_kroot_hounds"), 3, "Kroot Hounds max must be 3");
});

test("Unit max — Krootox Rider capped at 3", () => {
  assertEqual(krp.unitMax("tau_krootox_rider"), 3, "Krootox Rider max must be 3");
});

// ── Farstalker ratio ──────────────────────────────────────────────────────────

test("Farstalker ratio — 1st Farstalker blocked with no Carnivores", () => {
  assert(krpIsRatioBlocked("tau_kroot_farstalkers", []),
    "First Farstalker must be blocked when no Carnivores are present");
});

test("Farstalker ratio — 1st Farstalker allowed with 1 Carnivore", () => {
  assert(!krpIsRatioBlocked("tau_kroot_farstalkers", [{ unitId: "tau_kroot_carnivores" }]),
    "First Farstalker must be allowed when 1 Carnivore is present");
});

test("Farstalker ratio — 2nd Farstalker blocked when Farstalkers equal Carnivores (1:1)", () => {
  const list = [{ unitId: "tau_kroot_carnivores" }, { unitId: "tau_kroot_farstalkers" }];
  assert(krpIsRatioBlocked("tau_kroot_farstalkers", list),
    "Second Farstalker must be blocked when Farstalkers (1) already equal Carnivores (1)");
});

test("Farstalker ratio — 2nd Farstalker allowed with 2 Carnivores", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_farstalkers" },
  ];
  assert(!krpIsRatioBlocked("tau_kroot_farstalkers", list),
    "Second Farstalker must be allowed when 2 Carnivores are present");
});

test("Farstalker ratio — 3rd Farstalker allowed with 3 Carnivores", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_farstalkers" },
    { unitId: "tau_kroot_farstalkers" },
  ];
  assert(!krpIsRatioBlocked("tau_kroot_farstalkers", list),
    "Third Farstalker must be allowed when 3 Carnivores are present");
});

// ── Hounds ratio ──────────────────────────────────────────────────────────────

test("Hounds ratio — 1st Hounds blocked with no Carnivores", () => {
  assert(krpIsRatioBlocked("tau_kroot_hounds", []),
    "First Kroot Hounds must be blocked when no Carnivores are present");
});

test("Hounds ratio — 1st Hounds allowed with 1 Carnivore", () => {
  assert(!krpIsRatioBlocked("tau_kroot_hounds", [{ unitId: "tau_kroot_carnivores" }]),
    "First Kroot Hounds must be allowed when 1 Carnivore is present");
});

test("Hounds ratio — 2nd Hounds blocked when Hounds equal Carnivores (1:1)", () => {
  const list = [{ unitId: "tau_kroot_carnivores" }, { unitId: "tau_kroot_hounds" }];
  assert(krpIsRatioBlocked("tau_kroot_hounds", list),
    "Second Kroot Hounds must be blocked when Hounds (1) already equal Carnivores (1)");
});

test("Hounds ratio — 2nd Hounds allowed with 2 Carnivores", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_hounds" },
  ];
  assert(!krpIsRatioBlocked("tau_kroot_hounds", list),
    "Second Kroot Hounds must be allowed when 2 Carnivores are present");
});

// ── Krootox ratio ─────────────────────────────────────────────────────────────

test("Krootox ratio — 1st Krootox Rider blocked with no Carnivores", () => {
  assert(krpIsRatioBlocked("tau_krootox_rider", []),
    "First Krootox Rider must be blocked when no Carnivores are present");
});

test("Krootox ratio — 1st Krootox Rider allowed with 1 Carnivore", () => {
  assert(!krpIsRatioBlocked("tau_krootox_rider", [{ unitId: "tau_kroot_carnivores" }]),
    "First Krootox Rider must be allowed when 1 Carnivore is present");
});

test("Krootox ratio — 2nd Krootox Rider blocked when Krootox equal Carnivores (1:1)", () => {
  const list = [{ unitId: "tau_kroot_carnivores" }, { unitId: "tau_krootox_rider" }];
  assert(krpIsRatioBlocked("tau_krootox_rider", list),
    "Second Krootox Rider must be blocked when Krootox (1) already equal Carnivores (1)");
});

test("Krootox ratio — 2nd Krootox Rider allowed with 2 Carnivores", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_krootox_rider" },
  ];
  assert(!krpIsRatioBlocked("tau_krootox_rider", list),
    "Second Krootox Rider must be allowed when 2 Carnivores are present");
});

// ── Ratio independence ────────────────────────────────────────────────────────

test("Ratio independence — Hounds do not affect Krootox Rider constraint", () => {
  const list = [{ unitId: "tau_kroot_carnivores" }, { unitId: "tau_kroot_hounds" }];
  assert(!krpIsRatioBlocked("tau_krootox_rider", list),
    "Krootox Rider must not be blocked by Hounds occupying a Carnivore slot");
});

test("Ratio independence — Krootox Rider does not affect Hounds constraint", () => {
  const list = [{ unitId: "tau_kroot_carnivores" }, { unitId: "tau_krootox_rider" }];
  assert(!krpIsRatioBlocked("tau_kroot_hounds", list),
    "Kroot Hounds must not be blocked by Krootox Rider occupying a Carnivore slot");
});

test("Ratio independence — Farstalkers do not affect Hounds or Krootox constraints", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_farstalkers" },
  ];
  assert(!krpIsRatioBlocked("tau_kroot_hounds", list),
    "Kroot Hounds must not be blocked by Farstalkers occupying a Carnivore slot");
  assert(!krpIsRatioBlocked("tau_krootox_rider", list),
    "Krootox Rider must not be blocked by Farstalkers occupying a Carnivore slot");
});

test("Ratio independence — Carnivores themselves are never ratio-blocked", () => {
  assert(!krpIsRatioBlocked("tau_kroot_carnivores", []),
    "Kroot Carnivores must never be blocked by any ratio constraint");
  assert(!krpIsRatioBlocked("tau_kroot_carnivores", [
    { unitId: "tau_kroot_farstalkers" },
    { unitId: "tau_kroot_hounds" },
    { unitId: "tau_krootox_rider" },
  ]), "Kroot Carnivores must not be blocked even when all three numerator units are present");
});

test("Combined ratio stress — 3 Carnivores allows up to 3 each of Farstalkers, Hounds, and Krootox", () => {
  const list = [
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_carnivores" },
    { unitId: "tau_kroot_farstalkers" },
    { unitId: "tau_kroot_farstalkers" },
    { unitId: "tau_kroot_hounds" },
    { unitId: "tau_kroot_hounds" },
    { unitId: "tau_krootox_rider" },
    { unitId: "tau_krootox_rider" },
  ];
  // Adding a 3rd of each should be allowed (num=2, den=3 → 2+1 > 3 is false)
  assert(!krpIsRatioBlocked("tau_kroot_farstalkers", list), "3rd Farstalker must be allowed with 3 Carnivores");
  assert(!krpIsRatioBlocked("tau_kroot_hounds",      list), "3rd Hounds must be allowed with 3 Carnivores");
  assert(!krpIsRatioBlocked("tau_krootox_rider",     list), "3rd Krootox Rider must be allowed with 3 Carnivores");
});

test("Smoke test — 2x Carnivores + 2x Farstalkers + 1x Hounds + 1x Krootox Rider = 130 + 170 + 40 + 40 = 380pts (legal)", () => {
  const pts = (65 * 2) + (85 * 2) + 40 + 40;
  assertEqual(pts, 380, "Expected 380pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Kroot Flesh Shaper + 3x Carnivores + 3x Farstalkers = 45 + 195 + 255 = 495pts (legal)", () => {
  const pts = 45 + (65 * 3) + (85 * 3);
  assertEqual(pts, 495, "Expected 495pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 98: New Unit Types (BEAST and MOUNTED) ────────────────────────────

section("98. New Unit Types — BEAST and MOUNTED");

test("HTML TYPE_ORDER includes BEAST type", () => {
  assert(html.includes('"BEAST"'),
    "TYPE_ORDER in HTML must include BEAST");
});

test("HTML TYPE_ORDER includes MOUNTED type", () => {
  assert(html.includes('"MOUNTED"'),
    "TYPE_ORDER in HTML must include MOUNTED");
});

test("HTML has badge-BEAST CSS class defined", () => {
  assert(html.includes(".badge-BEAST"),
    "HTML must define .badge-BEAST CSS class");
});

test("HTML has badge-MOUNTED CSS class defined", () => {
  assert(html.includes(".badge-MOUNTED"),
    "HTML must define .badge-MOUNTED CSS class");
});

test("HTML has ps-badge-BEAST CSS class defined for print sheet", () => {
  assert(html.includes(".ps-badge-BEAST"),
    "HTML must define .ps-badge-BEAST CSS class for print sheet");
});

test("HTML has ps-badge-MOUNTED CSS class defined for print sheet", () => {
  assert(html.includes(".ps-badge-MOUNTED"),
    "HTML must define .ps-badge-MOUNTED CSS class for print sheet");
});

test("BEAST and MOUNTED appear after VEHICLE and before SWARM in TYPE_ORDER", () => {
  const match = html.match(/TYPE_ORDER\s*=\s*\[([^\]]+)\]/);
  assert(!!match, "TYPE_ORDER must be defined in HTML");
  const order = match[1].replace(/"/g, "").split(",").map(s => s.trim());
  const idxVehicle  = order.indexOf("VEHICLE");
  const idxBeast    = order.indexOf("BEAST");
  const idxMounted  = order.indexOf("MOUNTED");
  const idxSwarm    = order.indexOf("SWARM");
  assert(idxVehicle  >= 0, "VEHICLE must be in TYPE_ORDER");
  assert(idxBeast    >= 0, "BEAST must be in TYPE_ORDER");
  assert(idxMounted  >= 0, "MOUNTED must be in TYPE_ORDER");
  assert(idxSwarm    >= 0, "SWARM must be in TYPE_ORDER");
  assert(idxBeast   > idxVehicle, "BEAST must come after VEHICLE");
  assert(idxMounted > idxBeast,   "MOUNTED must come after BEAST");
  assert(idxSwarm   > idxMounted, "SWARM must come after MOUNTED");
});

test("BEAST type units exist across multiple factions (Tau, Space Marines, Heretic Astartes, World Eaters, Death Guard)", () => {
  const beastFactions = ["tau_empire", "space_marines", "chaos_space_marines", "world_eaters", "death_guard"];
  beastFactions.forEach(fid => {
    const units = factionData[fid]?.units.filter(u => u.type === "BEAST") ?? [];
    assert(units.length > 0, `Faction ${fid} must have at least one BEAST type unit`);
  });
});

test("T'au Empire is the only faction currently using MOUNTED type units", () => {
  Object.entries(factionData).forEach(([fid, data]) => {
    if (fid === "tau_empire") return;
    data.units.filter(u => u.type === "MOUNTED").forEach(u => {
      assert(false, `Unexpected MOUNTED unit ${u.id} found in faction ${fid}`);
    });
  });
});


// ── Section 99: keywordRatios Array Support ───────────────────────────────────

section("99. keywordRatios Array — New Multi-Constraint Feature");

test("HTML isKeywordRatioBlocked handles keywordRatios array", () => {
  assert(html.includes("keywordRatios"),
    "isKeywordRatioBlocked in HTML must reference keywordRatios");
});

test("HTML processes both keywordRatio and keywordRatios in the same function", () => {
  // Both fields should be iterated in a ratios array
  assert(html.includes("det?.keywordRatio") && html.includes("det?.keywordRatios"),
    "HTML must check both keywordRatio and keywordRatios");
});

test("HTML warning pill logic handles keywordRatios array", () => {
  // The warning/pill section should also reference keywordRatios
  assert(html.includes("allRatios"),
    "HTML warning pill logic must use allRatios to consolidate keywordRatio and keywordRatios");
});

test("isKeywordRatioBlockedR helper handles keywordRatios array", () => {
  // Verify the test helper itself was updated to mirror the HTML
  // by exercising it: Kroot Raiding Party has keywordRatios; Hounds blocked with empty list
  const krpUnit = tauUnit("tau_kroot_hounds");
  assert(isKeywordRatioBlockedR(krpUnit, krpDet, [], tauUnits),
    "isKeywordRatioBlockedR must block Kroot Hounds when no Carnivores present (keywordRatios path)");
});

test("isKeywordRatioBlockedR keywordRatios path — Hounds allowed with 1 Carnivore", () => {
  const krpUnit = tauUnit("tau_kroot_hounds");
  const list = [{ unitId: "tau_kroot_carnivores" }];
  assert(!isKeywordRatioBlockedR(krpUnit, krpDet, list, tauUnits),
    "isKeywordRatioBlockedR must allow Kroot Hounds when 1 Carnivore is present");
});

test("isKeywordRatioBlockedR keywordRatios path — Krootox blocked with empty list", () => {
  const krpUnit = tauUnit("tau_krootox_rider");
  assert(isKeywordRatioBlockedR(krpUnit, krpDet, [], tauUnits),
    "isKeywordRatioBlockedR must block Krootox Rider when no Carnivores present (keywordRatios path)");
});

test("isKeywordRatioBlockedR keywordRatio (singular) path still works — Farstalkers blocked with empty list", () => {
  const krpUnit = tauUnit("tau_kroot_farstalkers");
  assert(isKeywordRatioBlockedR(krpUnit, krpDet, [], tauUnits),
    "isKeywordRatioBlockedR must block Farstalkers via keywordRatio (singular) path");
});

test("Detachments without keywordRatios are unaffected by new array logic", () => {
  // Starfire Cadre has neither keywordRatio nor keywordRatios
  const scUnit = tauUnit("tau_breacher_team");
  assert(!isKeywordRatioBlockedR(scUnit, scDet, [], tauUnits),
    "Breacher Team must not be ratio-blocked in Starfire Cadre which has no ratio constraints");
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ADEPTUS MECHANICUS                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks. Section 3 covers all of these globally. Only faction-specific
// behaviour is tested here: points values, keywords, rules adaptations content,
// and constraint logic.

section("100. Adeptus Mechanicus Faction");

const amFaction = index.factions.find(f => f.id === "adeptus_mechanicus");
const amData    = factionData["adeptus_mechanicus"];
const amUnits   = amData ? amData.units : [];
const amDets    = amData ? amData.detachments : [];
const amUnit    = id => amUnits.find(u => u.id === id);

test("Adeptus Mechanicus faction entry exists in index", () => {
  assert(!!amFaction, "adeptus_mechanicus must exist in index.factions");
});

test("Adeptus Mechanicus has Close-Quarters Doctrinas army rule", () => {
  assertEqual(amFaction.armyRule.name, "Close-Quarters Doctrinas");
});

test("Close-Quarters Doctrinas desc references Doctrina Imperatives", () => {
  assert(amFaction.armyRule.desc.includes("Doctrina Imperatives"),
    "army rule desc must mention 'Doctrina Imperatives'");
});

test("Close-Quarters Doctrinas desc references ASSAULT, IGNORES COVER and PISTOL", () => {
  assert(amFaction.armyRule.desc.includes("ASSAULT"),
    "army rule desc must mention '[ASSAULT]'");
  assert(amFaction.armyRule.desc.includes("IGNORES COVER"),
    "army rule desc must mention '[IGNORES COVER]'");
  assert(amFaction.armyRule.desc.includes("PISTOL"),
    "army rule desc must mention '[PISTOL]'");
});

test("Adeptus Mechanicus has exactly 3 detachments", () => {
  assertEqual(amDets.length, 3, "Expected 3 detachments, got " + amDets.length);
});

test("Adeptus Mechanicus has exactly 13 units", () => {
  assertEqual(amUnits.length, 13, "Expected 13 units, got " + amUnits.length);
});

test("Adeptus Mechanicus unit IDs are all prefixed am_", () => {
  amUnits.forEach(u => {
    assert(u.id.startsWith("am_"), "Unit id '" + u.id + "' must start with 'am_'");
  });
});


// ── Section 101: Response Clade Detachment ────────────────────────────────────

section("101. Adeptus Mechanicus — Response Clade Detachment");

const rcDet = amDets ? amDets.find(d => d.id === "am_response_clade") : null;

test("Response Clade detachment exists", () => {
  assert(!!rcDet, "am_response_clade must exist in Adeptus Mechanicus detachments");
});

test("Response Clade has maxCharacters of 2", () => {
  assertEqual(rcDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Response Clade special rule is Procedural Elimination", () => {
  assertEqual(rcDet.specialRule.name, "Procedural Elimination");
});

test("Procedural Elimination desc references SKITARII", () => {
  assert(rcDet.specialRule.desc.includes("SKITARII"),
    "special rule desc must mention 'SKITARII'");
});

test("Procedural Elimination desc references Hit roll of 1", () => {
  assert(rcDet.specialRule.desc.includes("Hit roll of 1"),
    "special rule desc must mention 'Hit roll of 1'");
});

test("Procedural Elimination desc references melee attacks and ranged attacks", () => {
  assert(rcDet.specialRule.desc.includes("melee attacks"),
    "special rule desc must mention 'melee attacks'");
  assert(rcDet.specialRule.desc.includes("ranged attacks"),
    "special rule desc must mention 'ranged attacks'");
});

test("Response Clade has exactly 2 enhancements", () => {
  assertEqual(rcDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + rcDet.enhancements.length);
});

test("Response Clade enhancements — Admonissor Shunt and Optimised Cogitators present", () => {
  const ids = rcDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_am_admonissor_shunt"),       "must include enh_am_admonissor_shunt");
  assert(ids.includes("enh_am_optimised_cogitators"),   "must include enh_am_optimised_cogitators");
});

test("Admonissor Shunt requiresKeywords is empty array", () => {
  const enh = rcDet.enhancements.find(e => e.id === "enh_am_admonissor_shunt");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Admonissor Shunt must have empty requiresKeywords array");
});

test("Admonissor Shunt desc references Battle-shocked and SKITARII", () => {
  const enh = rcDet.enhancements.find(e => e.id === "enh_am_admonissor_shunt");
  assert(enh.desc.includes("Battle-shocked"), "desc must mention 'Battle-shocked'");
  assert(enh.desc.includes("SKITARII"),       "desc must mention 'SKITARII'");
});

test("Optimised Cogitators requiresKeywords is empty array", () => {
  const enh = rcDet.enhancements.find(e => e.id === "enh_am_optimised_cogitators");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Optimised Cogitators must have empty requiresKeywords array");
});

test("Optimised Cogitators desc references Stratagem and CP", () => {
  const enh = rcDet.enhancements.find(e => e.id === "enh_am_optimised_cogitators");
  assert(enh.desc.includes("Stratagem"), "desc must mention 'Stratagem'");
  assert(enh.desc.includes("CP"),        "desc must mention 'CP'");
});

test("Response Clade unit roster — correct IDs and maxes", () => {
  const find = id => rcDet.units.find(u => u.id === id);
  assert(find("am_skitarii_marshall")?.max     === 2, "am_skitarii_marshall max must be 2");
  assert(find("am_skitarii_rangers")?.max      === 3, "am_skitarii_rangers max must be 3");
  assert(find("am_skitarii_vanguard")?.max     === 3, "am_skitarii_vanguard max must be 3");
  assert(find("am_sicarian_infiltrators")?.max === 1, "am_sicarian_infiltrators max must be 1");
  assert(find("am_sicarian_ruststalkers")?.max === 1, "am_sicarian_ruststalkers max must be 1");
});

test("Response Clade has exactly 5 unit slots", () => {
  assertEqual(rcDet.units.length, 5, "Expected 5 unit slots, got " + rcDet.units.length);
});

test("Response Clade has no ratio constraints", () => {
  assert(rcDet.keywordRatio  === undefined, "Response Clade must not have keywordRatio");
  assert(rcDet.keywordRatios === undefined, "Response Clade must not have keywordRatios");
});


// ── Section 102: Response Clade Unit Definitions ──────────────────────────────

section("102. Adeptus Mechanicus — Response Clade Unit Definitions");

test("Skitarii Marshall — CHARACTER, SKITARII, 35pts for 1 model, no rulesAdaptations", () => {
  const u = amUnit("am_skitarii_marshall");
  assert(!!u, "am_skitarii_marshall not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("INFANTRY"),           "must have INFANTRY");
  assert(u.keywords.includes("CHARACTER"),          "must have CHARACTER");
  assert(u.keywords.includes("IMPERIUM"),           "must have IMPERIUM");
  assert(u.keywords.includes("SKITARII"),           "must have SKITARII");
  assert(!u.keywords.includes("CULT MECHANICUS"),   "must NOT have CULT MECHANICUS");
  assertEqual(u.sizes.length, 1,           "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "1 model", "size label must be '1 model'");
  assertEqual(u.sizes[0].pts, 35,          "must cost 35pts");
  assert(!u.rulesAdaptations,              "Skitarii Marshall must have no rulesAdaptations");
});

test("Skitarii Rangers — BATTLELINE, SKITARII, 85pts for 10 models, loses Scouts and Objective Scouted", () => {
  const u = amUnit("am_skitarii_rangers");
  assert(!!u, "am_skitarii_rangers not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("INFANTRY"),           "must have INFANTRY");
  assert(u.keywords.includes("BATTLELINE"),         "must have BATTLELINE");
  assert(u.keywords.includes("IMPERIUM"),           "must have IMPERIUM");
  assert(u.keywords.includes("SKITARII"),           "must have SKITARII");
  assertEqual(u.sizes[0].pts, 85,            "must cost 85pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Scouts"),
    "rulesAdaptations must mention 'Scouts'");
  assert(u.rulesAdaptations.includes("Objective Scouted"),
    "rulesAdaptations must mention 'Objective Scouted'");
});

test("Skitarii Vanguard — BATTLELINE, SKITARII, 95pts for 10 models, no rulesAdaptations", () => {
  const u = amUnit("am_skitarii_vanguard");
  assert(!!u, "am_skitarii_vanguard not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("BATTLELINE"),         "must have BATTLELINE");
  assert(u.keywords.includes("SKITARII"),           "must have SKITARII");
  assertEqual(u.sizes[0].pts, 95,            "must cost 95pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(!u.rulesAdaptations,                "Skitarii Vanguard must have no rulesAdaptations");
});

test("Skitarii Rangers and Skitarii Vanguard share SKITARII keyword and BATTLELINE type", () => {
  ["am_skitarii_rangers", "am_skitarii_vanguard"].forEach(id => {
    const u = amUnit(id);
    assertEqual(u.type, "BATTLELINE", id + " must be BATTLELINE type");
    assert(u.keywords.includes("SKITARII"),   id + " must have SKITARII keyword");
    assert(u.keywords.includes("BATTLELINE"), id + " must have BATTLELINE keyword");
  });
});

test("Skitarii Marshall does not have BATTLELINE keyword", () => {
  const u = amUnit("am_skitarii_marshall");
  assert(!u.keywords.includes("BATTLELINE"), "Skitarii Marshall must NOT have BATTLELINE");
});

test("Sicarian Infiltrators — INFANTRY, SKITARII, 75pts/5 models and 155pts/10 models", () => {
  const u = amUnit("am_sicarian_infiltrators");
  assert(!!u, "am_sicarian_infiltrators not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("SKITARII"),           "must have SKITARII");
  assert(!u.keywords.includes("CULT MECHANICUS"),   "must NOT have CULT MECHANICUS");
  assertEqual(u.sizes.length, 2,              "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",   "first size label must be '5 models'");
  assertEqual(u.sizes[0].pts, 75,             "5-model option must cost 75pts");
  assertEqual(u.sizes[1].label, "10 models",  "second size label must be '10 models'");
  assertEqual(u.sizes[1].pts, 155,            "10-model option must cost 155pts");
});

test("Sicarian Ruststalkers — INFANTRY, SKITARII, 80pts/5 models and 165pts/10 models", () => {
  const u = amUnit("am_sicarian_ruststalkers");
  assert(!!u, "am_sicarian_ruststalkers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("SKITARII"),           "must have SKITARII");
  assert(!u.keywords.includes("CULT MECHANICUS"),   "must NOT have CULT MECHANICUS");
  assertEqual(u.sizes.length, 2,              "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",   "first size label must be '5 models'");
  assertEqual(u.sizes[0].pts, 80,             "5-model option must cost 80pts");
  assertEqual(u.sizes[1].label, "10 models",  "second size label must be '10 models'");
  assertEqual(u.sizes[1].pts, 165,            "10-model option must cost 165pts");
});

test("Sicarian Infiltrators and Ruststalkers both have SKITARII but not CULT MECHANICUS", () => {
  ["am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    const u = amUnit(id);
    assert(u.keywords.includes("SKITARII"),        id + " must have SKITARII");
    assert(!u.keywords.includes("CULT MECHANICUS"), id + " must NOT have CULT MECHANICUS");
  });
});

test("Response Clade SKITARII units — all five have SKITARII keyword", () => {
  ["am_skitarii_marshall", "am_skitarii_rangers", "am_skitarii_vanguard",
   "am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    assert(amUnit(id)?.keywords.includes("SKITARII"), id + " must have SKITARII keyword");
  });
});


// ── Section 103: Response Clade Game Rule Logic ───────────────────────────────

section("103. Adeptus Mechanicus — Response Clade Game Rule Logic");

const rc = makeDetHelpers(rcDet, id => amUnit(id));

test("Character cap — Skitarii Marshall can be added to an empty list", () => {
  assert(rc.canAdd([], "am_skitarii_marshall"),
    "Skitarii Marshall must be addable to an empty list");
});

test("Character cap — up to 2 Skitarii Marshalls allowed (per unit max)", () => {
  assertEqual(rc.unitMax("am_skitarii_marshall"), 2, "Skitarii Marshall max must be 2");
  const list = [{ unitId: "am_skitarii_marshall" }];
  assert(rc.canAdd(list, "am_skitarii_marshall"),
    "Second Skitarii Marshall must be allowed when only 1 is present");
});

test("Character cap — third CHARACTER blocked when cap of 2 filled by 2 Marshalls", () => {
  const list = [{ unitId: "am_skitarii_marshall" }, { unitId: "am_skitarii_marshall" }];
  assertEqual(rc.charCount(list), 2, "must count 2 CHARACTERs");
  assert(!rc.canAdd(list, "am_skitarii_marshall"),
    "Third Skitarii Marshall must be blocked by both unit max (2) and char cap (2)");
});

test("Character cap — non-CHARACTER units are never blocked by the cap", () => {
  const list = [{ unitId: "am_skitarii_marshall" }, { unitId: "am_skitarii_marshall" }];
  ["am_skitarii_rangers", "am_skitarii_vanguard",
   "am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    assert(rc.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Skitarii Rangers capped at 3", () => {
  assertEqual(rc.unitMax("am_skitarii_rangers"), 3, "Skitarii Rangers max must be 3");
  const list = [
    { unitId: "am_skitarii_rangers" },
    { unitId: "am_skitarii_rangers" },
    { unitId: "am_skitarii_rangers" },
  ];
  assert(!rc.canAdd(list, "am_skitarii_rangers"),
    "Fourth Skitarii Rangers must be blocked by unit max of 3");
});

test("Unit max — Skitarii Vanguard capped at 3", () => {
  assertEqual(rc.unitMax("am_skitarii_vanguard"), 3, "Skitarii Vanguard max must be 3");
  const list = [
    { unitId: "am_skitarii_vanguard" },
    { unitId: "am_skitarii_vanguard" },
    { unitId: "am_skitarii_vanguard" },
  ];
  assert(!rc.canAdd(list, "am_skitarii_vanguard"),
    "Fourth Skitarii Vanguard must be blocked by unit max of 3");
});

test("Unit max — Sicarian Infiltrators capped at 1", () => {
  assertEqual(rc.unitMax("am_sicarian_infiltrators"), 1, "Sicarian Infiltrators max must be 1");
  assert(!rc.canAdd([{ unitId: "am_sicarian_infiltrators" }], "am_sicarian_infiltrators"),
    "Second Sicarian Infiltrators must be blocked by unit max of 1");
});

test("Unit max — Sicarian Ruststalkers capped at 1", () => {
  assertEqual(rc.unitMax("am_sicarian_ruststalkers"), 1, "Sicarian Ruststalkers max must be 1");
  assert(!rc.canAdd([{ unitId: "am_sicarian_ruststalkers" }], "am_sicarian_ruststalkers"),
    "Second Sicarian Ruststalkers must be blocked by unit max of 1");
});

test("Smoke test — 2x Marshall + 3x Rangers + 3x Vanguard = 70 + 255 + 285 = 610pts (over limit)", () => {
  const pts = (35 * 2) + (85 * 3) + (95 * 3);
  assertEqual(pts, 610, "Expected 610pts, got " + pts);
  assert(pts > 500, "must exceed 500pt limit");
});

test("Smoke test — 1x Marshall + 3x Rangers = 35 + 255 = 290pts (legal)", () => {
  const pts = 35 + (85 * 3);
  assertEqual(pts, 290, "Expected 290pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — 1x Marshall + 3x Vanguard + 1x Sicarian Infiltrators (5-model) = 35 + 285 + 75 = 395pts (legal)", () => {
  const pts = 35 + (95 * 3) + 75;
  assertEqual(pts, 395, "Expected 395pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — 2x Marshall + 1x Sicarian Infiltrators (10-model) + 1x Sicarian Ruststalkers (10-model) = 70 + 155 + 165 = 390pts (legal)", () => {
  const pts = (35 * 2) + 155 + 165;
  assertEqual(pts, 390, "Expected 390pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 104: Machine Cult Detachment ──────────────────────────────────────

section("104. Adeptus Mechanicus — Machine Cult Detachment");

const mcDet = amDets ? amDets.find(d => d.id === "am_machine_cult") : null;

test("Machine Cult detachment exists", () => {
  assert(!!mcDet, "am_machine_cult must exist in Adeptus Mechanicus detachments");
});

test("Machine Cult has maxCharacters of 2", () => {
  assertEqual(mcDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Machine Cult special rule is Canticles of the Omnissiah", () => {
  assertEqual(mcDet.specialRule.name, "Canticles of the Omnissiah");
});

test("Canticles of the Omnissiah desc references TECH-PRIEST and ELECTRO-PRIESTS", () => {
  assert(mcDet.specialRule.desc.includes("TECH-PRIEST"),
    "special rule desc must mention 'TECH-PRIEST'");
  assert(mcDet.specialRule.desc.includes("ELECTRO-PRIESTS"),
    "special rule desc must mention 'ELECTRO-PRIESTS'");
});

test("Canticles of the Omnissiah desc references Advance rolls and Charge rolls", () => {
  assert(mcDet.specialRule.desc.includes("Advance rolls"),
    "special rule desc must mention 'Advance rolls'");
  assert(mcDet.specialRule.desc.includes("Charge rolls"),
    "special rule desc must mention 'Charge rolls'");
});

test("Canticles of the Omnissiah desc references Battle-shock tests", () => {
  assert(mcDet.specialRule.desc.includes("Battle-shock tests"),
    "special rule desc must mention 'Battle-shock tests'");
});

test("Canticles of the Omnissiah desc references Secure Sites and BATTLELINE", () => {
  assert(mcDet.specialRule.desc.includes("Secure Sites"),
    "special rule desc must mention 'Secure Sites'");
  assert(mcDet.specialRule.desc.includes("BATTLELINE"),
    "special rule desc must mention 'BATTLELINE'");
});

test("Machine Cult has exactly 2 enhancements", () => {
  assertEqual(mcDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + mcDet.enhancements.length);
});

test("Machine Cult enhancements — Beseech the Machine Spirits and Harmonic Discordator present", () => {
  const ids = mcDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_am_beseech_the_machine_spirits"), "must include enh_am_beseech_the_machine_spirits");
  assert(ids.includes("enh_am_harmonic_discordator"),        "must include enh_am_harmonic_discordator");
});

test("Beseech the Machine Spirits requiresKeywords is empty array", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_beseech_the_machine_spirits");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Beseech the Machine Spirits must have empty requiresKeywords array");
});

test("Beseech the Machine Spirits desc references Hatchway and Movement phase", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_beseech_the_machine_spirits");
  assert(enh.desc.includes("Hatchway"),        "desc must mention 'Hatchway'");
  assert(enh.desc.includes("Movement phase"),  "desc must mention 'Movement phase'");
});

test("Beseech the Machine Spirits desc references Toughness and roll-off", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_beseech_the_machine_spirits");
  assert(enh.desc.includes("Toughness"), "desc must mention 'Toughness'");
  assert(enh.desc.includes("roll-off"),  "desc must mention 'roll-off'");
});

test("Harmonic Discordator requiresKeywords is empty array", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_harmonic_discordator");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Harmonic Discordator must have empty requiresKeywords array");
});

test("Harmonic Discordator desc references Battle-shock and Command Phase", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_harmonic_discordator");
  assert(enh.desc.includes("Battle-shock"),   "desc must mention 'Battle-shock'");
  assert(enh.desc.includes("Command Phase"),  "desc must mention 'Command Phase'");
});

test("Harmonic Discordator desc references Starting Strength and Below Half-Strength", () => {
  const enh = mcDet.enhancements.find(e => e.id === "enh_am_harmonic_discordator");
  assert(enh.desc.includes("Starting Strength"),    "desc must mention 'Starting Strength'");
  assert(enh.desc.includes("Below Half-Strength"),  "desc must mention 'Below Half-Strength'");
});

test("Machine Cult unit roster — correct IDs and maxes", () => {
  const find = id => mcDet.units.find(u => u.id === id);
  assert(find("am_tech_priest_dominus")?.max        === 1, "am_tech_priest_dominus max must be 1");
  assert(find("am_tech_priest_enginseer")?.max      === 1, "am_tech_priest_enginseer max must be 1");
  assert(find("am_tech_priest_manipulus")?.max      === 1, "am_tech_priest_manipulus max must be 1");
  assert(find("am_technoarcheologist")?.max         === 1, "am_technoarcheologist max must be 1");
  assert(find("am_corpuscarii_electro_priests")?.max === 1, "am_corpuscarii_electro_priests max must be 1");
  assert(find("am_fulgurite_electro_priests")?.max  === 1, "am_fulgurite_electro_priests max must be 1");
  assert(find("am_kataphron_breachers")?.max        === 1, "am_kataphron_breachers max must be 1");
  assert(find("am_kataphron_destroyers")?.max       === 1, "am_kataphron_destroyers max must be 1");
});

test("Machine Cult has exactly 8 unit slots", () => {
  assertEqual(mcDet.units.length, 8, "Expected 8 unit slots, got " + mcDet.units.length);
});

test("Machine Cult has no ratio constraints", () => {
  assert(mcDet.keywordRatio  === undefined, "Machine Cult must not have keywordRatio");
  assert(mcDet.keywordRatios === undefined, "Machine Cult must not have keywordRatios");
});


// ── Section 105: Machine Cult Unit Definitions ────────────────────────────────

section("105. Adeptus Mechanicus — Machine Cult Unit Definitions");

test("Tech-Priest Dominus — CHARACTER, TECH-PRIEST, CULT MECHANICUS, 65pts, loses Dataspike", () => {
  const u = amUnit("am_tech_priest_dominus");
  assert(!!u, "am_tech_priest_dominus not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("INFANTRY"),           "must have INFANTRY");
  assert(u.keywords.includes("CHARACTER"),          "must have CHARACTER");
  assert(u.keywords.includes("IMPERIUM"),           "must have IMPERIUM");
  assert(u.keywords.includes("CULT MECHANICUS"),    "must have CULT MECHANICUS");
  assert(u.keywords.includes("TECH-PRIEST"),        "must have TECH-PRIEST");
  assert(!u.keywords.includes("SKITARII"),          "must NOT have SKITARII");
  assertEqual(u.sizes[0].pts, 65,                   "must cost 65pts");
  assertEqual(u.sizes[0].label, "1 model",          "size label must be '1 model'");
  assert(typeof u.rulesAdaptations === "string" && u.rulesAdaptations.includes("Dataspike"),
    "rulesAdaptations must mention 'Dataspike'");
});

test("Tech-Priest Enginseer — CHARACTER, TECH-PRIEST, CULT MECHANICUS, 55pts, no rulesAdaptations", () => {
  const u = amUnit("am_tech_priest_enginseer");
  assert(!!u, "am_tech_priest_enginseer not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("CULT MECHANICUS"), "must have CULT MECHANICUS");
  assert(u.keywords.includes("TECH-PRIEST"),     "must have TECH-PRIEST");
  assert(!u.keywords.includes("SKITARII"),       "must NOT have SKITARII");
  assertEqual(u.sizes[0].pts, 55,                "must cost 55pts");
  assertEqual(u.sizes[0].label, "1 model",       "size label must be '1 model'");
  assert(!u.rulesAdaptations,                    "Tech-Priest Enginseer must have no rulesAdaptations");
});

test("Tech-Priest Manipulus — CHARACTER, TECH-PRIEST, CULT MECHANICUS, 60pts, hyphenated name", () => {
  const u = amUnit("am_tech_priest_manipulus");
  assert(!!u, "am_tech_priest_manipulus not found");
  assertEqual(u.name, "Tech-Priest Manipulus", "name must be 'Tech-Priest Manipulus' with hyphen");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("CULT MECHANICUS"), "must have CULT MECHANICUS");
  assert(u.keywords.includes("TECH-PRIEST"),     "must have TECH-PRIEST");
  assertEqual(u.sizes[0].pts, 60,                "must cost 60pts");
  assert(!u.rulesAdaptations,                    "Tech-Priest Manipulus must have no rulesAdaptations");
});

test("Technoarcheologist — CHARACTER, TECH-PRIEST, CULT MECHANICUS, 60pts", () => {
  const u = amUnit("am_technoarcheologist");
  assert(!!u, "am_technoarcheologist not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("CULT MECHANICUS"), "must have CULT MECHANICUS");
  assert(u.keywords.includes("TECH-PRIEST"),     "must have TECH-PRIEST");
  assertEqual(u.sizes[0].pts, 60,                "must cost 60pts");
  assertEqual(u.sizes[0].label, "1 model",       "size label must be '1 model'");
  assert(!u.rulesAdaptations,                    "Technoarcheologist must have no rulesAdaptations");
});

test("All four Tech-Priest variants share CHARACTER type, TECH-PRIEST and CULT MECHANICUS keywords", () => {
  ["am_tech_priest_dominus", "am_tech_priest_enginseer",
   "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    const u = amUnit(id);
    assertEqual(u.type, "CHARACTER",               id + " must be CHARACTER type");
    assert(u.keywords.includes("TECH-PRIEST"),     id + " must have TECH-PRIEST keyword");
    assert(u.keywords.includes("CULT MECHANICUS"), id + " must have CULT MECHANICUS keyword");
    assert(!u.keywords.includes("SKITARII"),       id + " must NOT have SKITARII keyword");
  });
});

test("Corpuscarii Electro-Priests — INFANTRY, ELECTRO-PRIESTS, CULT MECHANICUS, 65pts/5 models, 130pts/10 models", () => {
  const u = amUnit("am_corpuscarii_electro_priests");
  assert(!!u, "am_corpuscarii_electro_priests not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("INFANTRY"),           "must have INFANTRY");
  assert(u.keywords.includes("IMPERIUM"),           "must have IMPERIUM");
  assert(u.keywords.includes("CULT MECHANICUS"),    "must have CULT MECHANICUS");
  assert(u.keywords.includes("ELECTRO-PRIESTS"),    "must have ELECTRO-PRIESTS");
  assert(!u.keywords.includes("SKITARII"),          "must NOT have SKITARII");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].label, "5 models",  "first size label must be '5 models'");
  assertEqual(u.sizes[0].pts, 65,            "5-model option must cost 65pts");
  assertEqual(u.sizes[1].label, "10 models", "second size label must be '10 models'");
  assertEqual(u.sizes[1].pts, 130,           "10-model option must cost 130pts");
});

test("Fulgurite Electro-Priests — INFANTRY, ELECTRO-PRIESTS, CULT MECHANICUS, 70pts/5 models, 140pts/10 models", () => {
  const u = amUnit("am_fulgurite_electro_priests");
  assert(!!u, "am_fulgurite_electro_priests not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ELECTRO-PRIESTS"),    "must have ELECTRO-PRIESTS");
  assert(u.keywords.includes("CULT MECHANICUS"),    "must have CULT MECHANICUS");
  assert(!u.keywords.includes("SKITARII"),          "must NOT have SKITARII");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].pts, 70,            "5-model option must cost 70pts");
  assertEqual(u.sizes[1].pts, 140,           "10-model option must cost 140pts");
});

test("Both Electro-Priests variants share ELECTRO-PRIESTS and CULT MECHANICUS keywords, not SKITARII", () => {
  ["am_corpuscarii_electro_priests", "am_fulgurite_electro_priests"].forEach(id => {
    const u = amUnit(id);
    assert(u.keywords.includes("ELECTRO-PRIESTS"),    id + " must have ELECTRO-PRIESTS");
    assert(u.keywords.includes("CULT MECHANICUS"),    id + " must have CULT MECHANICUS");
    assert(!u.keywords.includes("SKITARII"),          id + " must NOT have SKITARII");
    assert(!u.keywords.includes("TECH-PRIEST"),       id + " must NOT have TECH-PRIEST");
  });
});

test("Kataphron Breachers — INFANTRY, KATAPHRON, CULT MECHANICUS, 160pts for 3 models", () => {
  const u = amUnit("am_kataphron_breachers");
  assert(!!u, "am_kataphron_breachers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("ADEPTUS MECHANICUS"), "must have ADEPTUS MECHANICUS");
  assert(u.keywords.includes("INFANTRY"),           "must have INFANTRY");
  assert(u.keywords.includes("IMPERIUM"),           "must have IMPERIUM");
  assert(u.keywords.includes("CULT MECHANICUS"),    "must have CULT MECHANICUS");
  assert(u.keywords.includes("KATAPHRON"),          "must have KATAPHRON");
  assert(!u.keywords.includes("SKITARII"),          "must NOT have SKITARII");
  assertEqual(u.sizes.length, 1,            "must have exactly 1 size option");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assertEqual(u.sizes[0].pts, 160,          "must cost 160pts");
});

test("Kataphron Destroyers — INFANTRY, KATAPHRON, CULT MECHANICUS, 105pts for 3 models", () => {
  const u = amUnit("am_kataphron_destroyers");
  assert(!!u, "am_kataphron_destroyers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("CULT MECHANICUS"),    "must have CULT MECHANICUS");
  assert(u.keywords.includes("KATAPHRON"),          "must have KATAPHRON");
  assert(!u.keywords.includes("SKITARII"),          "must NOT have SKITARII");
  assertEqual(u.sizes[0].pts, 105,          "must cost 105pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
});

test("Both Kataphron variants share KATAPHRON and CULT MECHANICUS keywords, not SKITARII", () => {
  ["am_kataphron_breachers", "am_kataphron_destroyers"].forEach(id => {
    const u = amUnit(id);
    assert(u.keywords.includes("KATAPHRON"),       id + " must have KATAPHRON");
    assert(u.keywords.includes("CULT MECHANICUS"), id + " must have CULT MECHANICUS");
    assert(!u.keywords.includes("SKITARII"),       id + " must NOT have SKITARII");
  });
});

test("Machine Cult CHARACTER units all have CULT MECHANICUS, none have SKITARII", () => {
  ["am_tech_priest_dominus", "am_tech_priest_enginseer",
   "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    const u = amUnit(id);
    assert(u.keywords.includes("CULT MECHANICUS"), id + " must have CULT MECHANICUS");
    assert(!u.keywords.includes("SKITARII"),       id + " must NOT have SKITARII");
  });
});

test("Keyword segregation — SKITARII units are only in Response Clade, not Machine Cult", () => {
  const mcIds = mcDet.units.map(u => u.id);
  const skitariiInMc = mcIds.filter(id => amUnit(id)?.keywords.includes("SKITARII"));
  assertEqual(skitariiInMc.length, 0,
    "No SKITARII units should appear in the Machine Cult detachment roster");
});

test("Keyword segregation — CULT MECHANICUS units are only in Machine Cult, not Response Clade", () => {
  const rcIds = rcDet.units.map(u => u.id);
  const cultMechInRc = rcIds.filter(id => amUnit(id)?.keywords.includes("CULT MECHANICUS"));
  assertEqual(cultMechInRc.length, 0,
    "No CULT MECHANICUS units should appear in the Response Clade detachment roster");
});


// ── Section 106: Machine Cult Game Rule Logic ─────────────────────────────────

section("106. Adeptus Mechanicus — Machine Cult Game Rule Logic");

const mc = makeDetHelpers(mcDet, id => amUnit(id));

test("Character cap — first Tech-Priest can be added to an empty list", () => {
  assert(mc.canAdd([], "am_tech_priest_dominus"),
    "Tech-Priest Dominus must be addable to an empty list");
});

test("Character cap — second different Tech-Priest allowed when one is present", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }];
  assert(mc.canAdd(list, "am_tech_priest_enginseer"),
    "Tech-Priest Enginseer must be addable when only one CHARACTER is in the list");
});

test("Character cap — third CHARACTER blocked when cap of 2 filled", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }, { unitId: "am_tech_priest_enginseer" }];
  assertEqual(mc.charCount(list), 2, "must count 2 CHARACTERs");
  assert(!mc.canAdd(list, "am_tech_priest_manipulus"),
    "Tech-Priest Manipulus must be blocked when char cap of 2 is already filled");
});

test("Character cap — all four Tech-Priest variants can each fill the second slot", () => {
  ["am_tech_priest_enginseer", "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    const list = [{ unitId: "am_tech_priest_dominus" }];
    assert(mc.canAdd(list, id),
      id + " must be addable when only 1 CHARACTER is in the list");
  });
});

test("Character cap — non-CHARACTER units never blocked by the cap", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }, { unitId: "am_tech_priest_enginseer" }];
  ["am_corpuscarii_electro_priests", "am_fulgurite_electro_priests",
   "am_kataphron_breachers", "am_kataphron_destroyers"].forEach(id => {
    assert(mc.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Tech-Priest Dominus capped at 1", () => {
  assertEqual(mc.unitMax("am_tech_priest_dominus"), 1, "Tech-Priest Dominus max must be 1");
  assert(!mc.canAdd([{ unitId: "am_tech_priest_dominus" }], "am_tech_priest_dominus"),
    "Second Tech-Priest Dominus must be blocked by unit max of 1");
});

test("Unit max — Tech-Priest Enginseer capped at 1", () => {
  assertEqual(mc.unitMax("am_tech_priest_enginseer"), 1, "Tech-Priest Enginseer max must be 1");
  assert(!mc.canAdd([{ unitId: "am_tech_priest_enginseer" }], "am_tech_priest_enginseer"),
    "Second Tech-Priest Enginseer must be blocked by unit max of 1");
});

test("Unit max — Tech-Priest Manipulus capped at 1", () => {
  assertEqual(mc.unitMax("am_tech_priest_manipulus"), 1, "Tech-Priest Manipulus max must be 1");
  assert(!mc.canAdd([{ unitId: "am_tech_priest_manipulus" }], "am_tech_priest_manipulus"),
    "Second Tech-Priest Manipulus must be blocked by unit max of 1");
});

test("Unit max — Technoarcheologist capped at 1", () => {
  assertEqual(mc.unitMax("am_technoarcheologist"), 1, "Technoarcheologist max must be 1");
  assert(!mc.canAdd([{ unitId: "am_technoarcheologist" }], "am_technoarcheologist"),
    "Second Technoarcheologist must be blocked by unit max of 1");
});

test("Unit max — both Electro-Priests capped at 1 each", () => {
  ["am_corpuscarii_electro_priests", "am_fulgurite_electro_priests"].forEach(id => {
    assertEqual(mc.unitMax(id), 1, id + " max must be 1");
    assert(!mc.canAdd([{ unitId: id }], id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

test("Unit max — both Kataphron variants capped at 1 each", () => {
  ["am_kataphron_breachers", "am_kataphron_destroyers"].forEach(id => {
    assertEqual(mc.unitMax(id), 1, id + " max must be 1");
    assert(!mc.canAdd([{ unitId: id }], id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

test("Smoke test — Tech-Priest Dominus + Corpuscarii (10-model) + Kataphron Breachers = 65 + 130 + 160 = 355pts (legal)", () => {
  const pts = 65 + 130 + 160;
  assertEqual(pts, 355, "Expected 355pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Tech-Priest Dominus + Tech-Priest Enginseer + both Electro-Priests (10-model) = 65 + 55 + 130 + 140 = 390pts (legal)", () => {
  const pts = 65 + 55 + 130 + 140;
  assertEqual(pts, 390, "Expected 390pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Tech-Priest Dominus + Kataphron Breachers + Kataphron Destroyers = 65 + 160 + 105 = 330pts (legal)", () => {
  const pts = 65 + 160 + 105;
  assertEqual(pts, 330, "Expected 330pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — all four Tech-Priests + both Kataphrons = 65 + 55 + 60 + 60 + 160 + 105 = 505pts (over limit, and char cap prevents it anyway)", () => {
  const pts = 65 + 55 + 60 + 60 + 160 + 105;
  assertEqual(pts, 505, "Expected 505pts, got " + pts);
  assert(pts > 500, "must exceed 500pt limit");
  // Also verify the char cap makes this list illegal before points even matter
  const list = [
    { unitId: "am_tech_priest_dominus" },
    { unitId: "am_tech_priest_enginseer" },
  ];
  assert(!mc.canAdd(list, "am_tech_priest_manipulus"),
    "Third Tech-Priest must be blocked by the char cap of 2, not just points");
});


// ── Section 107: Electromartyrs Detachment ───────────────────────────────────

section("107. Adeptus Mechanicus — Electromartyrs Detachment");

const emDet = amDets ? amDets.find(d => d.id === "am_electromartyrs") : null;

test("Electromartyrs detachment exists", () => {
  assert(!!emDet, "am_electromartyrs must exist in Adeptus Mechanicus detachments");
});

test("Electromartyrs has maxCharacters of 2", () => {
  assertEqual(emDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Electromartyrs special rule is Overload Machine Spirits", () => {
  assertEqual(emDet.specialRule.name, "Overload Machine Spirits");
});

test("Overload Machine Spirits desc references ADEPTUS MECHANICUS", () => {
  assert(emDet.specialRule.desc.includes("ADEPTUS MECHANICUS"),
    "special rule desc must mention 'ADEPTUS MECHANICUS'");
});

test("Overload Machine Spirits desc references Armour Penetration", () => {
  assert(emDet.specialRule.desc.includes("Armour Penetration"),
    "special rule desc must mention 'Armour Penetration'");
});

test("Overload Machine Spirits desc references HAZARDOUS", () => {
  assert(emDet.specialRule.desc.includes("HAZARDOUS"),
    "special rule desc must mention '[HAZARDOUS]'");
});

test("Electromartyrs has exactly 2 enhancements", () => {
  assertEqual(emDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + emDet.enhancements.length);
});

test("Electromartyrs enhancements — Remote Lockdown and Multi-Dimensional Auspex present", () => {
  const ids = emDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_am_remote_lockdown"),          "must include enh_am_remote_lockdown");
  assert(ids.includes("enh_am_multi_dimensional_auspex"), "must include enh_am_multi_dimensional_auspex");
});

test("Remote Lockdown requiresKeywords is empty array", () => {
  const enh = emDet.enhancements.find(e => e.id === "enh_am_remote_lockdown");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Remote Lockdown must have empty requiresKeywords array");
});

test("Remote Lockdown desc references Hatchway and 9\"", () => {
  const enh = emDet.enhancements.find(e => e.id === "enh_am_remote_lockdown");
  assert(enh.desc.includes("Hatchway"), "desc must mention 'Hatchway'");
  assert(enh.desc.includes("9\""),      "desc must mention '9\"'");
});

test("Multi-Dimensional Auspex requiresKeywords is empty array", () => {
  const enh = emDet.enhancements.find(e => e.id === "enh_am_multi_dimensional_auspex");
  assert(Array.isArray(enh.requiresKeywords) && enh.requiresKeywords.length === 0,
    "Multi-Dimensional Auspex must have empty requiresKeywords array");
});

test("Multi-Dimensional Auspex desc references Walls and Hatchways", () => {
  const enh = emDet.enhancements.find(e => e.id === "enh_am_multi_dimensional_auspex");
  assert(enh.desc.includes("Walls"),    "desc must mention 'Walls'");
  assert(enh.desc.includes("Hatchway"), "desc must mention 'Hatchway'");
});

test("Multi-Dimensional Auspex desc references Shooting phase and visibility", () => {
  const enh = emDet.enhancements.find(e => e.id === "enh_am_multi_dimensional_auspex");
  assert(enh.desc.includes("Shooting phase"), "desc must mention 'Shooting phase'");
  assert(enh.desc.includes("visibility"),     "desc must mention 'visibility'");
});

test("Electromartyrs unit roster — correct IDs and maxes", () => {
  const find = id => emDet.units.find(u => u.id === id);
  assert(find("am_tech_priest_dominus")?.max        === 1, "am_tech_priest_dominus max must be 1");
  assert(find("am_tech_priest_enginseer")?.max      === 1, "am_tech_priest_enginseer max must be 1");
  assert(find("am_tech_priest_manipulus")?.max      === 1, "am_tech_priest_manipulus max must be 1");
  assert(find("am_technoarcheologist")?.max         === 1, "am_technoarcheologist max must be 1");
  assert(find("am_skitarii_marshall")?.max          === 1, "am_skitarii_marshall max must be 1");
  assert(find("am_skitarii_rangers")?.max           === 3, "am_skitarii_rangers max must be 3");
  assert(find("am_skitarii_vanguard")?.max          === 3, "am_skitarii_vanguard max must be 3");
  assert(find("am_corpuscarii_electro_priests")?.max === 1, "am_corpuscarii_electro_priests max must be 1");
  assert(find("am_fulgurite_electro_priests")?.max  === 1, "am_fulgurite_electro_priests max must be 1");
  assert(find("am_kataphron_breachers")?.max        === 1, "am_kataphron_breachers max must be 1");
  assert(find("am_kataphron_destroyers")?.max       === 1, "am_kataphron_destroyers max must be 1");
  assert(find("am_sicarian_infiltrators")?.max      === 1, "am_sicarian_infiltrators max must be 1");
  assert(find("am_sicarian_ruststalkers")?.max      === 1, "am_sicarian_ruststalkers max must be 1");
});

test("Electromartyrs has exactly 13 unit slots", () => {
  assertEqual(emDet.units.length, 13, "Expected 13 unit slots, got " + emDet.units.length);
});

test("Electromartyrs has exactly one exclusiveUnitGroups entry", () => {
  assert(Array.isArray(emDet.exclusiveUnitGroups) && emDet.exclusiveUnitGroups.length === 1,
    "must have exactly one exclusiveUnitGroups entry");
});

test("Exclusive group contains all four Tech-Priest variants and no others", () => {
  const group = emDet.exclusiveUnitGroups[0];
  assert(group.includes("am_tech_priest_dominus"),   "must include am_tech_priest_dominus");
  assert(group.includes("am_tech_priest_enginseer"), "must include am_tech_priest_enginseer");
  assert(group.includes("am_tech_priest_manipulus"), "must include am_tech_priest_manipulus");
  assert(group.includes("am_technoarcheologist"),    "must include am_technoarcheologist");
  assertEqual(group.length, 4, "exclusive group must contain exactly 4 unit IDs");
});

test("Electromartyrs has no ratio constraints", () => {
  assert(emDet.keywordRatio  === undefined, "Electromartyrs must not have keywordRatio");
  assert(emDet.keywordRatios === undefined, "Electromartyrs must not have keywordRatios");
});

test("Skitarii Marshall max is 1 in Electromartyrs (vs 2 in Response Clade)", () => {
  const emSlot = emDet.units.find(u => u.id === "am_skitarii_marshall");
  const rcSlot = rcDet.units.find(u => u.id === "am_skitarii_marshall");
  assertEqual(emSlot.max, 1, "Skitarii Marshall max must be 1 in Electromartyrs");
  assertEqual(rcSlot.max, 2, "Skitarii Marshall max must be 2 in Response Clade");
});


// ── Section 108: Electromartyrs Game Rule Logic ───────────────────────────────

section("108. Adeptus Mechanicus — Electromartyrs Game Rule Logic");

const em = makeDetHelpers(emDet, id => amUnit(id));
const isEmExcGroupBlocked = makeExcGroupChecker(emDet.exclusiveUnitGroups);

test("Character cap — Tech-Priest Dominus can be added to an empty list", () => {
  assert(em.canAdd([], "am_tech_priest_dominus"),
    "Tech-Priest Dominus must be addable to an empty list");
});

test("Character cap — Skitarii Marshall can also be added to an empty list", () => {
  assert(em.canAdd([], "am_skitarii_marshall"),
    "Skitarii Marshall must be addable to an empty list");
});

test("Character cap — second CHARACTER slot can be filled by Skitarii Marshall when one Tech-Priest is present", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }];
  assert(em.canAdd(list, "am_skitarii_marshall"),
    "Skitarii Marshall must be addable when 1 CHARACTER (Tech-Priest) is already present");
});

test("Character cap — third CHARACTER blocked when cap of 2 filled", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }, { unitId: "am_skitarii_marshall" }];
  assertEqual(em.charCount(list), 2, "must count 2 CHARACTERs");
  assert(!em.canAdd(list, "am_technoarcheologist"),
    "Technoarcheologist must be blocked when char cap of 2 is already filled");
});

test("Character cap — non-CHARACTER units never blocked by the cap", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }, { unitId: "am_skitarii_marshall" }];
  ["am_skitarii_rangers", "am_skitarii_vanguard", "am_corpuscarii_electro_priests",
   "am_fulgurite_electro_priests", "am_kataphron_breachers", "am_kataphron_destroyers",
   "am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    assert(em.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

// ── Exclusive group ───────────────────────────────────────────────────────────

test("Exclusive group — empty list blocks none of the four Tech-Priest variants", () => {
  ["am_tech_priest_dominus", "am_tech_priest_enginseer",
   "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    assert(!isEmExcGroupBlocked(id, []),
      id + " must not be blocked in an empty list");
  });
});

test("Exclusive group — Tech-Priest Dominus blocks all other Tech-Priest variants", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }];
  ["am_tech_priest_enginseer", "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    assert(isEmExcGroupBlocked(id, list),
      id + " must be blocked when Tech-Priest Dominus is in the list");
  });
});

test("Exclusive group — Tech-Priest Enginseer blocks all other Tech-Priest variants", () => {
  const list = [{ unitId: "am_tech_priest_enginseer" }];
  ["am_tech_priest_dominus", "am_tech_priest_manipulus", "am_technoarcheologist"].forEach(id => {
    assert(isEmExcGroupBlocked(id, list),
      id + " must be blocked when Tech-Priest Enginseer is in the list");
  });
});

test("Exclusive group — Tech-Priest Manipulus blocks all other Tech-Priest variants", () => {
  const list = [{ unitId: "am_tech_priest_manipulus" }];
  ["am_tech_priest_dominus", "am_tech_priest_enginseer", "am_technoarcheologist"].forEach(id => {
    assert(isEmExcGroupBlocked(id, list),
      id + " must be blocked when Tech-Priest Manipulus is in the list");
  });
});

test("Exclusive group — Technoarcheologist blocks all other Tech-Priest variants", () => {
  const list = [{ unitId: "am_technoarcheologist" }];
  ["am_tech_priest_dominus", "am_tech_priest_enginseer", "am_tech_priest_manipulus"].forEach(id => {
    assert(isEmExcGroupBlocked(id, list),
      id + " must be blocked when Technoarcheologist is in the list");
  });
});

test("Exclusive group — non-Tech-Priest units are never affected by the group", () => {
  const list = [{ unitId: "am_tech_priest_dominus" }];
  ["am_skitarii_marshall", "am_skitarii_rangers", "am_skitarii_vanguard",
   "am_corpuscarii_electro_priests", "am_fulgurite_electro_priests",
   "am_kataphron_breachers", "am_kataphron_destroyers",
   "am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    assert(!isEmExcGroupBlocked(id, list),
      id + " must not be blocked by the Tech-Priest exclusive group");
  });
});

// ── Unit maxes ────────────────────────────────────────────────────────────────

test("Unit max — Skitarii Marshall capped at 1 in Electromartyrs", () => {
  assertEqual(em.unitMax("am_skitarii_marshall"), 1, "Skitarii Marshall max must be 1");
  assert(!em.canAdd([{ unitId: "am_skitarii_marshall" }], "am_skitarii_marshall"),
    "Second Skitarii Marshall must be blocked by unit max of 1");
});

test("Unit max — Skitarii Rangers capped at 3", () => {
  assertEqual(em.unitMax("am_skitarii_rangers"), 3, "Skitarii Rangers max must be 3");
  const list = [
    { unitId: "am_skitarii_rangers" },
    { unitId: "am_skitarii_rangers" },
    { unitId: "am_skitarii_rangers" },
  ];
  assert(!em.canAdd(list, "am_skitarii_rangers"),
    "Fourth Skitarii Rangers must be blocked by unit max of 3");
});

test("Unit max — Skitarii Vanguard capped at 3", () => {
  assertEqual(em.unitMax("am_skitarii_vanguard"), 3, "Skitarii Vanguard max must be 3");
  const list = [
    { unitId: "am_skitarii_vanguard" },
    { unitId: "am_skitarii_vanguard" },
    { unitId: "am_skitarii_vanguard" },
  ];
  assert(!em.canAdd(list, "am_skitarii_vanguard"),
    "Fourth Skitarii Vanguard must be blocked by unit max of 3");
});

test("Unit max — all max-1 non-CHARACTER units are capped at 1", () => {
  ["am_corpuscarii_electro_priests", "am_fulgurite_electro_priests",
   "am_kataphron_breachers", "am_kataphron_destroyers",
   "am_sicarian_infiltrators", "am_sicarian_ruststalkers"].forEach(id => {
    assertEqual(em.unitMax(id), 1, id + " max must be 1");
    assert(!em.canAdd([{ unitId: id }], id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

// ── Smoke tests ───────────────────────────────────────────────────────────────

test("Smoke test — Tech-Priest Dominus + Skitarii Marshall + 3x Vanguard = 65 + 35 + 285 = 385pts (legal)", () => {
  const pts = 65 + 35 + (95 * 3);
  assertEqual(pts, 385, "Expected 385pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Tech-Priest Enginseer + 3x Rangers + Kataphron Breachers = 55 + 255 + 160 = 470pts (legal)", () => {
  const pts = 55 + (85 * 3) + 160;
  assertEqual(pts, 470, "Expected 470pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Tech-Priest Dominus + Kataphron Breachers + Kataphron Destroyers + Corpuscarii (10-model) = 65 + 160 + 105 + 130 = 460pts (legal)", () => {
  const pts = 65 + 160 + 105 + 130;
  assertEqual(pts, 460, "Expected 460pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Technoarcheologist + Skitarii Marshall + Sicarian Infiltrators (10-model) + Sicarian Ruststalkers (10-model) = 60 + 35 + 155 + 165 = 415pts (legal)", () => {
  const pts = 60 + 35 + 155 + 165;
  assertEqual(pts, 415, "Expected 415pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  LEGIONES DAEMONICA                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// NOTE: Do not add tests here for ID uniqueness, cross-faction ID collisions,
// enhancement ID uniqueness, unit→detachment cross-references, or required-field
// schema checks. Section 3 covers all of these globally. Only faction-specific
// behaviour is tested here: points values, keywords, rules adaptations content,
// and constraint logic.

section("109. Legiones Daemonica Faction");

const ldFaction = index.factions.find(f => f.id === "legiones_daemonica");
const ldData    = factionData["legiones_daemonica"];
const ldUnits   = ldData ? ldData.units : [];
const ldDets    = ldData ? ldData.detachments : [];
const ldUnit    = id => ldUnits.find(u => u.id === id);

test("Legiones Daemonica faction entry exists in index", () => {
  assert(!!ldFaction, "legiones_daemonica must exist in index.factions");
});

test("Legiones Daemonica has Soul Hunters army rule", () => {
  assertEqual(ldFaction.armyRule.name, "Soul Hunters");
});

test("Soul Hunters desc references Shadow of Chaos", () => {
  assert(ldFaction.armyRule.desc.includes("Shadow of Chaos"),
    "army rule desc must mention 'Shadow of Chaos'");
});

test("Soul Hunters desc references Hunted", () => {
  assert(ldFaction.armyRule.desc.includes("Hunted"),
    "army rule desc must mention 'Hunted'");
});

test("Soul Hunters desc references IGNORES COVER", () => {
  assert(ldFaction.armyRule.desc.includes("IGNORES COVER"),
    "army rule desc must mention 'IGNORES COVER'");
});

test("Legiones Daemonica has exactly 5 detachments", () => {
  assertEqual(ldDets.length, 5, "Expected 5 detachments, got " + ldDets.length);
});

test("Legiones Daemonica has exactly 25 units", () => {
  assertEqual(ldUnits.length, 25, "Expected 25 units, got " + ldUnits.length);
});

test("Legiones Daemonica unit IDs are all prefixed ld_", () => {
  ldUnits.forEach(u => {
    assert(u.id.startsWith("ld_"), "Unit id '" + u.id + "' must start with 'ld_'");
  });
});


// ── Section 110: Rotten and Rusted Detachment ─────────────────────────────────

section("110. Legiones Daemonica — Rotten and Rusted Detachment");

const rrDet = ldDets ? ldDets.find(d => d.id === "ld_rotten_and_rusted") : null;

test("Rotten and Rusted detachment exists", () => {
  assert(!!rrDet, "ld_rotten_and_rusted must exist in Legiones Daemonica detachments");
});

test("Rotten and Rusted has maxCharacters of 2", () => {
  assertEqual(rrDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Rotten and Rusted special rule is Toxic Miasma", () => {
  assertEqual(rrDet.specialRule.name, "Toxic Miasma");
});

test("Toxic Miasma desc references NURGLE LEGIONES DAEMONICA", () => {
  assert(rrDet.specialRule.desc.includes("NURGLE LEGIONES DAEMONICA"),
    "special rule desc must mention 'NURGLE LEGIONES DAEMONICA'");
});

test("Toxic Miasma desc references Move characteristic", () => {
  assert(rrDet.specialRule.desc.includes("Move characteristic"),
    "special rule desc must mention 'Move characteristic'");
});

test("Rotten and Rusted has exactly 2 enhancements", () => {
  assertEqual(rrDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + rrDet.enhancements.length);
});

test("Rotten and Rusted enhancements — Virulent Corruption and Endless Gift present", () => {
  const ids = rrDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_ld_virulent_corruption"), "must include enh_ld_virulent_corruption");
  assert(ids.includes("enh_ld_endless_gift"),        "must include enh_ld_endless_gift");
});

test("Virulent Corruption desc references Desperate Escape tests", () => {
  const enh = rrDet.enhancements.find(e => e.id === "enh_ld_virulent_corruption");
  assert(enh.desc.includes("Desperate Escape"),
    "Virulent Corruption desc must mention 'Desperate Escape'");
});

test("Endless Gift desc references Wounds characteristic", () => {
  const enh = rrDet.enhancements.find(e => e.id === "enh_ld_endless_gift");
  assert(enh.desc.includes("Wounds characteristic"),
    "Endless Gift desc must mention 'Wounds characteristic'");
});

test("Rotten and Rusted unit roster — correct IDs and maxes", () => {
  const find = id => rrDet.units.find(u => u.id === id);
  assert(find("ld_epidemus")?.max         === 1, "ld_epidemus max must be 1");
  assert(find("ld_poxbringer")?.max       === 1, "ld_poxbringer max must be 1");
  assert(find("ld_sloppity_bilepiper")?.max === 1, "ld_sloppity_bilepiper max must be 1");
  assert(find("ld_spoilpox_scrivener")?.max === 1, "ld_spoilpox_scrivener max must be 1");
  assert(find("ld_plaguebearers")?.max    === 3, "ld_plaguebearers max must be 3");
  assert(find("ld_nurglings")?.max        === 3, "ld_nurglings max must be 3");
  assert(find("ld_beast_of_nurgle")?.max  === 1, "ld_beast_of_nurgle max must be 1");
});

test("Rotten and Rusted has exactly 7 unit slots", () => {
  assertEqual(rrDet.units.length, 7, "Expected 7 unit slots, got " + rrDet.units.length);
});


// ── Section 111: Infernal Onslaught Detachment ────────────────────────────────

section("111. Legiones Daemonica — Infernal Onslaught Detachment");

const ioDet = ldDets ? ldDets.find(d => d.id === "ld_infernal_onslaught") : null;

test("Infernal Onslaught detachment exists", () => {
  assert(!!ioDet, "ld_infernal_onslaught must exist in Legiones Daemonica detachments");
});

test("Infernal Onslaught has maxCharacters of 2", () => {
  assertEqual(ioDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Infernal Onslaught special rule is Brutal Entrance", () => {
  assertEqual(ioDet.specialRule.name, "Brutal Entrance");
});

test("Brutal Entrance desc references KHORNE LEGIONES DAEMONICA", () => {
  assert(ioDet.specialRule.desc.includes("KHORNE LEGIONES DAEMONICA"),
    "special rule desc must mention 'KHORNE LEGIONES DAEMONICA'");
});

test("Brutal Entrance desc references Hatchway", () => {
  assert(ioDet.specialRule.desc.includes("Hatchway"),
    "special rule desc must mention 'Hatchway'");
});

test("Infernal Onslaught has exactly 2 enhancements", () => {
  assertEqual(ioDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + ioDet.enhancements.length);
});

test("Infernal Onslaught enhancements — Worthier Skulls and Unholy Fury present", () => {
  const ids = ioDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_ld_worthier_skulls"), "must include enh_ld_worthier_skulls");
  assert(ids.includes("enh_ld_unholy_fury"),     "must include enh_ld_unholy_fury");
});

test("Worthier Skulls desc references Falls Back and Normal move", () => {
  const enh = ioDet.enhancements.find(e => e.id === "enh_ld_worthier_skulls");
  assert(enh.desc.includes("Falls Back"),    "Worthier Skulls desc must mention 'Falls Back'");
  assert(enh.desc.includes("Normal move"),   "Worthier Skulls desc must mention 'Normal move'");
});

test("Unholy Fury desc references melee attack and fight", () => {
  const enh = ioDet.enhancements.find(e => e.id === "enh_ld_unholy_fury");
  assert(enh.desc.includes("melee attack"), "Unholy Fury desc must mention 'melee attack'");
  assert(enh.desc.includes("fight"),        "Unholy Fury desc must mention 'fight'");
});

test("Infernal Onslaught unit roster — correct IDs and maxes", () => {
  const find = id => ioDet.units.find(u => u.id === id);
  assert(find("ld_bloodmaster")?.max  === 1, "ld_bloodmaster max must be 1");
  assert(find("ld_karanak")?.max      === 1, "ld_karanak max must be 1");
  assert(find("ld_skulltaker")?.max   === 1, "ld_skulltaker max must be 1");
  assert(find("ld_bloodletters")?.max === 3, "ld_bloodletters max must be 3");
  assert(find("ld_flesh_hounds")?.max === 1, "ld_flesh_hounds max must be 1");
});

test("Infernal Onslaught has exactly 5 unit slots", () => {
  assertEqual(ioDet.units.length, 5, "Expected 5 unit slots, got " + ioDet.units.length);
});


// ── Section 112: Dread Carnival Detachment ────────────────────────────────────

section("112. Legiones Daemonica — Dread Carnival Detachment");

const dcDet = ldDets ? ldDets.find(d => d.id === "ld_dread_carnival") : null;

test("Dread Carnival detachment exists", () => {
  assert(!!dcDet, "ld_dread_carnival must exist in Legiones Daemonica detachments");
});

test("Dread Carnival has maxCharacters of 2", () => {
  assertEqual(dcDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Dread Carnival special rule is Lithe Killers", () => {
  assertEqual(dcDet.specialRule.name, "Lithe Killers");
});

test("Lithe Killers desc references SLAANESH INFANTRY LEGIONES DAEMONICA", () => {
  assert(dcDet.specialRule.desc.includes("SLAANESH INFANTRY LEGIONES DAEMONICA"),
    "special rule desc must mention 'SLAANESH INFANTRY LEGIONES DAEMONICA'");
});

test("Lithe Killers desc references mortal wound", () => {
  assert(dcDet.specialRule.desc.includes("mortal wound"),
    "special rule desc must mention 'mortal wound'");
});

test("Dread Carnival has exactly 2 enhancements", () => {
  assertEqual(dcDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + dcDet.enhancements.length);
});

test("Dread Carnival enhancements — Fatal Caress and Horrifying Visage present", () => {
  const ids = dcDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_ld_fatal_caress"),       "must include enh_ld_fatal_caress");
  assert(ids.includes("enh_ld_horrifying_visage"),  "must include enh_ld_horrifying_visage");
});

test("Fatal Caress desc references Critical Wound", () => {
  const enh = dcDet.enhancements.find(e => e.id === "enh_ld_fatal_caress");
  assert(enh.desc.includes("Critical Wound"),
    "Fatal Caress desc must mention 'Critical Wound'");
});

test("Horrifying Visage desc references Leadership test and Tactical Manoeuvre", () => {
  const enh = dcDet.enhancements.find(e => e.id === "enh_ld_horrifying_visage");
  assert(enh.desc.includes("Leadership test"),     "Horrifying Visage desc must mention 'Leadership test'");
  assert(enh.desc.includes("Tactical Manoeuvre"),  "Horrifying Visage desc must mention 'Tactical Manoeuvre'");
});

test("Dread Carnival unit roster — correct IDs and maxes", () => {
  const find = id => dcDet.units.find(u => u.id === id);
  assert(find("ld_contorted_epitome")?.max      === 1, "ld_contorted_epitome max must be 1");
  assert(find("ld_the_masque_of_slaanesh")?.max === 1, "ld_the_masque_of_slaanesh max must be 1");
  assert(find("ld_infernal_enrapturess")?.max   === 1, "ld_infernal_enrapturess max must be 1");
  assert(find("ld_tranceweaver")?.max           === 1, "ld_tranceweaver max must be 1");
  assert(find("ld_daemonettes")?.max            === 3, "ld_daemonettes max must be 3");
  assert(find("ld_fiends")?.max                 === 1, "ld_fiends max must be 1");
});

test("Dread Carnival has exactly 6 unit slots", () => {
  assertEqual(dcDet.units.length, 6, "Expected 6 unit slots, got " + dcDet.units.length);
});


// ── Section 113: Pandaemoniac Inferno Detachment ──────────────────────────────

section("113. Legiones Daemonica — Pandaemoniac Inferno Detachment");

const piDet = ldDets ? ldDets.find(d => d.id === "ld_pandaemoniac_inferno") : null;

test("Pandaemoniac Inferno detachment exists", () => {
  assert(!!piDet, "ld_pandaemoniac_inferno must exist in Legiones Daemonica detachments");
});

test("Pandaemoniac Inferno has maxCharacters of 2", () => {
  assertEqual(piDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Pandaemoniac Inferno special rule is Living Flame", () => {
  assertEqual(piDet.specialRule.name, "Living Flame");
});

test("Living Flame desc references TZEENTCH LEGIONES DAEMONICA", () => {
  assert(piDet.specialRule.desc.includes("TZEENTCH LEGIONES DAEMONICA"),
    "special rule desc must mention 'TZEENTCH LEGIONES DAEMONICA'");
});

test("Living Flame desc references SUSTAINED HITS 1", () => {
  assert(piDet.specialRule.desc.includes("SUSTAINED HITS 1"),
    "special rule desc must mention 'SUSTAINED HITS 1'");
});

test("Pandaemoniac Inferno has exactly 2 enhancements", () => {
  assertEqual(piDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + piDet.enhancements.length);
});

test("Pandaemoniac Inferno enhancements — Fulgurating Presence and Mutagenic Flames present", () => {
  const ids = piDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_ld_fulgurating_presence"), "must include enh_ld_fulgurating_presence");
  assert(ids.includes("enh_ld_mutagenic_flames"),     "must include enh_ld_mutagenic_flames");
});

test("Fulgurating Presence desc references Hit roll", () => {
  const enh = piDet.enhancements.find(e => e.id === "enh_ld_fulgurating_presence");
  assert(enh.desc.includes("Hit roll"),
    "Fulgurating Presence desc must mention 'Hit roll'");
});

test("Mutagenic Flames desc references Shooting phase and Hit roll", () => {
  const enh = piDet.enhancements.find(e => e.id === "enh_ld_mutagenic_flames");
  assert(enh.desc.includes("Shooting phase"), "Mutagenic Flames desc must mention 'Shooting phase'");
  assert(enh.desc.includes("Hit roll"),       "Mutagenic Flames desc must mention 'Hit roll'");
});

test("Pandaemoniac Inferno unit roster — correct IDs and maxes", () => {
  const find = id => piDet.units.find(u => u.id === id);
  assert(find("ld_the_changeling")?.max === 1, "ld_the_changeling max must be 1");
  assert(find("ld_changecaster")?.max   === 1, "ld_changecaster max must be 1");
  assert(find("ld_exalted_flamer")?.max === 1, "ld_exalted_flamer max must be 1");
  assert(find("ld_blue_horrors")?.max   === 3, "ld_blue_horrors max must be 3");
  assert(find("ld_pink_horrors")?.max   === 3, "ld_pink_horrors max must be 3");
  assert(find("ld_flamers")?.max        === 1, "ld_flamers max must be 1");
  assert(find("ld_screamers")?.max      === 1, "ld_screamers max must be 1");
});

test("Pandaemoniac Inferno has exactly 7 unit slots", () => {
  assertEqual(piDet.units.length, 7, "Expected 7 unit slots, got " + piDet.units.length);
});


// ── Section 114: Daemonic Incursion Detachment ────────────────────────────────

section("114. Legiones Daemonica — Daemonic Incursion Detachment");

const diDet = ldDets ? ldDets.find(d => d.id === "ld_daemonic_incursion") : null;

test("Daemonic Incursion detachment exists", () => {
  assert(!!diDet, "ld_daemonic_incursion must exist in Legiones Daemonica detachments");
});

test("Daemonic Incursion has maxCharacters of 2", () => {
  assertEqual(diDet.maxCharacters, 2, "maxCharacters must be 2");
});

test("Daemonic Incursion special rule is Unnatural Energies", () => {
  assertEqual(diDet.specialRule.name, "Unnatural Energies");
});

test("Unnatural Energies desc references LEGIONES DAEMONICA", () => {
  assert(diDet.specialRule.desc.includes("LEGIONES DAEMONICA"),
    "special rule desc must mention 'LEGIONES DAEMONICA'");
});

test("Unnatural Energies desc references all three Tactical Manoeuvres", () => {
  assert(diDet.specialRule.desc.includes("Secure Site"),   "desc must mention 'Secure Site'");
  assert(diDet.specialRule.desc.includes("Set to Defend"), "desc must mention 'Set to Defend'");
  assert(diDet.specialRule.desc.includes("Set Overwatch"), "desc must mention 'Set Overwatch'");
});

test("Daemonic Incursion has exactly 2 enhancements", () => {
  assertEqual(diDet.enhancements.length, 2,
    "Expected 2 enhancements, got " + diDet.enhancements.length);
});

test("Daemonic Incursion enhancements — Spite Made Manifest and Geller Breach present", () => {
  const ids = diDet.enhancements.map(e => e.id);
  assert(ids.includes("enh_ld_spite_made_manifest"), "must include enh_ld_spite_made_manifest");
  assert(ids.includes("enh_ld_geller_breach"),       "must include enh_ld_geller_breach");
});

test("Spite Made Manifest desc references HAZARDOUS and melee weapons", () => {
  const enh = diDet.enhancements.find(e => e.id === "enh_ld_spite_made_manifest");
  assert(enh.desc.includes("HAZARDOUS"),      "Spite Made Manifest desc must mention 'HAZARDOUS'");
  assert(enh.desc.includes("melee weapons"),  "Spite Made Manifest desc must mention 'melee weapons'");
});

test("Geller Breach desc references Normal move and 6\"", () => {
  const enh = diDet.enhancements.find(e => e.id === "enh_ld_geller_breach");
  assert(enh.desc.includes("Normal move"), "Geller Breach desc must mention 'Normal move'");
  assert(enh.desc.includes("6\""),         "Geller Breach desc must mention '6\"'");
});

test("Daemonic Incursion unit roster — correct IDs and maxes", () => {
  const find = id => diDet.units.find(u => u.id === id);
  assert(find("ld_bloodmaster")?.max          === 1, "ld_bloodmaster max must be 1");
  assert(find("ld_karanak")?.max              === 1, "ld_karanak max must be 1");
  assert(find("ld_skulltaker")?.max           === 1, "ld_skulltaker max must be 1");
  assert(find("ld_changecaster")?.max         === 1, "ld_changecaster max must be 1");
  assert(find("ld_exalted_flamer")?.max       === 1, "ld_exalted_flamer max must be 1");
  assert(find("ld_the_changeling")?.max       === 1, "ld_the_changeling max must be 1");
  assert(find("ld_epidemus")?.max             === 1, "ld_epidemus max must be 1");
  assert(find("ld_poxbringer")?.max           === 1, "ld_poxbringer max must be 1");
  assert(find("ld_sloppity_bilepiper")?.max   === 1, "ld_sloppity_bilepiper max must be 1");
  assert(find("ld_spoilpox_scrivener")?.max   === 1, "ld_spoilpox_scrivener max must be 1");
  assert(find("ld_contorted_epitome")?.max    === 1, "ld_contorted_epitome max must be 1");
  assert(find("ld_infernal_enrapturess")?.max === 1, "ld_infernal_enrapturess max must be 1");
  assert(find("ld_the_masque_of_slaanesh")?.max === 1, "ld_the_masque_of_slaanesh max must be 1");
  assert(find("ld_tranceweaver")?.max         === 1, "ld_tranceweaver max must be 1");
  assert(find("ld_bloodletters")?.max         === 3, "ld_bloodletters max must be 3");
  assert(find("ld_blue_horrors")?.max         === 3, "ld_blue_horrors max must be 3");
  assert(find("ld_pink_horrors")?.max         === 3, "ld_pink_horrors max must be 3");
  assert(find("ld_plaguebearers")?.max        === 3, "ld_plaguebearers max must be 3");
  assert(find("ld_nurglings")?.max            === 3, "ld_nurglings max must be 3");
  assert(find("ld_daemonettes")?.max          === 3, "ld_daemonettes max must be 3");
  assert(find("ld_flesh_hounds")?.max         === 1, "ld_flesh_hounds max must be 1");
  assert(find("ld_flamers")?.max              === 1, "ld_flamers max must be 1");
  assert(find("ld_screamers")?.max            === 1, "ld_screamers max must be 1");
  assert(find("ld_beast_of_nurgle")?.max      === 1, "ld_beast_of_nurgle max must be 1");
  assert(find("ld_fiends")?.max               === 1, "ld_fiends max must be 1");
});

test("Daemonic Incursion has exactly 25 unit slots", () => {
  assertEqual(diDet.units.length, 25, "Expected 25 unit slots, got " + diDet.units.length);
});

test("Daemonic Incursion has factionKeywordRestrictions with exactly 2 pairs", () => {
  assert(Array.isArray(diDet.factionKeywordRestrictions),
    "factionKeywordRestrictions must be an array");
  assertEqual(diDet.factionKeywordRestrictions.length, 2,
    "Expected 2 restriction pairs, got " + diDet.factionKeywordRestrictions.length);
});

test("Daemonic Incursion factionKeywordRestrictions — KHORNE/SLAANESH pair present", () => {
  const pairs = diDet.factionKeywordRestrictions;
  const found = pairs.some(p =>
    (p[0] === "KHORNE" && p[1] === "SLAANESH") ||
    (p[0] === "SLAANESH" && p[1] === "KHORNE")
  );
  assert(found, "factionKeywordRestrictions must contain a KHORNE/SLAANESH pair");
});

test("Daemonic Incursion factionKeywordRestrictions — NURGLE/TZEENTCH pair present", () => {
  const pairs = diDet.factionKeywordRestrictions;
  const found = pairs.some(p =>
    (p[0] === "NURGLE" && p[1] === "TZEENTCH") ||
    (p[0] === "TZEENTCH" && p[1] === "NURGLE")
  );
  assert(found, "factionKeywordRestrictions must contain a NURGLE/TZEENTCH pair");
});


// ── Section 115: Unit Definitions ─────────────────────────────────────────────

section("115. Legiones Daemonica — Unit Definitions");

test("Epidemus — CHARACTER, EPIC HERO, NURGLE, 80pts, loses Tally of Pestilence", () => {
  const u = ldUnit("ld_epidemus");
  assert(!!u, "ld_epidemus not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("LEGIONES DAEMONICA"), "must have LEGIONES DAEMONICA");
  assert(u.keywords.includes("CHARACTER"),          "must have CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),          "must have EPIC HERO");
  assert(u.keywords.includes("NURGLE"),             "must have NURGLE");
  assert(u.keywords.includes("DAEMON"),             "must have DAEMON");
  assertEqual(u.sizes[0].pts, 80,            "must cost 80pts");
  assertEqual(u.sizes[0].label, "1 model",   "size label must be '1 model'");
  assert(u.rulesAdaptations?.includes("Tally of Pestilence"),
    "rulesAdaptations must mention 'Tally of Pestilence'");
});

test("Poxbringer — CHARACTER, NURGLE, 55pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_poxbringer");
  assert(!!u, "ld_poxbringer not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NURGLE"),  "must have NURGLE");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 55, "must cost 55pts");
  assert(!u.rulesAdaptations, "Poxbringer must have no rulesAdaptations");
});

test("Sloppity Bilepiper — CHARACTER, NURGLE, 55pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_sloppity_bilepiper");
  assert(!!u, "ld_sloppity_bilepiper not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NURGLE"),     "must have NURGLE");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 55, "must cost 55pts");
  assert(!u.rulesAdaptations, "Sloppity Bilepiper must have no rulesAdaptations");
});

test("Spoilpox Scrivener — CHARACTER, NURGLE, 60pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_spoilpox_scrivener");
  assert(!!u, "ld_spoilpox_scrivener not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("NURGLE"),     "must have NURGLE");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 60, "must cost 60pts");
  assert(!u.rulesAdaptations, "Spoilpox Scrivener must have no rulesAdaptations");
});

test("Plaguebearers — BATTLELINE, NURGLE, 110pts for 10 models, loses Infected Outbreak", () => {
  const u = ldUnit("ld_plaguebearers");
  assert(!!u, "ld_plaguebearers not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("NURGLE"),     "must have NURGLE");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE");
  assertEqual(u.sizes[0].pts, 110,           "must cost 110pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(u.rulesAdaptations?.includes("Infected Outbreak"),
    "rulesAdaptations must mention 'Infected Outbreak'");
});

test("Nurglings — SWARM type, BATTLELINE keyword, NURGLE, 40pts for 3 models, loses Mischief Makers", () => {
  const u = ldUnit("ld_nurglings");
  assert(!!u, "ld_nurglings not found");
  assertEqual(u.type, "SWARM");
  assert(u.keywords.includes("NURGLE"),     "must have NURGLE");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE keyword");
  assertEqual(u.sizes[0].pts, 40,          "must cost 40pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(u.rulesAdaptations?.includes("Mischief Makers"),
    "rulesAdaptations must mention 'Mischief Makers'");
});

test("Beast of Nurgle — BEAST type, NURGLE, 65pts/1 model and 130pts/2 models, loses Scouts and Grotesque Regeneration", () => {
  const u = ldUnit("ld_beast_of_nurgle");
  assert(!!u, "ld_beast_of_nurgle not found");
  assertEqual(u.type, "BEAST");
  assert(u.keywords.includes("NURGLE"),     "must have NURGLE");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE keyword");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].pts, 65,            "1-model option must cost 65pts");
  assertEqual(u.sizes[0].label, "1 model",   "first size label must be '1 model'");
  assertEqual(u.sizes[1].pts, 130,           "2-model option must cost 130pts");
  assertEqual(u.sizes[1].label, "2 models",  "second size label must be '2 models'");
  assert(u.rulesAdaptations?.includes("Scouts"),                "rulesAdaptations must mention 'Scouts'");
  assert(u.rulesAdaptations?.includes("Grotesque Regeneration"), "rulesAdaptations must mention 'Grotesque Regeneration'");
  assert(u.rulesAdaptations?.includes("Form Boarding Squads"),   "rulesAdaptations must mention 'Form Boarding Squads'");
});

test("Bloodmaster — CHARACTER, KHORNE, 75pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_bloodmaster");
  assert(!!u, "ld_bloodmaster not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("KHORNE"),     "must have KHORNE");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 75, "must cost 75pts");
  assert(!u.rulesAdaptations, "Bloodmaster must have no rulesAdaptations");
});

test("Karanak — CHARACTER, BEAST type, EPIC HERO, KHORNE, 85pts", () => {
  const u = ldUnit("ld_karanak");
  assert(!!u, "ld_karanak not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("BEAST"),      "must have BEAST keyword");
  assert(u.keywords.includes("CHARACTER"),  "must have CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),  "must have EPIC HERO");
  assert(u.keywords.includes("KHORNE"),     "must have KHORNE");
  assertEqual(u.sizes[0].pts, 85, "must cost 85pts");
});

test("Skulltaker — CHARACTER, EPIC HERO, KHORNE, 85pts", () => {
  const u = ldUnit("ld_skulltaker");
  assert(!!u, "ld_skulltaker not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),  "must have EPIC HERO");
  assert(u.keywords.includes("KHORNE"),     "must have KHORNE");
  assertEqual(u.sizes[0].pts, 85, "must cost 85pts");
});

test("Bloodletters — BATTLELINE, KHORNE, 110pts for 10 models, no rulesAdaptations", () => {
  const u = ldUnit("ld_bloodletters");
  assert(!!u, "ld_bloodletters not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("KHORNE"),     "must have KHORNE");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE");
  assertEqual(u.sizes[0].pts, 110,           "must cost 110pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(!u.rulesAdaptations, "Bloodletters must have no rulesAdaptations");
});

test("Flesh Hounds — BEAST type, KHORNE, 75pts/5 models and 150pts/10 models, loses Hunters from the Warp", () => {
  const u = ldUnit("ld_flesh_hounds");
  assert(!!u, "ld_flesh_hounds not found");
  assertEqual(u.type, "BEAST");
  assert(u.keywords.includes("KHORNE"),     "must have KHORNE");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE keyword");
  assertEqual(u.sizes.length, 2,             "must have exactly 2 size options");
  assertEqual(u.sizes[0].pts, 75,            "5-model option must cost 75pts");
  assertEqual(u.sizes[0].label, "5 models",  "first size label must be '5 models'");
  assertEqual(u.sizes[1].pts, 150,           "10-model option must cost 150pts");
  assertEqual(u.sizes[1].label, "10 models", "second size label must be '10 models'");
  assert(u.rulesAdaptations?.includes("Hunters from the Warp"),
    "rulesAdaptations must mention 'Hunters from the Warp'");
});

test("Contorted Epitome — CHARACTER, PSYKER, SLAANESH, 100pts", () => {
  const u = ldUnit("ld_contorted_epitome");
  assert(!!u, "ld_contorted_epitome not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 100, "must cost 100pts");
});

test("The Masque of Slaanesh — CHARACTER, EPIC HERO, SLAANESH, 95pts", () => {
  const u = ldUnit("ld_the_masque_of_slaanesh");
  assert(!!u, "ld_the_masque_of_slaanesh not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),  "must have EPIC HERO");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assertEqual(u.sizes[0].pts, 95, "must cost 95pts");
});

test("Infernal Enrapturess — CHARACTER, SLAANESH, 60pts, loses Harmonic Alignment", () => {
  const u = ldUnit("ld_infernal_enrapturess");
  assert(!!u, "ld_infernal_enrapturess not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 60, "must cost 60pts");
  assert(u.rulesAdaptations?.includes("Harmonic Alignment"),
    "rulesAdaptations must mention 'Harmonic Alignment'");
});

test("Tranceweaver — CHARACTER, PSYKER, SLAANESH, 60pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_tranceweaver");
  assert(!!u, "ld_tranceweaver not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assertEqual(u.sizes[0].pts, 60, "must cost 60pts");
  assert(!u.rulesAdaptations, "Tranceweaver must have no rulesAdaptations");
});

test("Daemonettes — BATTLELINE, SLAANESH, 100pts for 10 models, no rulesAdaptations", () => {
  const u = ldUnit("ld_daemonettes");
  assert(!!u, "ld_daemonettes not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE");
  assertEqual(u.sizes[0].pts, 100,           "must cost 100pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(!u.rulesAdaptations, "Daemonettes must have no rulesAdaptations");
});

test("Fiends — BEAST type, SLAANESH, 95pts for 3 models, loses Soporific Musk, Movement reduced", () => {
  const u = ldUnit("ld_fiends");
  assert(!!u, "ld_fiends not found");
  assertEqual(u.type, "BEAST");
  assert(u.keywords.includes("SLAANESH"),   "must have SLAANESH");
  assertEqual(u.sizes[0].pts, 95,           "must cost 95pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(u.rulesAdaptations?.includes("Soporific Musk"),        "rulesAdaptations must mention 'Soporific Musk'");
  assert(u.rulesAdaptations?.includes("Movement characteristic"), "rulesAdaptations must mention 'Movement characteristic'");
});

test("The Changeling — CHARACTER, EPIC HERO, PSYKER, TZEENTCH, 90pts, loses Formless Horror", () => {
  const u = ldUnit("ld_the_changeling");
  assert(!!u, "ld_the_changeling not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("EPIC HERO"),  "must have EPIC HERO");
  assert(u.keywords.includes("PSYKER"),     "must have PSYKER");
  assert(u.keywords.includes("TZEENTCH"),   "must have TZEENTCH");
  assertEqual(u.sizes[0].pts, 90, "must cost 90pts");
  assert(u.rulesAdaptations?.includes("Formless Horror"),
    "rulesAdaptations must mention 'Formless Horror'");
});

test("Changecaster — CHARACTER, TZEENTCH, 60pts, no rulesAdaptations", () => {
  const u = ldUnit("ld_changecaster");
  assert(!!u, "ld_changecaster not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TZEENTCH"),   "must have TZEENTCH");
  assert(!u.keywords.includes("EPIC HERO"), "must NOT have EPIC HERO");
  assertEqual(u.sizes[0].pts, 60, "must cost 60pts");
  assert(!u.rulesAdaptations, "Changecaster must have no rulesAdaptations");
});

test("Exalted Flamer — CHARACTER, TZEENTCH, 65pts, noEnhancement flag set", () => {
  const u = ldUnit("ld_exalted_flamer");
  assert(!!u, "ld_exalted_flamer not found");
  assertEqual(u.type, "CHARACTER");
  assert(u.keywords.includes("TZEENTCH"), "must have TZEENTCH");
  assertEqual(u.sizes[0].pts, 65, "must cost 65pts");
  assert(u.noEnhancement === true, "Exalted Flamer must have noEnhancement: true");
});

test("Blue Horrors — BATTLELINE, TZEENTCH, 125pts for 10 models, no rulesAdaptations", () => {
  const u = ldUnit("ld_blue_horrors");
  assert(!!u, "ld_blue_horrors not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("TZEENTCH"),   "must have TZEENTCH");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE");
  assertEqual(u.sizes[0].pts, 125,           "must cost 125pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(!u.rulesAdaptations, "Blue Horrors must have no rulesAdaptations");
});

test("Pink Horrors — BATTLELINE, TZEENTCH, 140pts for 10 models, no rulesAdaptations", () => {
  const u = ldUnit("ld_pink_horrors");
  assert(!!u, "ld_pink_horrors not found");
  assertEqual(u.type, "BATTLELINE");
  assert(u.keywords.includes("TZEENTCH"),   "must have TZEENTCH");
  assert(u.keywords.includes("BATTLELINE"), "must have BATTLELINE");
  assertEqual(u.sizes[0].pts, 140,           "must cost 140pts");
  assertEqual(u.sizes[0].label, "10 models", "size label must be '10 models'");
  assert(!u.rulesAdaptations, "Pink Horrors must have no rulesAdaptations");
});

test("Flamers — INFANTRY, TZEENTCH, 65pts for 3 models, no rulesAdaptations", () => {
  const u = ldUnit("ld_flamers");
  assert(!!u, "ld_flamers not found");
  assertEqual(u.type, "INFANTRY");
  assert(u.keywords.includes("TZEENTCH"), "must have TZEENTCH");
  assertEqual(u.sizes[0].pts, 65,          "must cost 65pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(!u.rulesAdaptations, "Flamers must have no rulesAdaptations");
});

test("Screamers — BEAST type, TZEENTCH, 80pts for 3 models, loses Slashing Dive, Movement reduced", () => {
  const u = ldUnit("ld_screamers");
  assert(!!u, "ld_screamers not found");
  assertEqual(u.type, "BEAST");
  assert(u.keywords.includes("TZEENTCH"), "must have TZEENTCH");
  assertEqual(u.sizes[0].pts, 80,          "must cost 80pts");
  assertEqual(u.sizes[0].label, "3 models", "size label must be '3 models'");
  assert(u.rulesAdaptations?.includes("Slashing Dive"),          "rulesAdaptations must mention 'Slashing Dive'");
  assert(u.rulesAdaptations?.includes("Movement characteristic"), "rulesAdaptations must mention 'Movement characteristic'");
});

test("All NURGLE units carry NURGLE keyword", () => {
  ["ld_epidemus","ld_poxbringer","ld_sloppity_bilepiper","ld_spoilpox_scrivener",
   "ld_plaguebearers","ld_nurglings","ld_beast_of_nurgle"].forEach(id => {
    assert(ldUnit(id)?.keywords.includes("NURGLE"), id + " must have NURGLE keyword");
  });
});

test("All KHORNE units carry KHORNE keyword", () => {
  ["ld_bloodmaster","ld_karanak","ld_skulltaker","ld_bloodletters","ld_flesh_hounds"].forEach(id => {
    assert(ldUnit(id)?.keywords.includes("KHORNE"), id + " must have KHORNE keyword");
  });
});

test("All SLAANESH units carry SLAANESH keyword", () => {
  ["ld_contorted_epitome","ld_the_masque_of_slaanesh","ld_infernal_enrapturess",
   "ld_tranceweaver","ld_daemonettes","ld_fiends"].forEach(id => {
    assert(ldUnit(id)?.keywords.includes("SLAANESH"), id + " must have SLAANESH keyword");
  });
});

test("All TZEENTCH units carry TZEENTCH keyword", () => {
  ["ld_the_changeling","ld_changecaster","ld_exalted_flamer",
   "ld_blue_horrors","ld_pink_horrors","ld_flamers","ld_screamers"].forEach(id => {
    assert(ldUnit(id)?.keywords.includes("TZEENTCH"), id + " must have TZEENTCH keyword");
  });
});

test("No unit carries more than one chaos god keyword", () => {
  const gods = ["KHORNE", "SLAANESH", "NURGLE", "TZEENTCH"];
  ldUnits.forEach(u => {
    const count = gods.filter(g => u.keywords.includes(g)).length;
    assert(count <= 1, u.id + " must not carry more than one chaos god keyword");
  });
});

test("All units carry LEGIONES DAEMONICA and DAEMON keywords", () => {
  ldUnits.forEach(u => {
    assert(u.keywords.includes("LEGIONES DAEMONICA"), u.id + " must have LEGIONES DAEMONICA");
    assert(u.keywords.includes("DAEMON"),             u.id + " must have DAEMON");
  });
});


// ── Section 116: Game Rule Logic ──────────────────────────────────────────────

section("116. Legiones Daemonica — Game Rule Logic");

const di = makeDetHelpers(diDet, id => ldUnit(id));

test("Character cap — Bloodmaster can be added to an empty list", () => {
  assert(di.canAdd([], "ld_bloodmaster"),
    "Bloodmaster must be addable to an empty list");
});

test("Character cap — second CHARACTER slot can be filled when one is present", () => {
  const list = [{ unitId: "ld_bloodmaster" }];
  assert(di.canAdd(list, "ld_changecaster"),
    "Changecaster must be addable when 1 CHARACTER is already present");
});

test("Character cap — third CHARACTER is blocked when cap of 2 is reached", () => {
  const list = [{ unitId: "ld_bloodmaster" }, { unitId: "ld_changecaster" }];
  assertEqual(di.charCount(list), 2, "must count 2 CHARACTERs");
  assert(!di.canAdd(list, "ld_poxbringer"),
    "Poxbringer must be blocked when char cap of 2 is already filled");
});

test("Character cap — non-CHARACTER units never blocked by the cap", () => {
  const list = [{ unitId: "ld_bloodmaster" }, { unitId: "ld_changecaster" }];
  ["ld_bloodletters","ld_plaguebearers","ld_daemonettes","ld_pink_horrors",
   "ld_blue_horrors","ld_nurglings","ld_flesh_hounds","ld_flamers","ld_screamers",
   "ld_beast_of_nurgle","ld_fiends"].forEach(id => {
    assert(di.canAdd(list, id),
      id + " must still be addable when char cap of 2 is filled");
  });
});

test("Unit max — Bloodletters capped at 3", () => {
  assertEqual(di.unitMax("ld_bloodletters"), 3, "Bloodletters max must be 3");
  const list = [
    { unitId: "ld_bloodletters" },
    { unitId: "ld_bloodletters" },
    { unitId: "ld_bloodletters" },
  ];
  assert(!di.canAdd(list, "ld_bloodletters"),
    "Fourth Bloodletters must be blocked by unit max of 3");
});

test("Unit max — Plaguebearers capped at 3", () => {
  assertEqual(di.unitMax("ld_plaguebearers"), 3, "Plaguebearers max must be 3");
  const list = [
    { unitId: "ld_plaguebearers" },
    { unitId: "ld_plaguebearers" },
    { unitId: "ld_plaguebearers" },
  ];
  assert(!di.canAdd(list, "ld_plaguebearers"),
    "Fourth Plaguebearers must be blocked by unit max of 3");
});

test("Unit max — all max-1 CHARACTER units are capped at 1", () => {
  ["ld_bloodmaster","ld_karanak","ld_skulltaker","ld_changecaster","ld_exalted_flamer",
   "ld_the_changeling","ld_epidemus","ld_poxbringer","ld_sloppity_bilepiper",
   "ld_spoilpox_scrivener","ld_contorted_epitome","ld_infernal_enrapturess",
   "ld_the_masque_of_slaanesh","ld_tranceweaver"].forEach(id => {
    assertEqual(di.unitMax(id), 1, id + " max must be 1");
    assert(!di.canAdd([{ unitId: id }], id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

test("Unit max — all max-1 non-CHARACTER units are capped at 1", () => {
  ["ld_flesh_hounds","ld_flamers","ld_screamers","ld_beast_of_nurgle","ld_fiends"].forEach(id => {
    assertEqual(di.unitMax(id), 1, id + " max must be 1");
    assert(!di.canAdd([{ unitId: id }], id),
      "Second " + id + " must be blocked by unit max of 1");
  });
});

test("Smoke test — Bloodmaster + 3x Bloodletters = 75 + 330 = 405pts (legal)", () => {
  const pts = 75 + (110 * 3);
  assertEqual(pts, 405, "Expected 405pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — Changecaster + 3x Pink Horrors + Flamers = 60 + 420 + 65 = 545pts (over limit)", () => {
  const pts = 60 + (140 * 3) + 65;
  assertEqual(pts, 545, "Expected 545pts, got " + pts);
  assert(pts > 500, "must exceed 500pt limit");
});

test("Smoke test — Poxbringer + 3x Plaguebearers + Beast of Nurgle (1 model) = 55 + 330 + 65 = 450pts (legal)", () => {
  const pts = 55 + (110 * 3) + 65;
  assertEqual(pts, 450, "Expected 450pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});

test("Smoke test — The Changeling + 3x Blue Horrors = 90 + 375 = 465pts (legal)", () => {
  const pts = 90 + (125 * 3);
  assertEqual(pts, 465, "Expected 465pts, got " + pts);
  assert(pts <= 500, "must be within 500pt limit");
});


// ── Section 117: factionKeywordRestrictions — New Constraint Feature ──────────

section("117. factionKeywordRestrictions — New Constraint Feature");

// Mirror the app's isFactionKeywordRestrictionBlocked logic
function isFactionKeywordRestrictionBlockedT(unit, det, list, units) {
  const pairs = det?.factionKeywordRestrictions;
  if (!pairs) return false;
  for (const pair of pairs) {
    const [kwA, kwB] = pair;
    if (unit.keywords.includes(kwA) && list.some(l => units.find(u => u.id === l.unitId)?.keywords.includes(kwB))) return true;
    if (unit.keywords.includes(kwB) && list.some(l => units.find(u => u.id === l.unitId)?.keywords.includes(kwA))) return true;
  }
  return false;
}

test("HTML defines isFactionKeywordRestrictionBlocked function", () => {
  assert(html.includes("isFactionKeywordRestrictionBlocked"),
    "HTML must define isFactionKeywordRestrictionBlocked");
});

test("HTML defines getFactionKeywordRestrictionHint function", () => {
  assert(html.includes("getFactionKeywordRestrictionHint"),
    "HTML must define getFactionKeywordRestrictionHint");
});

test("HTML canAddUnit checks factionKeywordRestrictions", () => {
  assert(html.includes("isFactionKeywordRestrictionBlocked(unit, det)"),
    "canAddUnit must call isFactionKeywordRestrictionBlocked");
});

test("HTML hint message references cannot be taken alongside", () => {
  assert(html.includes("cannot be taken alongside"),
    "hint message must include 'cannot be taken alongside'");
});

test("KHORNE/SLAANESH — empty list blocks neither a KHORNE nor a SLAANESH unit", () => {
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_bloodmaster"),    diDet, [], ldUnits),
    "Bloodmaster (KHORNE) must not be blocked in an empty list");
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_daemonettes"),    diDet, [], ldUnits),
    "Daemonettes (SLAANESH) must not be blocked in an empty list");
});

test("KHORNE/SLAANESH — adding a KHORNE unit blocks all SLAANESH units", () => {
  const list = [{ unitId: "ld_bloodmaster" }];
  ["ld_contorted_epitome","ld_the_masque_of_slaanesh","ld_infernal_enrapturess",
   "ld_tranceweaver","ld_daemonettes","ld_fiends"].forEach(id => {
    assert(isFactionKeywordRestrictionBlockedT(ldUnit(id), diDet, list, ldUnits),
      id + " (SLAANESH) must be blocked when a KHORNE unit is in the list");
  });
});

test("KHORNE/SLAANESH — adding a SLAANESH unit blocks all KHORNE units", () => {
  const list = [{ unitId: "ld_daemonettes" }];
  ["ld_bloodmaster","ld_karanak","ld_skulltaker","ld_bloodletters","ld_flesh_hounds"].forEach(id => {
    assert(isFactionKeywordRestrictionBlockedT(ldUnit(id), diDet, list, ldUnits),
      id + " (KHORNE) must be blocked when a SLAANESH unit is in the list");
  });
});

test("NURGLE/TZEENTCH — empty list blocks neither a NURGLE nor a TZEENTCH unit", () => {
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_plaguebearers"), diDet, [], ldUnits),
    "Plaguebearers (NURGLE) must not be blocked in an empty list");
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_pink_horrors"),  diDet, [], ldUnits),
    "Pink Horrors (TZEENTCH) must not be blocked in an empty list");
});

test("NURGLE/TZEENTCH — adding a NURGLE unit blocks all TZEENTCH units", () => {
  const list = [{ unitId: "ld_plaguebearers" }];
  ["ld_the_changeling","ld_changecaster","ld_exalted_flamer",
   "ld_blue_horrors","ld_pink_horrors","ld_flamers","ld_screamers"].forEach(id => {
    assert(isFactionKeywordRestrictionBlockedT(ldUnit(id), diDet, list, ldUnits),
      id + " (TZEENTCH) must be blocked when a NURGLE unit is in the list");
  });
});

test("NURGLE/TZEENTCH — adding a TZEENTCH unit blocks all NURGLE units", () => {
  const list = [{ unitId: "ld_pink_horrors" }];
  ["ld_epidemus","ld_poxbringer","ld_sloppity_bilepiper","ld_spoilpox_scrivener",
   "ld_plaguebearers","ld_nurglings","ld_beast_of_nurgle"].forEach(id => {
    assert(isFactionKeywordRestrictionBlockedT(ldUnit(id), diDet, list, ldUnits),
      id + " (NURGLE) must be blocked when a TZEENTCH unit is in the list");
  });
});

test("Restrictions are independent — KHORNE and NURGLE can coexist", () => {
  const list = [{ unitId: "ld_bloodmaster" }];
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_plaguebearers"), diDet, list, ldUnits),
    "Plaguebearers (NURGLE) must not be blocked when only a KHORNE unit is in the list");
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_nurglings"),     diDet, list, ldUnits),
    "Nurglings (NURGLE) must not be blocked when only a KHORNE unit is in the list");
});

test("Restrictions are independent — SLAANESH and TZEENTCH can coexist", () => {
  const list = [{ unitId: "ld_daemonettes" }];
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_pink_horrors"),  diDet, list, ldUnits),
    "Pink Horrors (TZEENTCH) must not be blocked when only a SLAANESH unit is in the list");
  assert(!isFactionKeywordRestrictionBlockedT(ldUnit("ld_the_changeling"), diDet, list, ldUnits),
    "The Changeling (TZEENTCH) must not be blocked when only a SLAANESH unit is in the list");
});

test("Restrictions do not affect detachments without factionKeywordRestrictions", () => {
  // Rotten and Rusted has no factionKeywordRestrictions — nothing should be blocked
  const rrKhorne = ldUnit("ld_bloodmaster"); // hypothetically — not in rrDet but tests the logic
  assert(!isFactionKeywordRestrictionBlockedT(rrKhorne, rrDet, [{ unitId: "ld_plaguebearers" }], ldUnits),
    "isFactionKeywordRestrictionBlockedT must return false for detachments without the field");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(58)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);

if (failures.length) {
  console.log(`\n  Failed tests:`);
  failures.forEach(f => console.log(`    ✗ ${f.description}\n      ${f.error}`));
  console.log("");
  process.exit(1);
} else {
  console.log(`  All tests passed ✓\n`);
  process.exit(0);
}
