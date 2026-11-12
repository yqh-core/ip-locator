var DDAnalytics = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // D:/work/dev-tools-main/src/lib/analytics.ts
  var analytics_exports = {};
  __export(analytics_exports, {
    FUNNEL_EVENTS: () => FUNNEL_EVENTS,
    FunnelTracker: () => FunnelTracker,
    beaconTransport: () => beaconTransport,
    memoryTransport: () => memoryTransport
  });
  var FUNNEL_EVENTS = ["visit", "tool_start", "tool_success", "download", "return_visit"];
  var FORBIDDEN_KEYS = ["filename", "fileName", "input", "content", "ip", "email", "user", "password", "token", "cookie"];
  var FunnelTracker = class _FunnelTracker {
    sid;
    seq = 0;
    queue = [];
    seen = /* @__PURE__ */ new Set();
    // 去重：每会话每工具每事件一次（visit/return 除外）
    notCollected;
    transport;
    tool;
    constructor(tool, transport, opts) {
      this.tool = tool;
      this.transport = transport;
      this.notCollected = new Set(opts?.notCollected ?? []);
      this.sid = opts?.sid ?? _FunnelTracker.randomSid();
    }
    static randomSid() {
      return `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    }
    /** 校验事件隐私合规：禁止 PII 字段。返回是否合规。 */
    static isPrivacySafe(payload) {
      return !Object.keys(payload).some((k) => FORBIDDEN_KEYS.includes(k.toLowerCase()));
    }
    /** 记录一个漏斗事件。返回 'tracked' | 'dedup' | 'not_collected' | 'invalid'。 */
    track(event, extra) {
      if (!FUNNEL_EVENTS.includes(event)) {
        return "invalid";
      }
      if (this.notCollected.has(event)) {
        return "not_collected";
      }
      if (extra && !_FunnelTracker.isPrivacySafe(extra)) {
        return "invalid";
      }
      const dedupKey = `${this.tool}:${event}`;
      if (event !== "visit" && event !== "return_visit") {
        if (this.seen.has(dedupKey)) {
          return "dedup";
        }
        this.seen.add(dedupKey);
      }
      this.queue.push({ tool: this.tool, event, ts: Date.now(), sid: this.sid, seq: this.seq++ });
      return "tracked";
    }
    /**  flush 队列到传输层。 */
    flush() {
      const out = this.queue.slice();
      this.queue = [];
      if (out.length) {
        this.transport.send(out);
      }
      return out;
    }
    pending() {
      return this.queue.length;
    }
  };
  function beaconTransport(endpoint) {
    return {
      send(events) {
        try {
          const blob = new Blob([JSON.stringify(events)], { type: "text/plain;charset=UTF-8" });
          if (typeof navigator !== "undefined" && navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, blob);
          }
        } catch {
        }
      }
    };
  }
  function memoryTransport() {
    const events = [];
    return {
      events,
      send(e) {
        events.push(...e);
      }
    };
  }
  return __toCommonJS(analytics_exports);
})();
