# Browser regression follow-up

Scope: Inventory create duplicate-IP rejection, out-of-network validation, and Settings shortcuts to Inventory and Device Types.

Baseline: c9bd943d751fd6cb1c7963b753f0f44c32cf8c0d.

Acceptance checks:
- Duplicate-IP create stays in the wizard, displays the translated error, and preserves the existing host.
- An out-of-range IP stays in the wizard without opening the host editor.
- Settings shortcuts navigate to Inventory and Device Types; reopening Settings does not duplicate controls.

Status: pending interactive test implementation and CI verification. Do not claim these checks passed.
