# Network Access base records — 0.1.0-rc.1

Admin-only MAC and Personnel tabs. MACs shown here are existing stored IPAM host records. This module does not collect switch MAC tables, authenticate network clients, enforce VLANs, or enable 802.1X/MAB. Those capabilities belong to Part 4 after the RADIUS and discovery modules.

Personnel records remain in the core database/API. No scheduled MAC collection may be introduced in later implementations; all switch MAC reads require an explicit user action.
