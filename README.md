# Boarding Actions — List Builder

A browser-based army list builder for **Warhammer 40,000: Boarding Actions**, supporting multiple factions, detachments, enhancements, warlord designation, and a printable roster summary.

---

## Project Structure

```
boarding-actions/
├── boarding-actions.html        # Main application (single-file frontend)
├── README.md                    # This file
├── test.js                      # Node.js test suite
└── data/
    ├── index.json               # Faction index & universal enhancements
    └── factions/
        ├── adeptus_astartes.json
        ├── adeptus_custodes.json
        ├── adepta_sororitas.json
        ├── agents_of_the_imperium.json
        ├── death_guard.json
        ├── emperors_children.json
        ├── genestealer_cults.json
        ├── grey_knights.json
        ├── heretic_astartes.json
        ├── necrons.json
        ├── orks.json
        ├── tau_empire.json
        ├── tyranids.json
        └── world_eaters.json
```

> **Important:** The app fetches JSON data files at runtime via `fetch()`. This means it **must be served over HTTP** — opening `boarding-actions.html` directly as a `file://` URL will cause CORS errors and the data will not load.

---

## Running Locally with Python

Python's built-in HTTP server is the quickest way to run the app locally with no dependencies.

From the project root directory (the folder containing `boarding-actions.html` and `data/`):

```bash
python3 -m http.server 8080
```

Then open your browser and navigate to:

```
http://localhost:8080/boarding-actions.html
```

### Choosing a different port

Replace `8080` with any available port number, e.g. `5500`, `9000`:

```bash
python3 -m http.server 9000
# → http://localhost:9000/boarding-actions.html
```

### Stopping the server

Press `Ctrl + C` in your terminal.

---

## Features

### Faction & Detachment Selection
- Choose from **14 factions**: Adeptus Astartes, Adeptus Custodes, Adepta Sororitas, Agents of the Imperium, Death Guard, Emperor's Children, Genestealer Cults, Grey Knights, Heretic Astartes, Necrons, Orks, T'au Empire, Tyranids, and World Eaters
- Each faction has one or more detachments, each with a unique special rule
- Army rules and detachment rules are displayed in the left panel for reference

### Unit Roster
- Units are grouped by type: **CHARACTER**, **BATTLELINE**, **INFANTRY**, **VEHICLE**, **BEASTS**, **BEAST**, **MOUNTED**, **SWARM**
- Each unit shows its available size options and point costs
- Per-unit maximums are enforced (e.g. 0–1 Epic Heroes, 0–3 line infantry)
- Units that would exceed the 500pt limit or their max count are greyed out

### Points Tracking
- Live points bar with colour coding: green → amber (>430pts) → red (over limit)
- Warning pills appear for over-limit lists or missing warlord designation

### Enhancements
- Up to **2 enhancements** may be assigned per list, each to a different CHARACTER
- Detachment-specific enhancements and universal enhancements are both available
- Some enhancements require specific keywords and are only shown for eligible units
- Enhancements already assigned to another unit are shown as greyed out in the picker

### Warlord Designation
- Any CHARACTER may be designated as Warlord (star icon in the list panel)
- If no CHARACTERs are present, any unit may be Warlord
- A warning is shown when a detachment is selected but no Warlord is set

### Printable Summary View
- Click **🖨 Print / Export List** (appears once units are added) to open the print modal
- The modal shows a clean, white roster sheet including:
  - Editable list name
  - Army rule and detachment rule summary
  - Full unit roster with warlord badge and assigned enhancements
  - Enhancement details block
- Click **Print** to send to your printer or save as PDF — the UI chrome is hidden automatically via `@media print`

---

## Data Format

### `data/index.json`
Defines the list of factions and universal enhancements available to all armies.

```json
{
  "factions": [
    {
      "id": "tau_empire",
      "name": "T'au Empire",
      "file": "factions/tau_empire.json",
      "armyRule": {
        "name": "Void Combat Discipline",
        "desc": "..."
      }
    }
  ],
  "genericEnhancements": [
    {
      "id": "gen_relic_blade",
      "name": "Relic Blade",
      "desc": "Bearer's melee weapons gain +1 Strength and +1 Attack.",
      "rule": "+1S / +1A Melee",
      "requiresKeywords": []
    }
  ]
}
```

### `data/factions/<faction>.json`
Defines detachments and units for a single faction.

