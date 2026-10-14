# 54 - Azure OpenAI transport compatibility

**Status: adapter implemented, fixture-verified and authentically probed with
the authorized `gpt-6.1-sol` Azure deployment; managed dispatch remains
separately denied.**

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
`api-version` query, `api-key` authentication and the newer
`max_completion_tokens` output bound while retaining the existing timeout,
shutdown cancellation and response validation. Client capabilities expose only
configured availability and deployment name.

## Evidence

The complete existing AI integration suite runs through an Azure-shaped fixture
and verifies routing, authentication, validated feedback/tutoring, explicit
upstream failures, late-response fencing and persisted work.

A synthetic readiness request containing no user data first identified
`gpt-5.6-terra` as available: an initial `max_tokens` request produced Azure
`unsupported_parameter`, while `max_completion_tokens` returned HTTP 200.
The preferred lower-cost `gpt-6.1-sol` deployment then returned HTTP 200 with
the same bounded request and expected response shape. The adjacent local
configuration now selects `gpt-6.1-sol` without copying its key or endpoint
into this repository. A production-built local application then used the real
adapter to submit a synthetic interview answer; Azure returned validated AI
feedback with a bounded numeric score.

## Authority boundary

This adapter supports the existing local AI path. Managed identity still
disables direct provider calls. It does not grant native intent claim, provider
dispatch/publication, token/cost policy, consent or launch authority. Those
remain parent #10 work after the deployment and operating policies are valid.
