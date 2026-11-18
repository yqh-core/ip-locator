import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIpList, resultsToCsv, resultToSummary, BATCH_MAX } from '../js/batch.js';

test('拆分、去重，并丢掉格式不对的', () => {
  const r = parseIpList('8.8.8.8, 1.1.1.1\n8.8.8.8；not-an-ip 2001:4860:4860::8888');
  assert.deepEqual(r.valid, ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']);
  assert.deepEqual(r.invalid, ['not-an-ip']);
  assert.equal(r.truncated, false);
  assert.equal(r.max, BATCH_MAX);
});

test('超过上限的合法地址被截断，不静默多查', () => {
  const ips = Array.from({ length: 25 }, (_, i) => `1.2.3.${i}`);
  const r = parseIpList(ips.join(' '), 20);
  assert.equal(r.valid.length, 20);
  assert.equal(r.valid[0], '1.2.3.0');
  assert.equal(r.valid[19], '1.2.3.19');
  assert.equal(r.truncated, true);
});

test('空输入得到空列表', () => {
  const r = parseIpList('  \n，');
  assert.deepEqual(r.valid, []);
  assert.deepEqual(r.invalid, []);
  assert.equal(r.truncated, false);
});

test('CSV 给含逗号和引号的字段加引号', () => {
  const csv = resultsToCsv([{
    ip: '8.8.8.8',
    country: 'United States',
    org: 'Google, "LLC"',
    note: '第一行\n第二行',
  }]);
  assert.match(csv.split('\r\n')[0], /^ip,country,/);
  assert.match(csv, /"Google, ""LLC"""/);
  assert.match(csv, /"第一行\n第二行"/);
});

test('摘要带上精度说明，缺字段就省略', () => {
  const text = resultToSummary({ ip: '8.8.8.8', city: 'Mountain View', lat: 37.4, lon: -122.08 }, { rfcClass: '公网' });
  assert.match(text, /IP：8\.8\.8\.8/);
  assert.match(text, /城市：Mountain View/);
  assert.match(text, /经纬度：37\.4, -122\.08/);
  assert.match(text, /地址类别：公网/);
  assert.match(text, /通常只能精确到城市级/);
  assert.doesNotMatch(text, /省份/);
});
