# Link Planner — MVP 0.1.0-lab.1

**Status:** isolated implementation under `modules/link-planner/`, not merged to main and not an RF field certification. Tracked by [Issue #66](https://github.com/emsebi/EMS_IPAM/issues/66).

## Purpose

Point-to-point radio *planning* and transparent first-order geometry, with no SSH, SNMP, scripts, periodic monitoring, RADIUS interaction, or configuration push to equipment.

This module is separate from **Radio Management** (documentation of existing AP/Station relationships). The SDK v1 panel appears at `#/module/link-planner` for administrators once its module folder is installed and application restarted.

## Available in this milestone

- Select Site A and Site B by clicking an OpenStreetMap map, or enter WGS84 latitude/longitude manually.
- Specify independently for each site: **building height, tower height and antenna mount offset** above the SRTM ground elevation. The sum represents antenna height above ground, so enter zero for any component that is not physically stacked.
- Fetch **81 path elevation samples** manually (never in background) from Open Topo Data's public SRTM90m provider, through a fixed-URL, authenticated and rate-limited backend. Cache successful results for 10 minutes to reduce public API use.
- Plot sampled terrain, geometric LOS and first-Fresnel clearance requirement (default 60%), including effective Earth curvature with adjustable **k-factor** (default 4/3). Show worst sampled clearance and **uniform increase in both antenna heights** needed to resolve the sampled deficit.
- Compute free-space path loss, theoretical EIRP, received power, and margin against the **user-entered** receiver sensitivity. Frequency, gains, cable and other losses can be set manually.
- Store up to 100 named scenarios as input configuration in a dedicated `link_planner_scenarios` PostgreSQL table. Loading a scenario does not silently reuse old terrain: the elevation service must be queried again.
- Download a JSON calculation/report snapshot including parameters, formulas' outputs and the terrain samples/source **if loaded**.
- Persian/English labels, narrow-screen layout, no extra frontend dependency.

## Scientific and operational limitations

- **Terrain:** SRTM90m approximately 90 m raster, approximate vertical accuracy; public coverage approximately **60° S to 60° N**. The 81 samples are a sampling of this raster and do not resolve every obstacle, roof, tree, or localized ridge. Public API availability and rate limits are outside this project's control. Missing or null elevation produces **UNKNOWN**, never a positive clearance result.
- **Fresnel:** first zone radius is `sqrt(lambda * d1 * d2 / (d1 + d2))`. Earth bulge is `d1*d2/(2*k*R)` with mean Earth radius 6,371,008.8 m. The sampled clearance is LOS height minus sampled terrain, bulge and selected zone percentage. This is **an estimate, not a field survey or a path diversity model**.
- **RF:** FSPL `32.44 + 20log10(distance_km) + 20log10(freq_MHz)`; EIRP `TX_power + TX_gain - TX_cable_loss`; received power subtracts free-space, RX cable and optional other losses. No regulatory EIRP approval is implied.
- **Not yet delivered:** Manufacturer/model-dependent modulation, MCS, QAM, Throughput, and climate-based rain-fade Availability. Entering “MikroTik” or “Mimosa” alone cannot produce valid modulation/availability figures. These require model datasheets, channel width, path weather statistics and further verification, tracked on Issue #66.
- No third-party map provider receives your inventory, usernames or passwords, but requests for OpenStreetMap tiles expose the viewed map area to the tile host. The server sends coordinates (not credentials) to the public Open Topo Data elevation provider only **after clicking Load terrain**.

Official upstream terrain information: [Open Topo Data API](https://www.opentopodata.org/api/) and [SRTM dataset notes](https://www.opentopodata.org/datasets/srtm/).

## Deployment safely

Install into existing SDK v1 compatible application by adding only `modules/link-planner/` to the mounted modules folder, **back up database first**, restart app and verify health/module registration/migration. Do not overwrite the Radio folder, network-map, RADIUS or Core. This is a lab preview until actual VM acceptance.

CI: `cd docker-app && npm ci && node --test tests/link-planner.test.mjs`; browser test uses local synthetic fixtures with mocked SRTM response, not a live terrain service.

## Next validation checkpoints

1. Test map A/B selection and manual coordinates.
2. Test source fetch in the deployment network. Where internet is blocked, show explicit error and keep purely mathematical RF budget available.
3. Test correct SRTM path / buildings / clearance on a known benchmark and compare with survey data before relying on mounting heights.
4. Test save/reload and report download; confirm RADIUS login and existing Radio 2.3 preserved.
