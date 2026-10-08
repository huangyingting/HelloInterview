export const contentSources = {
  'http-semantics': { title: 'RFC 9110: HTTP Semantics', publisher: 'IETF HTTP Working Group', url: 'https://httpwg.org/specs/rfc9110.html' },
  'http-cache': { title: 'RFC 9111: HTTP Caching', publisher: 'IETF HTTP Working Group', url: 'https://httpwg.org/specs/rfc9111.html' },
  'pg-isolation': { title: 'Transaction Isolation', publisher: 'PostgreSQL', url: 'https://www.postgresql.org/docs/current/transaction-iso.html' },
  'pg-indexes': { title: 'Multicolumn Indexes', publisher: 'PostgreSQL', url: 'https://www.postgresql.org/docs/current/indexes-multicolumn.html' },
  'pg-recovery': { title: 'Continuous Archiving and Point-in-Time Recovery', publisher: 'PostgreSQL', url: 'https://www.postgresql.org/docs/current/continuous-archiving.html' },
  'sre-monitoring': { title: 'Monitoring Distributed Systems', publisher: 'Google SRE', url: 'https://sre.google/sre-book/monitoring-distributed-systems/' },
  'sre-overload': { title: 'Handling Overload', publisher: 'Google SRE', url: 'https://sre.google/sre-book/handling-overload/' },
  'sre-slos': { title: 'Implementing SLOs', publisher: 'Google SRE', url: 'https://sre.google/workbook/implementing-slos/' },
  'stripe-idempotency': { title: 'Idempotent Requests', publisher: 'Stripe', url: 'https://docs.stripe.com/api/idempotent_requests' },
  'stripe-webhooks': { title: 'Receive Events in a Webhook Endpoint', publisher: 'Stripe', url: 'https://docs.stripe.com/webhooks' },
  's3': { title: 'Amazon S3 Concepts and Consistency Model', publisher: 'AWS', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html' },
  'owasp-object-auth': { title: 'API1: Broken Object Level Authorization', publisher: 'OWASP', url: 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/' },
  'redis-eviction': { title: 'Key Eviction', publisher: 'Redis', url: 'https://redis.io/docs/latest/develop/reference/eviction/' },
  'outbox': { title: 'Transactional Outbox Pattern', publisher: 'AWS Prescriptive Guidance', url: 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html' },
  'rabbitmq-acks': { title: 'Consumer Acknowledgements and Publisher Confirms', publisher: 'RabbitMQ', url: 'https://www.rabbitmq.com/docs/confirms' },
  'kafka-design': { title: 'Apache Kafka 4.1 Design', publisher: 'Apache Kafka', url: 'https://kafka.apache.org/41/design/design/' },
  'jepsen': { title: 'Consistency Models', publisher: 'Jepsen', url: 'https://jepsen.io/consistency' },
  'websocket': { title: 'RFC 6455: The WebSocket Protocol', publisher: 'IETF', url: 'https://www.rfc-editor.org/rfc/rfc6455' },
  'flink-time': { title: 'Timely Stream Processing', publisher: 'Apache Flink', url: 'https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/' },
} as const;

export type SourceId = keyof typeof contentSources;
export const contentResearchDate = '2026-10-08';
