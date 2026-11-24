/**
 * net-tools.js 单元测试（node --test tests/net-tools.test.mjs）
 * CIDR 数学用已知答案对账；非法输入必须拒绝（负对照）；IPv6 压缩按 RFC 5952。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIPv4, formatIPv4, parseIPv6, formatIPv6, cidrInfo, ptrName, dnsStatusText, classifyIPAddress,
} from '../js/net-tools.js';

test('IPv4 解析与格式化', () => {
  assert.equal(parseIPv4('8.8.8.8'), 0x08080808);
  assert.equal(parseIPv4('255.255.255.255'), 0xFFFFFFFF);
  assert.equal(parseIPv4('0.0.0.0'), 0);
  assert.equal(formatIPv4(0xC0A80101), '192.168.1.1');
});

test('IPv4 非法输入拒绝（负对照）', () => {
  for (const bad of ['999.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', 'a.b.c.d', '', '1.2.3.4/']) {
    assert.equal(parseIPv4(bad), null, `应拒绝: ${bad}`);
  }
});

test('IPv6 解析：完整/压缩/IPv4-mapped/环回', () => {
  assert.equal(parseIPv6('2001:4860:4860::8888'), 0x20014860486000000000000000008888n);
  assert.equal(parseIPv6('::1'), 1n);
  assert.equal(parseIPv6('::'), 0n);
  assert.equal(parseIPv6('::ffff:192.168.1.1'), 0x00000000000000000000ffffc0a80101n);
  assert.equal(parseIPv6('fe80::1'), 0xfe800000000000000000000000000001n);
  assert.equal(parseIPv6('2001:db8:0:0:0:0:0:1'), parseIPv6('2001:db8::1'));
});

test('IPv6 非法输入拒绝（负对照）', () => {
  for (const bad of ['12345::bad', ':::', '1:2:3:4:5:6:7:8:9', 'fe80::1%eth0', '2001:db8:::1', 'gggg::1', '']) {
    assert.equal(parseIPv6(bad), null, `应拒绝: ${bad}`);
  }
});

test('IPv6 RFC 5952 压缩', () => {
  assert.equal(formatIPv6(0x20010db8000000000000000000000001n), '2001:db8::1');
  assert.equal(formatIPv6(1n), '::1');
  assert.equal(formatIPv6(0n), '::');
  assert.equal(formatIPv6(0xfe800000000000000000000000000001n), 'fe80::1');
  // 单零不压
  assert.equal(formatIPv6(0x20010db8000000010000000000000001n), '2001:db8:0:1::1');
  // 并列零段取最左
  assert.equal(formatIPv6(0x20010000000000000001000000000001n), '2001::1:0:0:1');
});

test('CIDR IPv4：192.168.1.0/24 已知答案', () => {
  const r = cidrInfo('192.168.1.77/24');
  assert.equal(r.version, 4);
  assert.equal(r.network, '192.168.1.0');
  assert.equal(r.broadcast, '192.168.1.255');
  assert.equal(r.firstUsable, '192.168.1.1');
  assert.equal(r.lastUsable, '192.168.1.254');
  assert.equal(r.mask, '255.255.255.0');
  assert.equal(r.wildcard, '0.0.0.255');
  assert.equal(r.totalAddresses, '256');
  assert.equal(r.usableHosts, '254');
  assert.equal(r.classification, 'Private (RFC 1918)');
});

test('CIDR IPv4：/8 /30 /31 /32 边界', () => {
  assert.equal(cidrInfo('10.0.0.0/8').totalAddresses, '16777216');
  const r30 = cidrInfo('192.0.2.0/30');
  assert.equal(r30.usableHosts, '2');
  assert.equal(r30.firstUsable, '192.0.2.1');
  assert.equal(r30.lastUsable, '192.0.2.2');
  const r31 = cidrInfo('192.0.2.0/31');
  assert.equal(r31.usableHosts, '2'); // RFC 3021
  assert.equal(r31.note.includes('RFC 3021'), true);
  const r32 = cidrInfo('8.8.8.8');
  assert.equal(r32.prefix, 32);
  assert.equal(r32.totalAddresses, '1');
  assert.equal(r32.classification, 'Public');
});

test('CIDR IPv4：非法前缀拒绝（负对照）', () => {
  for (const bad of ['1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/abc', '999.1.1.1/24', '1.2.3.4/24/24']) {
    assert.throws(() => cidrInfo(bad), `应拒绝: ${bad}`);
  }
});

test('CIDR IPv6：2001:db8::/32 已知答案', () => {
  const r = cidrInfo('2001:db8::1/32');
  assert.equal(r.version, 6);
  assert.equal(r.network, '2001:db8::');
  assert.equal(r.subnetRouterAnycast, '2001:db8::');
  assert.equal(r.firstUsable, undefined);
  assert.equal(r.lastAddress, '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(r.lastUsable, undefined);
  assert.equal(r.usableHosts, undefined);
  assert.equal(r.totalAddresses, (2n ** 96n).toString());
  assert.equal(r.classification, 'Documentation range (2001:db8::/32)');
  assert.equal(r.broadcast, '');
});

test('CIDR IPv6：/48、/56、/64 与长前缀的 /64 子网数量', () => {
  assert.equal(cidrInfo('2001:db8:1234:abcd::1/48').subnet64Count, '65536');
  assert.equal(cidrInfo('2001:db8:1234:ab7f::1/56').subnet64Count, '256');
  assert.equal(cidrInfo('2001:db8:1234:ab01::1/64').subnet64Count, '1');
  assert.equal(cidrInfo('2001:db8:1234:ab01::1/65').subnet64Count, '0');
  assert.equal(cidrInfo('::/0').subnet64Count, (2n ** 64n).toString());
  assert.equal(cidrInfo('192.0.2.1/24').subnet64Count, undefined);
});

test('CIDR IPv6：Subnet-Router Anycast 不标记为普通 first usable', () => {
  const r = cidrInfo('2001:db8:1234:ab01::1/64');
  assert.equal(r.subnetRouterAnycast, '2001:db8:1234:ab01::');
  assert.equal(r.firstUsable, undefined);
  assert.match(r.note, /not a normal host address/i);
});

test('CIDR IPv6：/128 /64 /0 与分类', () => {
  assert.equal(cidrInfo('::1').prefix, 128);
  assert.equal(cidrInfo('::1').classification, 'Loopback');
  assert.equal(cidrInfo('2001:4860:4860::8888/64').network, '2001:4860:4860::');
  assert.equal(cidrInfo('::/0').totalAddresses, (2n ** 128n).toString());
  assert.equal(cidrInfo('fe80::1/64').classification, 'Link-local');
  assert.equal(cidrInfo('febf::1/64').classification, 'Link-local'); // /10 上界
  assert.equal(cidrInfo('fec0::1/64').classification, 'Public (global unicast)'); // 出 /10
  assert.equal(cidrInfo('fd00::1/8').classification, 'Unique local (fc00::/7)');
});

test('CIDR IPv6：非法前缀拒绝（负对照）', () => {
  for (const bad of ['2001:db8::/129', '::1/-1', '::1/xyz', '12345::bad/64']) {
    assert.throws(() => cidrInfo(bad), `应拒绝: ${bad}`);
  }
});

test('rDNS 名称构造：IPv4 反序 + IPv6 nibble 反序', () => {
  assert.equal(ptrName('8.8.8.8'), '8.8.8.8.in-addr.arpa');
  assert.equal(ptrName('1.2.3.4'), '4.3.2.1.in-addr.arpa');
  assert.equal(ptrName('2001:4860:4860::8888'),
    '8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.ip6.arpa');
  assert.throws(() => ptrName('not-an-ip'));
});

test('DNS 状态码文案', () => {
  assert.equal(dnsStatusText(0), 'NOERROR (response received)');
  assert.equal(dnsStatusText(3), 'NXDOMAIN (domain does not exist)');
  assert.equal(dnsStatusText(99), 'RCODE 99');
});

test('IANA-aware IP address classification for IPv4 special-purpose ranges', () => {
  assert.equal(classifyIPAddress('8.8.8.8').key, 'outsideSpecialPurpose');
  assert.equal(classifyIPAddress('10.1.2.3').key, 'privateUse');
  assert.equal(classifyIPAddress('172.31.255.1').key, 'privateUse');
  assert.equal(classifyIPAddress('192.168.1.1').key, 'privateUse');
  assert.equal(classifyIPAddress('100.72.1.1').key, 'sharedAddress');
  assert.equal(classifyIPAddress('127.0.0.1').key, 'loopback');
  assert.equal(classifyIPAddress('169.254.10.20').key, 'linkLocal');
  assert.equal(classifyIPAddress('192.0.2.10').key, 'documentation');
  assert.equal(classifyIPAddress('198.18.0.1').key, 'benchmarking');
  assert.equal(classifyIPAddress('224.0.0.1').key, 'multicast');
  assert.equal(classifyIPAddress('240.0.0.1').key, 'reserved');
  assert.equal(classifyIPAddress('192.0.0.9').key, 'protocolAnycast');
  assert.equal(classifyIPAddress('255.255.255.255').key, 'limitedBroadcast');
});

test('IANA-aware IP address classification for IPv6 and IPv4-mapped addresses', () => {
  assert.equal(classifyIPAddress('2001:4860:4860::8888').key, 'globalUnicast');
  assert.equal(classifyIPAddress('2001:db8::1').key, 'documentation');
  assert.equal(classifyIPAddress('3fff::1').key, 'documentation');
  assert.equal(classifyIPAddress('fc00::1').key, 'uniqueLocal');
  assert.equal(classifyIPAddress('fe80::1').key, 'linkLocal');
  assert.equal(classifyIPAddress('ff02::1').key, 'multicast');
  assert.equal(classifyIPAddress('::').key, 'unspecified');
  assert.equal(classifyIPAddress('::1').key, 'loopback');
  assert.equal(classifyIPAddress('64:ff9b::192.0.2.33').key, 'translation');
  assert.equal(classifyIPAddress('5f00::1').key, 'srv6');
  const mapped = classifyIPAddress('::ffff:192.0.2.33');
  assert.equal(mapped.key, 'ipv4Mapped');
  assert.equal(mapped.embeddedKey, 'documentation');
  assert.equal(classifyIPAddress('not-an-ip'), null);
});
