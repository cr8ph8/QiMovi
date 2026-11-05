import { benchmarkDiscovery } from './experiment.mjs';

const args = process.argv.slice(2);
const repeat = args.find(arg => arg.startsWith('--repetitions='));
if (args.some(arg => arg !== '--ledger' && arg !== repeat) || new Set(args).size !== args.length) {
  throw new Error('Usage: node local/discovery/benchmark.mjs [--repetitions=30] [--ledger]');
}
console.log(JSON.stringify({
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  ...benchmarkDiscovery({ repetitions: repeat ? Number(repeat.slice('--repetitions='.length)) : 30, includeLedger: args.includes('--ledger') }),
}, null, 2));