```json
{
  "detachments": [
    {
      "id": "tau_kroot_raiding_party",
      "name": "Kroot Raiding Party",
      "maxCharacters": 2,
      "specialRule": { "name": "...", "desc": "..." },
      "enhancements": [
        {
          "id": "enh_tau_experienced_leader",
          "name": "Experienced Leader",
          "desc": "...",
          "requiresKeywords": []
        }
      ],
      "units": [
        { "id": "tau_kroot_carnivores", "max": 3 },
        { "id": "tau_kroot_farstalkers", "max": 3 }
      ],
      "keywordRatio": {
        "numeratorUnitIds": ["tau_kroot_farstalkers"],
        "denominatorUnitIds": ["tau_kroot_carnivores"],
        "description": "Kroot Farstalkers units cannot outnumber Kroot Carnivores units"
      },
      "keywordRatios": [
        {
          "numeratorUnitIds": ["tau_kroot_hounds"],
          "denominatorUnitIds": ["tau_kroot_carnivores"],
          "description": "Kroot Hounds units cannot outnumber Kroot Carnivores units"
        }
      ]
    }
  ],
  "units": [
    {
      "id": "tau_kroot_carnivores",
      "name": "Kroot Carnivores",
      "type": "INFANTRY",
      "keywords": ["TAU EMPIRE", "INFANTRY", "KROOT"],
      "sizes": [{ "label": "10 models", "pts": 65 }],
      "rulesAdaptations": "This unit loses the Scouts and Fieldcraft abilities."
    },
    {
      "id": "tau_kroot_hounds",
      "name": "Kroot Hounds",
      "type": "BEAST",
      "keywords": ["TAU EMPIRE", "BEAST", "KROOT"],
      "sizes": [{ "label": "5 models", "pts": 40 }],
      "rulesAdaptations": "This unit loses the Scouts and Loping Pounce abilities. Its Movement characteristic is reduced to 9\"."
    },
    {
      "id": "tau_krootox_rider",
      "name": "Krootox Rider",
      "type": "MOUNTED",
      "keywords": ["TAU EMPIRE", "MOUNTED", "KROOT"],
      "sizes": [{ "label": "1 model", "pts": 40 }],
      "rulesAdaptations": "This unit loses the Scouts and Kroot Packmates abilities."
    }
  ]
}
```

**Unit `type`** must be one of: `CHARACTER`, `BATTLELINE`, `INFANTRY`, `VEHICLE`, `BEASTS`, `BEAST`, `MOUNTED`, `SWARM`.

- `BEASTS` is used for units with the BEASTS keyword in the core rules (e.g. Canoptek Wraiths).
- `BEAST` is used for units with the BEAST keyword (e.g. Fenrisian Wolves, Chaos Spawn, Kroot Hounds).
- `MOUNTED` is used for cavalry/rider units (e.g. Krootox Rider).

**Enhancement `requiresKeywords`** is an array of keywords the bearer must have. An empty array means any CHARACTER may take it.

**`rulesAdaptations`** is an optional string on any unit describing rule modifications that apply in Boarding Actions (abilities lost, characteristic changes, etc.).

### Optional detachment fields

These fields may be added to any detachment object to enforce faction-specific constraints. All are optional — omit them if the detachment has no such restriction.

| Field | Type | Description |
|---|---|---|
| `maxCharacters` | `number` | Maximum number of CHARACTER units allowed in the list. Enforced in the UI and tested by the suite. |
| `maxKeywordUnits` | `array` | Caps the number of units sharing a specific keyword. Each entry is `{ "keyword": "...", "max": N, "description": "..." }`. Used by Tomb Ship Complement to limit CRYPTEK units to 1. |
| `keywordRatio` | `object` | Prevents a set of "numerator" units from exceeding the count of "denominator" units. A numerator unit is blocked when adding one more would make numerator count > denominator count. Supports three flavours — set whichever pair of fields applies: `numeratorKeyword` + `denominatorUnitIds`; `numeratorUnitIds` + `denominatorUnitIds`; `numeratorUnitIds` + `denominatorKeyword`. Always include a human-readable `description` string. |
| `keywordRatios` | `array` | An array of ratio constraint objects using the same shape as `keywordRatio`. Use this when a detachment needs **multiple independent ratio constraints** — each is evaluated separately. `keywordRatio` and `keywordRatios` may coexist on the same detachment; all constraints are enforced. |
| `maxFromGroup` | `array` | Caps how many units from a named pool may appear in the list in total. Each entry is `{ "max": N, "unitIds": [...], "description": "..." }`. Unlike `exclusiveUnitGroups`, this allows more than one unit from the group up to the cap. Multiple independent groups may be defined on the same detachment. |
| `factionKeywordGroups` | `array of arrays` | Each inner array is a mutually exclusive set of faction keywords. Once a unit with one of these keywords is added, only units sharing that same keyword (or units with none of the keywords in the group) may be added. Used by all Adeptus Astartes detachments to enforce chapter purity. |
| `exclusiveUnitGroups` | `array of arrays` | Each inner array is a set of unit IDs where at most one may appear in the list at a time. Multiple independent groups may be defined on the same detachment. Used to enforce choices like "only one of these Crisis Suit variants". |

