/**
 * The dashboard's sample-data generators, used as the fallback for every part of the API that has
 * no configured source. Imported from source — never copied — so the fallback cannot drift from
 * what the dashboard shows with VITE_USE_MOCKS=true.
 */
export * as sample from '../../dashboard/src/api/mock/data.js';
