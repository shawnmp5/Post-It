import { getStore } from '@netlify/blobs';
import { createAccounts } from '../lib/accounts.mjs';

// All of /api/* — accounts, sessions and the encrypted walls — stored in Netlify Blobs.
const handle = createAccounts((name) => getStore({ name, consistency: 'strong' }));

export default (req) => handle(req);

export const config = { path: '/api/*' };
