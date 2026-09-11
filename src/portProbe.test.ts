import * as net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { isUrlAlive, portOf, probeUrls, resetProbes } from './portProbe';

afterEach(() => resetProbes());

/** Ouvre un vrai serveur TCP sur un port libre et rend son port. */
async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('portOf', () => {
  it('lit le port explicite de l’URL', () => {
    expect(portOf('http://localhost:6602/')).toBe(6602);
    expect(portOf('http://127.0.0.1:5173')).toBe(5173);
  });

  it('retombe sur le port par défaut du schéma', () => {
    expect(portOf('http://localhost/')).toBe(80);
    expect(portOf('https://localhost/')).toBe(443);
  });

  it('rend undefined sur une URL illisible', () => {
    expect(portOf('pas une url')).toBeUndefined();
  });
});

describe('isUrlAlive', () => {
  it('rend undefined tant que l’URL n’a pas été sondée : rien n’est masqué sans preuve', () => {
    expect(isUrlAlive('http://localhost:6602/')).toBeUndefined();
  });

  it('rend true pour un port qui écoute vraiment', async () => {
    const server = await listen();
    const url = `http://localhost:${server.port}/`;
    await probeUrls([url]);
    expect(isUrlAlive(url)).toBe(true);
    await server.close();
  });

  it('rend false quand plus rien n’écoute', async () => {
    const server = await listen();
    const url = `http://localhost:${server.port}/`;
    await server.close();
    await probeUrls([url]);
    expect(isUrlAlive(url)).toBe(false);
  });

  it('repasse à false quand le serveur meurt et que le TTL est écoulé', async () => {
    const server = await listen();
    const url = `http://localhost:${server.port}/`;
    await probeUrls([url]);
    expect(isUrlAlive(url)).toBe(true);
    await server.close();
    await probeUrls([url], { now: Date.now() + 60_000 });
    expect(isUrlAlive(url)).toBe(false);
  });

  it('ne resonde pas tant que le TTL court', async () => {
    const server = await listen();
    const url = `http://localhost:${server.port}/`;
    await probeUrls([url]);
    await server.close();
    await probeUrls([url]); // même instant : le cache tient
    expect(isUrlAlive(url)).toBe(true);
  });
});

describe('probeUrls', () => {
  it('ignore les URL illisibles sans planter', async () => {
    await expect(probeUrls(['pas une url'])).resolves.toBeUndefined();
    expect(isUrlAlive('pas une url')).toBeUndefined();
  });
});
