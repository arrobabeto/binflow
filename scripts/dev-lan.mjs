import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const isPrivateIPv4 = (address) => {
  const parts = address.split('.').map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
};

const configuredAddress = process.env.BINFLOW_LAN_ADDRESS;
if (configuredAddress !== undefined && !isPrivateIPv4(configuredAddress)) {
  throw new Error('BINFLOW_LAN_ADDRESS must be a private IPv4 address.');
}
const detectedAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (entry) =>
      entry?.family === 'IPv4' &&
      !entry.internal &&
      isPrivateIPv4(entry.address),
  )?.address;
const address = configuredAddress ?? detectedAddress;

if (address === undefined) {
  throw new Error(
    'No private LAN address found. Set BINFLOW_LAN_ADDRESS to the private IP address.',
  );
}

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'dev:live') {
  throw new Error('Usage: node scripts/dev-lan.mjs <dev|dev:live>.');
}

const publicUrl = `http://${address}:6060`;
console.log(`Starting Binflow for LAN access at ${publicUrl}`);
const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['run', mode],
  {
    env: { ...process.env, BINFLOW_PUBLIC_URL: publicUrl },
    stdio: 'inherit',
  },
);
child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
