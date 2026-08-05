import test from 'node:test';
import assert from 'node:assert/strict';
import { uptimeBars, latencyChart, fmtDuration } from '../src/charts.js';

test('uptimeBars : un rect par jour, SVG valide', () => {
  const hist = [
    { day: '2026-08-01', uptime: 1, down_seconds: 0, has_data: true },
    { day: '2026-08-02', uptime: 0.5, down_seconds: 3600, has_data: true },
    { day: '2026-08-03', uptime: null, down_seconds: 0, has_data: false },
  ];
  const svg = uptimeBars(hist);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trim().endsWith('</svg>'));
  assert.equal((svg.match(/<rect/g) || []).length, 3);
  assert.match(svg, /100\.00 %/); // titre du 1er jour
  assert.match(svg, /1\.0 h indispo/); // 3600 s => 1.0 h
});

test('latencyChart : rend un SVG avec la ligne', () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ ts: 1000 + i * 60000, up: 1, latency_ms: 50 + i }));
  const svg = latencyChart(pts);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('<line') || svg.includes('<path'));
  assert.match(svg, /ms/);
});

test('latencyChart : segment rouge pour une sonde down', () => {
  const pts = [
    { ts: 1000, up: 1, latency_ms: 50 },
    { ts: 61000, up: 0, latency_ms: 100 },
    { ts: 121000, up: 1, latency_ms: 60 },
  ];
  const svg = latencyChart(pts);
  assert.match(svg, /#dc2626/); // rouge présent
});

test('latencyChart : message si données insuffisantes', () => {
  assert.match(latencyChart([]), /Pas assez de données/);
  assert.match(latencyChart([{ ts: 1, up: 1, latency_ms: 10 }]), /Pas assez de données/);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(30), '30 s');
  assert.equal(fmtDuration(120), '2 min');
  assert.equal(fmtDuration(5400), '1.5 h');
  assert.equal(fmtDuration(172800), '2.0 j');
});
