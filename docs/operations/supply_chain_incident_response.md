# Supply-Chain Incident Response

## Scope and ownership

This playbook covers Resonate's source, GitHub Actions, dependencies, build
utilities, Artifact Registry images, attestations, cross-repository deployment
handoff, workload identity, and live Cloud Run/Dataflow release identity.

- Primary owner: Resonate security maintainer.
- Release containment owner: Resonate release maintainer.
- GCP/IAM and live-runtime owner: Resonate infrastructure maintainer.
- Protocol authority owner: Resonate protocol security maintainer.
- Review cadence: quarterly, after every exercise, and after any material
  workflow, registry, identity-provider, signing, deployment, or authority
  change.

Never place an OIDC token, access token, service-account credential, private
key, raw secret, or sensitive recovery material in an issue, workflow artifact,
chat, or this repository.

Routine reviewed Action, base-image, dependency-lock, and build-utility changes
follow [Supply-Chain Input Updates](./supply_chain_updates.md).

## Evidence map

Preserve evidence before retrying or deleting a failed run:

| Evidence | Location | Retention/owner |
| --- | --- | --- |
| Revision-bound Action BOM and checksum | `action-bom-<source SHA>` workflow artifact | 90 days / release maintainer |
| Per-image Cloud Build metadata, CycloneDX SBOM, signature, SBOM-attestation and source/build-attestation verification | `image-evidence-<service>-<source SHA>` workflow artifact | 90 days / release maintainer |
| Versioned deploy manifest | `deploy-manifest` workflow artifact | 90 days / release maintainer |
| Privileged workflow executions and delivery-file changes | `release-plane-evidence-<run id>` workflow artifact | 90 days / security maintainer |
| GitHub audit log, environment/ruleset changes, token use | GitHub organization/repository settings | platform retention / repository maintainer |
| STS/WIF, IAM, Cloud Build, Artifact Registry and Cloud Run/Dataflow audit events | GCP Cloud Audit Logs and Monitoring | private IaC policy / infrastructure maintainer |
| Declared, registry, attestation and live-revision reconciliation | private `resonate-iac` scheduled/deploy evidence | private IaC policy / infrastructure maintainer |

Record the source SHA, workflow path, run ID/URL, actor, event/ref, environment,
Cloud Build ID, image tag, digest, signer identity, deploy release ID, and live
revision. Record identifiers, not credential contents.

## Common containment sequence

1. Stop the affected handoff/deployment or disable the privileged workflow.
2. Preserve the workflow, manifest, ABOM, SBOM, build, verification, audit-log,
   and live-revision evidence listed above.
3. Identify the last-known-good source SHA and immutable image digest from a
   previously reconciled release.
4. Disable or revoke the affected workload identity, token, publisher,
   maintainer, package, signing path, or session authority at the owning system.
5. Rebuild from a reviewed revision only after the input and identity path is
   understood. Never bless an existing mutable tag.
6. Verify the expected issuer and exact repository/workflow/ref/environment
   signer identity, then redeploy the last-known-good or rebuilt artifact by
   digest.
7. Reconcile attested source SHA, declared digest, Artifact Registry digest,
   attestation identity, and the live Cloud Run/Dataflow revision before
   restoring normal delivery.
8. Rotate affected credentials and funded/session authorities, then document
   impact, timeline, decisions, gaps, owners, and due dates.

## Scenario playbooks

### Image digest or attestation mismatch

- Stop repository dispatch and do not deploy the tag or digest.
- Preserve Cloud Build metadata, SBOM, signature/attestation verification,
  deploy manifest, registry metadata, and live revision evidence.
- Compare the source SHA, declared digest, registry digest, signer workflow and
  issuer independently. A tag match is not sufficient.
- Quarantine the unexpected registry digest, review registry writes and signer
  runs, then deploy a reconciled last-known-good digest.

### Unexpected workflow trigger, ref, actor, or workflow change

- Disable the affected workflow or environment approval path and preserve the
  `release-plane-evidence` artifact plus the GitHub audit log.
- Review `.github/workflows`, `.github/actions`, and `.github/scripts` history,
  including force-push/ruleset changes and artifact trust context.
- Revoke unexpected tokens or app installations and require a reviewed source
  revision before re-enabling delivery.

### Suspected WIF or service-account misuse

- Disable the provider binding or service-account impersonation grant; do not
  create a long-lived JSON key as a workaround.
- Preserve STS, IAM, Cloud Build, Artifact Registry and deploy audit events.
- Verify issuer, audience, subject, repository, workflow, ref and environment
  conditions and run the controlled negative-exchange matrix.
- Rotate any non-federated credential found in the path and reconcile every
  release produced during the affected window.

### Package takeover or dependency confusion

- Block the package/version/source, stop installs and builds, and preserve the
  lockfile, lifecycle policy, registry metadata, ABOM/SBOM and affected logs.
- Determine whether install/build code executed and which credentials or
  network destinations were reachable.
- Restore a reviewed lock from the public registry or immutable approved
  artifact; keep scripts disabled except for exact allowlisted package paths.
- Rotate reachable credentials even if the package later disappears.

### Pipeline credential harvesting

- Stop the job before retries, revoke the exposed token/identity/session, and
  preserve logs without copying secret values into tickets.
- Trace artifact, cache, stdout/stderr, process environment, checkout
  credentials and outbound connections for the affected job.
- Remove the exfiltration path, verify least privilege and no fallback key, then
  rebuild and reconcile all artifacts published during the exposure window.

### Unexpected privileged-job egress

- Stop the job and preserve runner, DNS/proxy/firewall and cloud audit evidence
  available for the time window.
- Compare destinations with the reviewed GitHub, package registry, Sigstore and
  GCP endpoint allowlist. Treat an unknown destination as untrusted until
  explained.
- Revoke reachable identities, isolate suspect artifacts, tighten egress or add
  an explicit monitored adaptation, and exercise the alert route before close.

## Exercise record

At least quarterly, exercise one release-plane scenario and one identity or
authority scenario. Store a sanitized record under `audit/` containing the
date, participants/roles, scenario, evidence inspected, containment decision,
last-known-good selection, reconciliation result, alert-routing result, gaps,
owners, and due dates. An untested alert or undocumented escalation route is a
prerequisite, not completed control evidence.
