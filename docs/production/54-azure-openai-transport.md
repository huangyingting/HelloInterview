# 54 - Azure OpenAI transport compatibility

**Status: adapter implemented and fixture-verified; the currently authorized
local configuration returns Azure `DeploymentNotFound`, so authentic provider
evidence and managed dispatch remain open.**

This checkpoint tracks
[#47](https://github.com/huangyingting/HelloInterview/issues/47). The user
authorized Azure OpenAI configuration from the adjacent local project. Secrets
remain external to this repository and must never be copied into source,
documentation, artifacts, logs or issue comments.

## Configuration

Configure exactly one provider family. Azure requires all four settings:

```text
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
AZURE_OPENAI_API_VERSION
```

The endpoint must be an HTTPS origin (loopback HTTP is accepted only for tests),
the deployment is a bounded identifier and the API version is a dated Azure
version. Mixing any `OPENAI_*` setting with `AZURE_OPENAI_*` fails startup.

Azure requests use the deployment chat-completions route, configured
`api-version` query and `api-key` authentication while retaining the existing
timeout, shutdown cancellation, output bounds and response validation. Client
capabilities expose only configured availability and deployment name.

## Evidence and current blocker

The complete existing AI integration suite runs through an Azure-shaped fixture
and verifies routing, authentication, validated feedback/tutoring, explicit
upstream failures, late-response fencing and persisted work.

A synthetic readiness request containing no user data was sent with the
authorized local configuration. Azure accepted the request shape but returned
HTTP 404 with error code `DeploymentNotFound`. The adjacent project uses the
same URL construction, so the configured deployment must be corrected or
restored before authentic provider evidence can pass.

## Authority boundary

This adapter supports the existing local AI path. Managed identity still
disables direct provider calls. It does not grant native intent claim, provider
dispatch/publication, token/cost policy, consent or launch authority. Those
remain parent #10 work after the deployment and operating policies are valid.
