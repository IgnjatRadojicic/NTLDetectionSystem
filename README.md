# NTL Detection

> Backend for a non-technical loss detection system built during the **Sotex Solutions Hackathon** (April 2026, 24 hours, team of four).

Given a simulated Nigerian distribution grid dataset, identify which 11 kV feeders are losing revenue to theft, ghost consumers, or dead meters.

My contribution: **backend and detection pipeline**.

---

## Table of Contents

- [Stack](#stack)
- [The Problem](#the-problem)
- [Why Detection Happens at the Feeder Head](#why-detection-happens-at-the-feeder-head)
- [How Detection Works](#how-detection-works)
- [Data Quality](#data-quality)
- [Results](#results)
- [API](#api)
- [Future Work](#future-work)
- [Repository Layout](#repository-layout)
- [Running It](#running-it)

---

## Stack

| Layer | Technology |
| --- | --- |
| Runtime | .NET 8 Web API |
| Database | SQL Server (Docker) |
| Data access | Dapper + raw SQL |
| Frontend | Next.js + React Leaflet *(separate project)* |

**Why Dapper over EF Core?** The core of the detection is a window function running over **3.2 million meter reads**. Raw SQL made the hot path explicit and fast.

**Architecture.** Layered and testable in isolation:

- **Core** : entities and abstractions
- **Infrastructure** : repositories and SQL queries
- **Analysis** : pure detection logic, no I/O
- **Controllers** : thin HTTP wrappers

---

## The Problem

Nigerian distribution companies lose **15–30%** of delivered energy to non-technical losses. At current Band A tariffs (~₦200/kWh), that translates to **billions of naira per year per utility**.

The dataset provided:

- Meter readings
- Network topology (transmission stations → distribution transformers)
- 3.2M timestamped kWh register values

**Goal:** find the feeders that are bleeding money.

---

## Why Detection Happens at the Feeder Head

Consumer meters in the dataset only report **voltage and current**, not energy. That meant no way to detect theft at the individual transformer level. The only trusted energy measurement is the **feeder head meter**, sitting inside a locked substation, upstream of the consumer network where theft actually happens.

So detection identifies **flagged feeders**, not flagged houses. The output is actionable:

> *"Feeder 198, which serves 11 transformers, is drawing 714% more than expected."*

A field crew can act on that.

---

## How Detection Works

### 1. Energy Aggregation

`MeterReadTfes` stores cumulative kWh registers every 30 minutes. Energy per interval is `Val(t) - Val(t-1)`. SQL Server's `LAG` window function does this in a single pass over 3.2M rows : one query, no self-joins, no row-by-row logic.

### 2. Baseline

For each feeder, divide total energy by registered distribution transformer count. Take the **median and standard deviation** across all feeders.

> Median instead of mean : the feeders we're trying to flag would skew the baseline upward.

### 3. Classification

Each feeder gets a z-score:

```
z = (actual - DtCount × median) / (DtCount × stdDev)
```

- `z ≥ 2` → statistical outlier at 95% confidence → **TheftSuspected**
- `z ≤ -2` → under-delivery → **Ghost / DeadMeter**

The 2-sigma test is the standard statistical outlier definition, not a hand-tuned number: that matters when defending the method.

**Physical floor rule.** Any feeder delivering less than 10% of expected gets classified as ghost regardless of z-score. This handles the edge case where heterogeneous population variance can statistically mask obvious dead-feeder cases.

### 4. Technical Loss

Computed **per feeder from physics** instead of assuming a flat percentage:

- Haversine distance from each substation to the centroid of its distribution transformers → line length
- 1.3 winding factor approximates real cable routing
- Current: `I = P / (√3 × V × PF)`
- Loss follows the three-phase **I²R** formula
- Sanity cap falls back to a flat rate when physics produces implausible values

---

## Data Quality

**This was most of the work. Not the algorithm.**

### Problem 1 : Unit Inconsistency

First run produced feeders showing **2.9 GW continuous throughput**. That would mean one feeder carrying half of Nigeria's entire grid capacity.

The documentation described `MultiplierFactor` as the standard CT × VT metering coefficient, and 99.999% of meters had it set to 1.0 : which should mean register values were already in kWh. They clearly weren't.

Register values ranged from sub-thousands on small meters to tens of billions on feeder head meters, inconsistent with any single unit convention.

**Fix:** per-meter unit classification. If any reading for a meter exceeded 100M, its values were interpreted as Wh and corrected with a 0.001 factor.

> The correction had to be **per-meter, not per-row**. A meter whose values crossed the threshold during the window would otherwise have its deltas computed in mixed units and produce garbage. Put the classification in a CTE so each meter gets one decision applied to all its readings.

### Problem 2 : Duplicate Feeder Assignment

Two meters in the dataset were assigned to multiple feeders, which would have double-counted their energy. Excluded at the SQL level through another CTE.

### Why This Didn't Change the Detection Results

Classifications, z-scores, and percentages are all **ratios** : unit-invariant. The absolute numbers moved into physically plausible ranges, which meant I could defend every field in the API response.

---

## Results

Seven-day window, **281 analyzable feeders**:

| Metric | Value |
| --- | --- |
| Total energy delivered | 42.2 GWh |
| Non-technical loss rate | 5.5% |
| Technical loss (pure resistive I²R) | 1.7% |
| Feeders flagged : theft-suspected | 6 |
| Feeders flagged : ghost / dead-meter | 9 |

The 5.5% NTL rate matches the 5–10% range published for head-meter level detection in Nigerian DISCO reports. The 1.7% technical loss is lower than industry benchmarks because transformer iron losses and reactive losses are not modeled.

### The Strongest Finding Was Geographic

Four of the six theft-suspected feeders belonged to a **single cluster in the Kukwaba L34_B6 area**, all showing 400–700% throughput above expected.

> Geographic clustering at that density is the signature of systemic theft. Random noise scatters. Real hotspots concentrate.

### The Ghost Findings Were Even Cleaner

Four feeders with 32–92 registered distribution transformers each, delivering **zero energy for the entire week**. Either disconnected with stale registry entries, or the downstream metering infrastructure is fully offline. Both cases are recoverable through registry cleanup.

---

## API

Four endpoints driving the frontend:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/feeders/anomalies` | Per-feeder detection results with classification, z-score, energy values |
| `GET /api/summary` | Aggregate KPIs |
| `GET /api/transmission-stations` | Registry data with lat/long for the map |
| `GET /api/substations` | Registry data with lat/long for the map |
| `GET /api/distribution-substations` | Registry data with lat/long for the map |

Results are cached in-memory for 10 minutes per time window. First hit runs the full SQL aggregation : subsequent requests for the same window return in **under 10ms**. Enum serialization is explicit so classification comes through as `"TheftSuspected"` and not a numeric value.

---

## Future Work

- **Per-feeder rolling baselines** instead of cross-feeder median. Comparing each feeder to its own historical consumption removes the heterogeneity assumption and handles industrial vs. residential differences naturally. The baseline calculator is already the abstraction point where this drops in.
- **Real-time ingestion** through SignalR on a simulated clock to make the demo feel operational.
- **DT-level detection** once smart meters with energy channels exist. Same pipeline, finer-grained aggregation unit : the architecture does not need to change.

---

## Repository Layout

```
Hack2on/
├── Core/
│   ├── Entities/          # database entities
│   ├── Models/            # analysis DTOs
│   ├── Abstractions/      # repository and detector interfaces
│   └── Common/            # AnalysisConfig
├── Infrastructure/
│   ├── Persistence/       # Dapper connection factory
│   ├── Sql/               # raw SQL queries as constants
│   └── *.cs               # repositories
├── Analysis/
│   ├── BaselineCalculator.cs
│   ├── AnomalyScorer.cs
│   ├── TechnicalLossCalculator.cs
│   ├── NtlDetectionPipeline.cs
│   └── CachedAnomalyDetector.cs
└── Controllers/
    ├── FeedersController.cs
    ├── SummaryController.cs
    └── RegistryController.cs
```

---

## Running It

**Prerequisites:** Docker, .NET 8 SDK.

```bash
# Bring up SQL Server on port 1433
docker compose up -d

# Load the migration script and seed data (dataset provided by Sotex)
# ... then:

# Run the API on port 5098
dotnet run
```

---

## Built During

**Sotex Solutions Hackathon : April 2026**
24 hours · Team of four
