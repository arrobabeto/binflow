# ADR-0065: Exact trusted origin for private-LAN local dashboard access

- Status: Accepted
- Date: 2026-09-26
- Supersedes: None
- Superseded by: None

## Context

Local development normally trusts `http://localhost:6060`. Operators sometimes
need to access the dashboard from another device on the same private LAN. A
wildcard origin or broad address-range trust would weaken browser-origin
protection and could expose the development dashboard outside its intended
network.

## Decision

- Provide `pnpm run dev:lan` and `pnpm run dev:live:lan` for local LAN use.
- Select one private IPv4 address at startup, detected from local interfaces or
  explicitly set through `BINFLOW_LAN_ADDRESS`, and set the exact dashboard
  origin as `BINFLOW_PUBLIC_URL`.
- Do not trust an address range, wildcard, or arbitrary browser origin. LAN
  reachability and the trusted origin do not grant dashboard authorization;
  the owner must still authenticate and complete TOTP.
- Keep these commands for private-LAN development only; operators must not
  expose this development server beyond that LAN.

## Consequences

- Operators can access the same local dashboard from another LAN device without
  widening the trusted-origin policy.
- The selected interface must be unambiguous; hosts with multiple private
  interfaces should set `BINFLOW_LAN_ADDRESS` explicitly.
- LAN devices remain network peers and must not be treated as authenticated
  dashboard users.

## Alternatives considered

- Trust every private-network origin: rejected because it broadens browser
  trust beyond the selected dashboard host.
- Expose local development on a public interface: rejected because this mode is
  intended only for private-LAN use.

## Verification

The LAN launcher must choose a private IPv4 address or fail with instructions,
set only the exact `BINFLOW_PUBLIC_URL`, and leave session/TOTP authorization
unchanged. Security documentation records LAN reachability as distinct from
dashboard authorization.