### Optional detachment unit entry fields

Each entry in a detachment's `units` array requires `id` and `max`. The following optional fields may also be set:

| Field | Type | Description |
|---|---|---|
| `requiresCharacterWithKeyword` | `string` | The unit may only be added if a CHARACTER with the specified keyword is already in the list. |
| `canTakeEnhancement` | `boolean` | When `true`, this non-CHARACTER unit may be assigned an enhancement as if it were a CHARACTER. |

---

## Adding a New Faction

1. Create `data/factions/<your_faction>.json` following the format above.
2. Add an entry to the `factions` array in `data/index.json` with a `file` value of `factions/<your_faction>.json` (no `data/` prefix).
3. Reload the page — the new faction will appear in the dropdown automatically.

---

## Running the Test Suite

The project includes a Node.js test suite with **1,273 tests** covering file structure, data integrity, cross-references, and game rule logic for every faction and detachment.

### Prerequisites

Node.js (any modern version) must be installed. No `npm install` is required — the suite uses only Node's built-in `fs` and `path` modules.

### Running tests

From the project root:

```bash
node test.js
```

### What the tests cover

The suite is organised into 99 numbered sections. Global checks run once up front; faction-specific sections follow.

**Global sections (1–12, 24–25, 37)**

| Section | Description |
|---|---|
| 1. File Structure | Confirms all JSON files exist and are valid |
| 2. Fetch Path Resolution | Verifies faction file paths won't cause 404s |
| 3. Data Integrity | Checks all cross-references, required fields, no duplicate IDs |
| 4. Game Rule Logic | Unit caps, points limits, enhancement cap, warlord rules |
| 5. Smoke Test | Simulates full list-building workflows end-to-end |
| 6. Character Cap | `maxCharacters` enforcement across detachments |
| 7. Keyword Ratio | `keywordRatio` constraint logic |
| 8. requiresCharacterWithKeyword | Prerequisite CHARACTER enforcement |
| 9. Necrons — Harbinger Cabal | Early Necrons constraint coverage |
| 10. Faction Keyword Groups | Chapter-lock / faction-purity enforcement |
| 11. Tomb Ship Complement | `maxKeywordUnits` constraint |
| 12. Exclusive Unit Groups | `exclusiveUnitGroups` constraint |
| 24. canTakeEnhancement | Enhancement eligibility for non-CHARACTER units |
| 25. maxFromGroup | Unit pool cap constraint |
| 37. Code Quality | HTML/JS structural checks |

**Faction-specific sections (13–23, 26–36, 38–99)**

Each faction has dedicated sections covering detachment structure, unit definitions (keywords, points, size labels, rules adaptations), and game rule logic (character cap, unit maxes, ratio constraints, exclusive groups, smoke test points calculations).

| Sections | Faction |
|---|---|
| 13–15 | Adeptus Astartes — Boarding Strike |
| 26–29 | Tyranids |
| 30–36 | Death Guard |
| 38–47 | World Eaters |
| 48–54 | Orks |
| 55–65 | Adepta Sororitas |
| 66–69 | Emperor's Children |
| 70–77 | Grey Knights |
| 78–86 | Agents of the Imperium |
| 87–90 | Genestealer Cults |
| 91–97 | T'au Empire |
| 98 | New unit types — BEAST and MOUNTED |
| 99 | `keywordRatios` array multi-constraint feature |

> **Note:** Global constraints (ID uniqueness, cross-faction ID collisions, enhancement ID uniqueness, unit→detachment cross-references, required-field schema checks) are all covered by section 3 and are **not** duplicated in faction-specific sections. Faction sections cover only faction-specific behaviour: points values, keywords, rules adaptations content, and constraint logic.

A passing run looks like:

```
── 1. File Structure & JSON Validity ──────────────────────────
  ✓  data/index.json exists and is valid JSON
  ✓  index.json has factions array
  ...

── Results ────────────────────────────────────────────────────
  Results: 1273 passed, 0 failed
  All tests passed ✓
```

---

## Browser Compatibility

The app uses standard ES6+ and the Fetch API. It works in all modern browsers (Chrome, Firefox, Safari, Edge). No build step or bundler is required.
