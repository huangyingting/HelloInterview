# Participant policy runtime

Issue [#54](https://github.com/huangyingting/HelloInterview/issues/54) makes participant-facing private-beta terms a fail-closed service dependency rather than stale documentation.

## Required service configuration

`APP_MODE=service` now requires all of:

- `PRIVACY_CONTROLLER_NAME`: approved public operator/data-controller identity;
- `PRIVACY_CONTACT_URL`: public HTTPS or `mailto:` privacy contact;
- `PARTICIPANT_MINIMUM_AGE`: explicit integer from 13 through 120;
- `PRIVACY_RETENTION_NOTICE`: approved participant-facing retention periods;
- `PRIVACY_DELETION_NOTICE`: approved participant-facing physical-deletion process and timeline;
- `PRIVATE_BETA_NO_DURABILITY_ACK=true`: explicit acknowledgement of the already approved no-backup/no-RPO/no-RTO boundary.

There are no service defaults. Missing, partial, malformed or unacknowledged policy configuration prevents startup before the listener opens. The configured values are public policy, not secrets, but deployment still supplies them through the root-owned service environment so release artifacts remain environment-neutral.

The durability notice is fixed in code:

> This invite-only private beta has no backup, recovery point objective, or recovery time objective. Saved data may be lost, so participants must keep another copy of important information.

Operators cannot replace that warning with softer copy while the approved infrastructure boundary remains unchanged.

## Public rendering

The bootstrap response includes only a frozen public policy DTO:

- controller name and contact URL;
- minimum age;
- retention and deletion notices;
- fixed durability warning.

It includes no environment keys, identity credentials, invite addresses or internal contact metadata. The existing separately loaded `/privacy` screen renders these facts in semantic in-page sections and provides the approved contact link. Local/demo mode receives no policy DTO and retains its existing local-development privacy copy.

This design avoids adding eager code to the auth shell, whose fixed 100 KiB cold-graph ceiling has almost no remaining margin.

## Remaining approval boundary

The engineering contract does not invent final policy values. The long-running services remain disabled and `service.env` remains absent until the owner supplies and approves the controller identity, public contact, minimum age, retention notice and deletion notice.

Policy display does not itself implement physical erasure, external processor deletion, backup deletion, legal review or delivered notice/version acceptance. Those acceptance gates remain open and must agree with the configured statements before the beta starts.
