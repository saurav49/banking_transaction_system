import { randomUUID } from 'node:crypto';

const [email, password, accountId] = process.argv.slice(2);
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';

if (!email || !password || !accountId) {
  throw new Error(
    'Usage: bun run simulate:attack -- <email> <password> <accountId>',
  );
}

const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!loginResponse.ok) {
  throw new Error(`Login failed with status ${loginResponse.status}`);
}
const login = (await loginResponse.json()) as {
  data: { accessToken: string };
};

const requests = Array.from({ length: 10 }, (_, index) =>
  fetch(`${apiBaseUrl}/transactions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.data.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      transactionId: `attack-${randomUUID()}-${index}`,
      accountId,
      type: 'DEBIT',
      amountMinor: '1000000',
      deviceFingerprint: 'simulated-compromised-device',
    }),
  }),
);
const responses = await Promise.all(requests);
const results = await Promise.all(
  responses.map(async (response) => ({
    status: response.status,
    body: (await response.json().catch(() => ({}))) as {
      message?: string;
    },
  })),
);
const blocked = results.filter(
  (result) =>
    result.status === 422 && result.body.message === 'Invalid transaction',
).length;
const insufficientBalance = results.filter(
  (result) =>
    result.status === 422 && result.body.message === 'Insufficient balance',
).length;
console.log(
  JSON.stringify(
    {
      totalRequests: results.length,
      blockedRequests: blocked,
      insufficientBalanceRequests: insufficientBalance,
      results,
    },
    null,
    2,
  ),
);
if (blocked === 0) {
  throw new Error('Attack simulation did not trigger fraud blocking');
}

const auditUrl = `${apiBaseUrl}/replay/accounts/${accountId}`;
let fraudFlaggedAt: string | null = null;
for (let attempt = 0; attempt < 20 && !fraudFlaggedAt; attempt += 1) {
  await Bun.sleep(250);
  const auditResponse = await fetch(auditUrl, {
    headers: { authorization: `Bearer ${login.data.accessToken}` },
  });
  if (!auditResponse.ok) break;
  const audit = (await auditResponse.json()) as {
    data?: { fraudFlaggedAt?: string | null };
  };
  fraudFlaggedAt = audit.data?.fraudFlaggedAt ?? null;
}

console.log(
  JSON.stringify(
    {
      asyncFraudFlagged: Boolean(fraudFlaggedAt),
      fraudFlaggedAt,
    },
    null,
    2,
  ),
);
