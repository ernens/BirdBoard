// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BIRDASH_URL || 'http://192.168.2.217/birds';

test('GET /api/health returns ok', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/health`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.status).toBe('ok');
  expect(data.total_detections).toBeGreaterThan(0);
});

test('GET /api/system-health returns CPU/memory/disk', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/system-health`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.cpu.cores).toBeGreaterThan(0);
  expect(data.memory.total).toBeGreaterThan(0);
  expect(data.disk.total).toBeGreaterThan(0);
});

test('GET /api/taxonomy returns species list', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/taxonomy`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.species.length).toBeGreaterThan(10);
  expect(data.species[0]).toHaveProperty('sciName');
  expect(data.species[0]).toHaveProperty('comName');
});

test('GET /api/stats/species returns aggregated data', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/stats/species`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.length).toBeGreaterThan(10);
  expect(data[0]).toHaveProperty('sci_name');
  expect(data[0]).toHaveProperty('total_count');
  expect(data[0].total_count).toBeGreaterThan(0);
});

test('GET /api/stats/daily returns today data', async ({ request }) => {
  const today = new Date().toISOString().split('T')[0];
  const resp = await request.get(`${BASE}/api/stats/daily?from=${today}&to=${today}`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(Array.isArray(data)).toBeTruthy();
});

test('GET /api/comparison/weekly returns year-over-year data', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/comparison/weekly?week=15&year=2026`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.week).toBe(15);
  expect(data.years).toBeDefined();
  expect(Object.keys(data.years).length).toBeGreaterThan(0);
});

test('GET /api/reports/weekly?generate=true returns report', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/reports/weekly?generate=true`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.overall).toBeDefined();
  expect(data.overall.total_det).toBeGreaterThan(0);
  expect(data.topSpecies.length).toBeGreaterThan(0);
});

test('GET /api/public/station-info returns station metadata', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/public/station-info`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.name).toBeTruthy();
  expect(data.totalDetections).toBeGreaterThan(0);
  expect(data.totalSpecies).toBeGreaterThan(0);
  expect(data.location.lat).toBeGreaterThan(0);
});

test('GET /api/network/overview returns local station', async ({ request }) => {
  const resp = await request.get(`${BASE}/api/network/overview`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.local).toBeDefined();
  expect(data.local.name).toBeTruthy();
  expect(data.peers).toBeDefined();
});
