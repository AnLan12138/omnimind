// Client-side ANSI color injection for terminal output enhancement.
// Sits between raw backend data and xterm.js — injects SGR color codes
// around matched patterns on plain-text lines, leaves already-colored lines alone.

const SGR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Standard 16 colors
  black: '\x1b[30m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  brightBlack: '\x1b[90m', brightRed: '\x1b[91m', brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m', brightBlue: '\x1b[94m', brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m', brightWhite: '\x1b[97m',

  // Bold + color combos
  boldRed: '\x1b[1;31m', boldYellow: '\x1b[1;33m', boldGreen: '\x1b[1;32m',
  boldCyan: '\x1b[1;36m', boldMagenta: '\x1b[1;35m', boldBlue: '\x1b[1;34m',
  boldWhite: '\x1b[1;37m',

  // 256-color shortcuts
  gray: '\x1b[38;5;245m',
  orange: '\x1b[38;5;208m',
  lime: '\x1b[38;5;118m',
  sky: '\x1b[38;5;39m',
  pink: '\x1b[38;5;213m',
  amber: '\x1b[38;5;178m',
  teal: '\x1b[38;5;43m',
  violet: '\x1b[38;5;99m',
}

export interface HighlightRule {
  id: string
  name: string
  pattern: string       // regex source string
  color: string         // key into SGR object
  enabled: boolean
  priority: number
  category: string      // grouping key for UI
}

export interface HighlighterConfig {
  enabled: boolean
  rules: HighlightRule[]
}

// ====================================================================
// Comprehensive preset rules covering Linux, network devices, and security devices
// ====================================================================
const PRESET_RULES: HighlightRule[] = [

  // ── 通用：严重等级（最高优先级）────────────────────────────
  {
    id: 'severe', name: '严重/紧急',
    pattern: '\\b(critical|emergency|alert|fatal|catastrophic|severity\\s*[0-2]|panic|kernel.panic|segfault|core.dumped)\\b',
    color: 'boldRed', enabled: true, priority: 110, category: '通用',
  },
  {
    id: 'error', name: '错误/失败',
    pattern: '\\b(error|fail(?:ed|ure)?|exception|abort|refused|timeout|timed.out|Disconnected|Connection.closed|reset.by.peer|no.route|not.found|can.not|unable.to|cannot|mismatch|conflict|corrupt|broken|bad.|fault)\\b',
    color: 'boldRed', enabled: true, priority: 80, category: '通用',
  },
  {
    id: 'warning', name: '警告',
    pattern: '\\b(warn(?:ing)?|deprecated|caution|notice|attention|advisory|reminder|obsolete|end.of.life|EOL|EOS|end.of.support)\\b',
    color: 'boldYellow', enabled: true, priority: 78, category: '通用',
  },
  {
    id: 'success', name: '成功/正常',
    pattern: '\\b(success(?:ful)?|ok(?:ay)?|done|complete|ready|resolved|synced|up.to.date|healthy|reachable)\\b',
    color: 'boldGreen', enabled: true, priority: 72, category: '通用',
  },

  // ── IP / MAC / 端口（跨设备通用） ──────────────────────────
  {
    id: 'ip', name: 'IP 地址',
    pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)(?:\\/(?:3[0-2]|[12]?\\d))?\\b',
    color: 'cyan', enabled: true, priority: 72, category: '通用',
  },
  {
    id: 'ipv6', name: 'IPv6 地址',
    pattern: '\\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}(?:\\/(?:12[0-8]|1[01]\\d|[1-9]?\\d))?\\b',
    color: 'brightCyan', enabled: true, priority: 71, category: '通用',
  },
  {
    id: 'mac', name: 'MAC 地址',
    pattern: '\\b(?:[0-9a-fA-F]{4}\\.){2}[0-9a-fA-F]{4}\\b|\\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\\b|\\b(?:[0-9a-fA-F]{2}){6}\\b',
    color: 'amber', enabled: true, priority: 70, category: '通用',
  },
  {
    id: 'port', name: '端口号',
    pattern: '\\b(?:port|:)\\s*(\\d{1,5})\\b|\\b(\\d{1,5})\\s*\\/(?:tcp|udp|icmp|ssh|telnet|http|https|rdp|snmp|bgp|ospf)\\b',
    color: 'magenta', enabled: true, priority: 55, category: '通用',
  },
  {
    id: 'url', name: 'URL 链接',
    pattern: 'https?:\\/\\/[^\\s,;:()\\[\\]{}"\'<>|\\x1b]+',
    color: 'brightCyan', enabled: true, priority: 50, category: '通用',
  },

  // ── Linux / Unix 服务器 ───────────────────────────────────
  {
    id: 'linux-path', name: '文件路径',
    pattern: '(?:~?\\/[^\\s,;:()\\[\\]{}"\'<>|*?]+)+\\/?',
    color: 'blue', enabled: true, priority: 62, category: 'Linux',
  },
  {
    id: 'linux-prompt', name: 'Shell 提示符',
    pattern: '^[\\w@.-]+[:~][#$]\\s?|\\[[\\w@.-]+\\s+[^\\]]+\\][#$]\\s?',
    color: 'brightGreen', enabled: true, priority: 40, category: 'Linux',
  },
  {
    id: 'linux-pkg', name: '软件包/版本',
    pattern: '\\b(?:[\\w.-]+?)\\s*[=:]\\s*(?:\\d+\\.\\d+(?:\\.\\d+)*(?:-[\\w.]+)?)\\b',
    color: 'violet', enabled: true, priority: 35, category: 'Linux',
  },
  {
    id: 'linux-perm', name: '文件权限 (rwx)',
    pattern: '\\b[d-](?:[r-][w-][x-]){3}[+@.]?\\b|\\b(?:[r-][w-][x-]){3}\\b',
    color: 'dim', enabled: true, priority: 38, category: 'Linux',
  },

  // ── 网络设备：接口名称（多厂商） ──────────────────────────
  {
    id: 'net-iface', name: '网络接口名',
    pattern: '\\b(?:' +
      // Cisco
      '(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|FortyGigabitEthernet|HundredGigEthernet|Ethernet|Loopback|Vlan|Port-channel|Tunnel|Null|Serial|Async|Dialer|BRI|BVI|NVI|Mgmt|Management)\\d+(?:\\/\\d+)*(?:\\.\\d+)?' +
      '|' +
      // Huawei / H3C
      '(?:GigabitEthernet|XGigabitEthernet|Eth-Trunk|Vlanif|LoopBack|NULL|Tunnel|Bridge-Aggregation|Route-Aggregation|Smartrate-Ethernet)\\d+(?:\\/\\d+)*(?:\\.\\d+)?' +
      '|' +
      // Juniper
      '(?:[gx]e|et|lo|fxp|em|me|irb|vlan|gr|st|ae)-\\d+(?:\\/\\d+)*(?:\\.\\d+)?' +
      '|' +
      // Arista
      '(?:Ethernet|Loopback|Vlan|Port-Channel|Management)\\d+(?:\\/\\d+)*' +
      '|' +
      // Brocade / Ruckus
      '(?:eth|ve|lb)\\s*\\d+(?:\\/\\d+)*' +
      ')\\b',
    color: 'teal', enabled: true, priority: 68, category: '网络设备',
  },
  // ── 网络设备：接口状态 ────────────────────────────────────
  {
    id: 'net-ifup', name: '接口 UP',
    pattern: '\\b(?:is\\s+)?(?:up|connected|active|online|enabled|forwarding|established|full(?:-duplex)?)\\b',
    color: 'boldGreen', enabled: true, priority: 96, category: '网络设备',
  },
  {
    id: 'net-ifdown', name: '接口 DOWN',
    pattern: '\\b(?:is\\s+)?(?:down|disconnected|inactive|offline|disabled|shutdown|error-disable|notconnect|not.connect|admin(?:istratively)?\\s*down|blocked|broken|failed|unreachable)\\b',
    color: 'boldRed', enabled: true, priority: 95, category: '网络设备',
  },
  {
    id: 'net-stp', name: 'STP 状态',
    pattern: '\\b(?:STP|RSTP|MSTP|spanning.tree)\\b|\\b(?:Root|Designated|Alternate|Backup|Master|Edge|Boundary|Discarding|Blocking|Listening|Learning|Forwarding|Disabled)\\b',
    color: 'violet', enabled: true, priority: 66, category: '网络设备',
  },
  {
    id: 'net-vrrp', name: 'VRRP/HSRP',
    pattern: '\\b(?:VRRP|HSRP|GLBP|VRRPv[23])\\b|\\b(?:Active|Standby|Listen|Master|Backup|Init|Virtual)\\s+(?:router|gateway|IP|state)?',
    color: 'sky', enabled: true, priority: 66, category: '网络设备',
  },

  // ── 网络设备：路由协议 ────────────────────────────────────
  {
    id: 'net-route', name: '路由协议/状态',
    pattern: '\\b(?:OSPF|BGP|EIGRP|IS-IS|RIP(?:v[12])?|STATIC|connected|local|aggregate|generated|policy)\\b|\\b(?:Established|FULL|EXSTART|EXCHANGE|LOADING|2WAY|INIT|DOWN|Active|Idle|OpenSent|OpenConfirm|Connect)\\b',
    color: 'sky', enabled: true, priority: 64, category: '网络设备',
  },

  // ── 网络设备：VLAN / 链路聚合 ─────────────────────────────
  {
    id: 'net-vlan', name: 'VLAN / Trunk',
    pattern: '\\b(?:VLAN|Vlan|vlan)\\s*\\d+\\b|\\b(?:access|trunk|hybrid|dot1q|native|allowed.vlan|tagged|untagged|switchport|mode)\\b',
    color: 'teal', enabled: true, priority: 63, category: '网络设备',
  },
  {
    id: 'net-lag', name: '链路聚合',
    pattern: '\\b(?:LAG|LACP|PAgP|EtherChannel|Port-Channel|Eth-Trunk|Bond|ae|bundle)\\d*\\b|\\b(?:active|passive|on|off|desirable|auto)\\s*(?:mode|state)?\\b',
    color: 'lime', enabled: true, priority: 60, category: '网络设备',
  },

  // ── 网络设备：Syslog / 日志 ───────────────────────────────
  {
    id: 'net-syslog-critical', name: 'Syslog 严重',
    pattern: '\\b(?:%[\\w-]+-[012]-[\\w-]+|%ASA-[012]-\\d+|%%01[\\w/]+/[012]/[\\w_]+)\\b',
    color: 'boldRed', enabled: true, priority: 90, category: '网络设备',
  },
  {
    id: 'net-syslog-warn', name: 'Syslog 警告/通知',
    pattern: '\\b(?:%[\\w-]+-[34]-[\\w-]+|%ASA-[34]-\\d+|%%01[\\w/]+/[34]/[\\w_]+)\\b',
    color: 'boldYellow', enabled: true, priority: 88, category: '网络设备',
  },
  {
    id: 'net-syslog-info', name: 'Syslog 信息',
    pattern: '\\b(?:%[\\w-]+-[56]-[\\w-]+|%ASA-[56]-\\d+|%%01[\\w/]+/[56]/[\\w_]+)\\b',
    color: 'cyan', enabled: true, priority: 86, category: '网络设备',
  },
  {
    id: 'net-syslog-debug', name: 'Syslog 调试',
    pattern: '\\b(?:%[\\w-]+-7-[\\w-]+|%ASA-7-\\d+|%%01[\\w/]+/7/[\\w_]+)\\b',
    color: 'gray', enabled: true, priority: 84, category: '网络设备',
  },

  // ── 安全设备：威胁/动作 ──────────────────────────────────
  {
    id: 'sec-block', name: 'Block / Deny',
    pattern: '\\b(?:block(?:ed)?|den(?:y|ied)|drop(?:ped)?|reject(?:ed)?|discard(?:ed)?|quarantine[d]?)\\b',
    color: 'boldRed', enabled: true, priority: 94, category: '安全设备',
  },
  {
    id: 'sec-allow', name: 'Allow / Permit',
    pattern: '\\b(?:allow(?:ed)?|permit(?:ted)?|pass(?:ed)?|accept(?:ed)?|authenticated|authorized|granted|bypass)\\b',
    color: 'boldGreen', enabled: true, priority: 93, category: '安全设备',
  },
  {
    id: 'sec-threat', name: '威胁等级 (高)',
    pattern: '\\b(?:threat|severity|risk|priority|level)\\s*[:=]?\\s*(?:Critical|High|Urgent|Emergency)(?:-Severity)?\\b|\\b(?:Critical|High|Urgent)\\s+(?:threat|risk|alert|event|vulnerability|incident|severity)\\b',
    color: 'boldRed', enabled: true, priority: 97, category: '安全设备',
  },
  {
    id: 'sec-threat-med', name: '威胁等级 (中/低)',
    pattern: '\\b(?:threat|severity|risk|priority|level)\\s*[:=]?\\s*(?:Medium|Moderate|Low|Info(?:rmational)?)(?:-Severity)?\\b|\\b(?:Medium|Moderate|Low|Info(?:rmational)?)\\s+(?:threat|risk|alert|event|vulnerability|severity)\\b',
    color: 'yellow', enabled: true, priority: 88, category: '安全设备',
  },
  {
    id: 'sec-attack', name: '攻击类型',
    pattern: '\\b(?:DDoS|DoS|SQL.Injection|XSS|CSRF|Cross.Site|Command.Injection|RCE|Remote.Code|Privilege.Escalation|Buffer.Overflow|Zero.Day|malware|ransomware|trojan|backdoor|rootkit|spyware|adware|worm|virus|phishing|spoofing|sniffing|MITM|ARP.poisoning|DNS.poisoning|port.scan(?:ning)?|brute.force|credential.stuffing|password.(?:spray|attack|guess)|reconnaissance|exploit(?:ation)?|CVE-\\d{4}-\\d+|CWE-\\d+|MS\\d{2}-\\d{3})\\b',
    color: 'orange', enabled: true, priority: 90, category: '安全设备',
  },
  {
    id: 'sec-action', name: '安全动作',
    pattern: '\\b(?:action|verdict|result|disposition)\\s*[:=]\\s*\\w+|\\b(?:reset-(?:client|server|both)|RST|TCP.Reset|SYN.Cookie|ICMP.Unreachable|blackhole|sinkhole|scrub|clean|detected|prevented|mitigated?|remediated|contained|isolated)\\b',
    color: 'brightMagenta', enabled: true, priority: 68, category: '安全设备',
  },
  {
    id: 'sec-zone', name: '安全区域',
    pattern: '\\b(?:zone|area|segment|enclave|boundary|perimeter|edge|inside|outside|DMZ|trust|untrust|internal|external|private|public|mgmt|management|guest|isolated)\\b',
    color: 'violet', enabled: true, priority: 58, category: '安全设备',
  },

  // ── 安全设备：VPN / 隧道 ──────────────────────────────────
  {
    id: 'sec-vpn', name: 'VPN / 加密',
    pattern: '\\b(?:VPN|IPSec|IKE(?:v[12])?|SSL.VPN|L2TP|PPTP|GRE|WireGuard|OpenVPN|AnyConnect|GlobalProtect|ZTNA|Zero.Trust|SASE|SD-WAN)\\b|\\b(?:tunnel|encrypt(?:ed|ion)?|decrypt|ESP|AH|SA|ISAKMP|pre-shared|PKI|certificate|handshake|phase.[12]|transform-set)\\b',
    color: 'brightBlue', enabled: true, priority: 60, category: '安全设备',
  },
  {
    id: 'sec-auth', name: '认证/授权',
    pattern: '\\b(?:TACACS\\+|RADIUS|LDAP(?:S)?|Kerberos|OAuth|SAML|MFA|2FA|SSO|Active.Directory|RBAC|IAM|AAA|802\\.1[Xx]|MAB|WebAuth|Captive.Portal)\\b|\\b(?:login|logout|logon|logoff|authenticate|authorize|accounting|credential|token|session)\\b',
    color: 'sky', enabled: true, priority: 56, category: '安全设备',
  },

  // ── 安全设备：防火墙产品日志格式 ──────────────────────────
  {
    id: 'sec-paloalto', name: 'Palo Alto 日志',
    pattern: '\\b(?:THREAT|TRAFFIC|CONFIG|SYSTEM|HIP-MATCH|USERID|CORRELATION|GLOBALPROTECT|DECRYPTION|AUTHENTICATION|SCTP|TUNNEL-INSPECT)\\b',
    color: 'brightYellow', enabled: true, priority: 70, category: '安全设备',
  },
  {
    id: 'sec-fortinet', name: 'Fortinet 日志字段',
    pattern: '\\b(?:action|status|level|msg|devname|devid|vd|srcip|dstip|srcport|dstport|proto|service|policyid|sessionid|srcintf|dstintf|srcintfrole|dstintfrole|sentbyte|rcvdbyte|sentpkt|rcvdpkt|duration|threat|attack|app|appcat|srcmac|dstmac|srccountry|dstcountry|logdesc|subtype|eventtype|url|hostname|severity)\\s*=\\S+',
    color: 'dim', enabled: true, priority: 48, category: '安全设备',
  },
  {
    id: 'sec-asa', name: 'Cisco ASA 日志',
    pattern: '\\b%ASA-\\d+-\\d{6,}\\b',
    color: 'brightYellow', enabled: true, priority: 70, category: '安全设备',
  },

  // ── 网络设备：ACL / 策略 ──────────────────────────────────
  {
    id: 'net-acl', name: 'ACL / 策略匹配',
    pattern: '\\b(?:access-list|access-group|ip.access-list|mac.access-list|extended|standard|remark|match|permit|deny|any|host|eq|gt|lt|range|established|log|reflect|evaluate|time-range)\\b',
    color: 'violet', enabled: true, priority: 61, category: '网络设备',
  },
  {
    id: 'net-nat', name: 'NAT / 地址转换',
    pattern: '\\b(?:NAT|PAT|SNAT|DNAT|NAT-PT|CGNAT|dynamic.NAT|static.NAT|PAT.pool|overload|inside|outside|ip.nat.(?:inside|outside))\\b',
    color: 'lime', enabled: true, priority: 58, category: '网络设备',
  },

  // ── 网络设备：常见 show 输出字段 ──────────────────────────
  {
    id: 'net-speed', name: '带宽/速率',
    pattern: '\\b(?:\\d+(?:\\.\\d+)?\\s*(?:Gbps|Mbps|Kbps|bps|GB|MB|KB|B|packets\\/s|pps|MHz|GHz))\\b|\\b(?:auto-?negotiat(?:e|ion)|half-duplex|full-duplex|1000(?:base[\\w-]+)?|100(?:base[\\w-]+)?|10(?:base[\\w-]+)?)\\b',
    color: 'brightBlue', enabled: true, priority: 52, category: '网络设备',
  },
  {
    id: 'net-errors', name: '接口错误计数',
    pattern: '\\b(?:CRC|FCS|errors?|collisions|runts|giants|discards|overruns|underruns|ignored|drops|late.collision|deferred|babble|no.carrier|no.buffer|throttles|resets|output.errors|input.errors|alignment)\\b',
    color: 'orange', enabled: true, priority: 59, category: '网络设备',
  },

  // ── 网络设备：设备型号/厂商 ───────────────────────────────
  {
    id: 'net-vendor', name: '设备型号',
    pattern: '\\b(?:Cisco|(?:Catalyst|Nexus|ASR|ISR|CSR|ASA|FTD|Firepower|UCS|Meraki|Aironet)\\s*\\d+[\\w-]*|Huawei|(?:CloudEngine|NetEngine|AR\\d+|S\\d+|CE\\d+)|H3C|(?:S\\d+\\w+|MSR\\d+|SR\\d+)|(?:Juniper|JUNOS)|(?:MX\\d+|EX\\d+|QFX\\d+|SRX\\d+|ACX\\d+|PTX\\d+))\\b',
    color: 'boldCyan', enabled: true, priority: 45, category: '网络设备',
  },

  // ── 通用格式 ──────────────────────────────────────────────
  {
    id: 'quoted', name: '引号字符串',
    pattern: '\'[^\']*\'|"[^"]*"',
    color: 'yellow', enabled: true, priority: 30, category: '通用',
  },
  {
    id: 'number-hex', name: '十六进制/AS 号',
    pattern: '\\b0x[0-9a-fA-F]+\\b|\\bAS\\s*\\d+(?:\\.\\d+)?\\b',
    color: 'magenta', enabled: true, priority: 42, category: '通用',
  },
  {
    id: 'timestamp', name: '时间戳',
    pattern: '\\b\\d{4}[-/]\\d{2}[-/]\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:?\\d{2})?\\b|\\b\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?\\b|\\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}\\b',
    color: 'dim', enabled: true, priority: 25, category: '通用',
  },

  // ── SNMP / 监控 ───────────────────────────────────────────
  {
    id: 'mon-snmp', name: 'SNMP / 监控',
    pattern: '\\b(?:SNMP(?:v[123])?|MIB|OID|trap|inform|poll|get|walk|community|NMS)\\b|\\b\\.1(?:\\.\\d+){5,}\\b|\\b(?:Uptime|Downtime|CPU|Memory|Temperature|Throughput|Latency|Jitter|Packet.Loss|Utilization)\\s*[:=]?\\s*\\d+[%\\w]*\\b',
    color: 'dim', enabled: true, priority: 36, category: '通用',
  },
]

// Pre-built compiled rule ready for matching
interface CompiledRule {
  regex: RegExp
  color: string
  priority: number
}

export class KeywordHighlighter {
  private rules: CompiledRule[] = []
  private _enabled = true

  constructor(config?: Partial<HighlighterConfig>) {
    this._enabled = config?.enabled ?? true
    this.compileRules(config?.rules ?? PRESET_RULES)
  }

  get enabled() { return this._enabled }
  set enabled(v: boolean) { this._enabled = v }

  updateConfig(config: Partial<HighlighterConfig>) {
    if (config.enabled !== undefined) this._enabled = config.enabled
    if (config.rules) this.compileRules(config.rules)
  }

  private compileRules(rules: HighlightRule[]) {
    this.rules = []
    for (const r of rules) {
      if (!r.enabled) continue
      try {
        const colorCode = (SGR as Record<string, string>)[r.color]
        if (!colorCode) continue
        this.rules.push({
          regex: new RegExp(r.pattern, 'gi'),
          color: colorCode,
          priority: r.priority,
        })
      } catch {
        // Skip invalid regex
      }
    }
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  // Process raw data chunk. Returns transformed data for xterm.write().
  // Each chunk is processed independently — no buffering, no data loss.
  process(data: string): string {
    if (!this._enabled || this.rules.length === 0) return data

    // If the chunk already contains ANSI escape sequences, pass through
    // untouched to avoid corrupting existing color/cursor sequences.
    if (data.indexOf('\x1b') !== -1) return data

    // Split by newlines to process each line independently,
    // but preserve the trailing incomplete portion as-is.
    const idx = data.lastIndexOf('\n')
    if (idx === -1) {
      // No newline at all — process the entire chunk as one piece
      return this.applyHighlights(data)
    }

    // Process each complete line, preserving the trailing partial
    const head = data.slice(0, idx + 1)  // complete lines including last \n
    const tail = data.slice(idx + 1)       // incomplete trailing text (or empty)

    const lines = head.split('\n')
    // Last element is empty (after final \n) — remove it
    if (lines[lines.length - 1] === '') lines.pop()

    const result = lines.map(line => this.applyHighlights(line)).join('\n') + '\n'
    return tail ? result + this.applyHighlights(tail) : result
  }

  // No-op: buffer-free, nothing to flush
  flush(): string { return '' }
  reset() {}

  // Apply regex highlighting to a single line or text fragment.
  // Does NOT check hasAnsi — caller must ensure this is plain text.
  private applyHighlights(line: string): string {
    if (line === '') return line

    // Collect all match intervals (start, end, color)
    const matches: Array<{ s: number; e: number; color: string }> = []

    for (const rule of this.rules) {
      rule.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.regex.exec(line)) !== null) {
        const s = m.index, e = s + m[0].length
        // Check overlap with existing higher-priority matches
        if (!matches.some(ex => s < ex.e && e > ex.s)) {
          matches.push({ s, e, color: rule.color })
        }
      }
    }

    if (matches.length === 0) return line

    // Apply from end to start so earlier positions stay valid
    matches.sort((a, b) => b.s - a.s)

    let result = line
    for (const { s, e, color } of matches) {
      result = result.slice(0, s) + color + result.slice(s, e) + SGR.reset + result.slice(e)
    }
    return result
  }
}

// Singleton so Terminal instances can share one engine config
let _instance: KeywordHighlighter | null = null

export function getHighlighter(): KeywordHighlighter {
  if (!_instance) _instance = new KeywordHighlighter()
  return _instance
}

export function recreateHighlighter(config?: Partial<HighlighterConfig>): KeywordHighlighter {
  _instance = new KeywordHighlighter(config)
  return _instance
}

export { PRESET_RULES, SGR }
